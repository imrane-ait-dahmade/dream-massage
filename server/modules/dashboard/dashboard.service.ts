import { elapsedSeconds, nowISO, getTimezone } from '../../utils/time';
import { prisma } from '../../prisma';

export type ChairStatus =
  | 'IDLE'
  | 'MAYBE_ACTIVE'
  | 'ACTIVE'
  | 'MAYBE_FINISHED'
  | 'OFFLINE'
  | 'ERROR'
  | 'MAINTENANCE';

export interface ChairState {
  id: string;
  name: string;
  displayName: string | null;
  status: ChairStatus;
  powerWatts: number;
  isOnline: boolean;
  sessionStartedAt: string | null;
  elapsedSeconds: number;
  warning: string | null;
}

export interface OpenShift {
  id: string;
  staffMemberName: string;
  startedAt: string;
}

export interface DashboardState {
  serverTime: string;
  connection: 'mock' | 'live';
  todayStats: {
    expectedRevenue: number;
    sessionsCount: number;
    activeChairs: number;
    offlineChairs: number;
  };
  openShift: OpenShift | null;
  chairs: ChairState[];
}

function warningFor(status: ChairStatus): string | null {
  if (status === 'MAYBE_FINISHED') return 'Possible end detected';
  if (status === 'OFFLINE') return 'Device unreachable';
  if (status === 'ERROR') return 'Device error';
  return null;
}

export class DashboardService {
  async getState(): Promise<DashboardState> {
    try {
      return await this._dbState();
    } catch (err) {
      // DB unavailable — return safe empty state rather than crashing the broadcast loop
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[dashboard] DB read failed, returning empty state:', msg);
      return this._emptyState();
    }
  }

  private async _dbState(): Promise<DashboardState> {
    // ── Chairs + their active session ────────────────────────────────────────
    const dbChairs = await prisma.chair.findMany({
      where: { isEnabled: true },
      orderBy: { name: 'asc' },
      include: {
        sessions: {
          where: { status: 'ACTIVE' },
          take: 1,
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    const chairs: ChairState[] = dbChairs.map((c) => {
      const session = c.sessions[0] ?? null;
      const status = c.status as ChairStatus;
      return {
        id: c.id,
        name: c.name,
        displayName: c.displayName,
        status,
        powerWatts: c.currentPowerWatts ?? 0,
        isOnline: c.isOnline,
        sessionStartedAt: session ? session.startedAt.toISOString() : null,
        elapsedSeconds: session ? elapsedSeconds(session.startedAt) : 0,
        warning: warningFor(status),
      };
    });

    // ── Today's session stats ─────────────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todaySessions = await prisma.chairSession.findMany({
      where: {
        startedAt: { gte: todayStart },
        status: { notIn: ['CANCELLED'] },
      },
      select: { status: true, expectedAmount: true },
    });

    const sessionsCount = todaySessions.length;
    const expectedRevenue =
      Math.round(
        todaySessions.reduce((sum, s) => sum + Number(s.expectedAmount ?? 0), 0) * 100,
      ) / 100;
    const activeChairs = chairs.filter(
      (c) => c.status === 'ACTIVE' || c.status === 'MAYBE_FINISHED',
    ).length;
    const offlineChairs = chairs.filter((c) => c.status === 'OFFLINE').length;

    // ── Open shift ────────────────────────────────────────────────────────────
    const shiftRow = await prisma.shift.findFirst({
      where: { status: 'OPEN' },
      include: { staffMember: true },
      orderBy: { startedAt: 'desc' },
    });

    const openShift: OpenShift | null = shiftRow
      ? {
          id: shiftRow.id,
          staffMemberName: shiftRow.staffMember.name,
          startedAt: shiftRow.startedAt.toISOString(),
        }
      : null;

    return {
      serverTime: nowISO(),
      connection: 'live',
      todayStats: { expectedRevenue, sessionsCount, activeChairs, offlineChairs },
      openShift,
      chairs,
    };
  }

  // Safe fallback when DB is unreachable. Returns structurally valid empty state.
  private _emptyState(): DashboardState {
    return {
      serverTime: nowISO(),
      connection: 'live',
      todayStats: { expectedRevenue: 0, sessionsCount: 0, activeChairs: 0, offlineChairs: 0 },
      openShift: null,
      chairs: [],
    };
  }

  // ── Mock state (kept for reference — remove once DB version is stable) ───────
  // private _mockState(): DashboardState { ... }
}

export interface RevenueStats {
  period: string;
  labels: string[];
  revenue: number[];
  sessions: number[];
  totalRevenue: number;
  totalSessions: number;
}

function toLocalDate(date: Date, tz: string): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: tz }));
}

export class RevenueStatsService {
  async get(period: string): Promise<RevenueStats> {
    const tz = getTimezone();
    const now = new Date();
    const localNow = toLocalDate(now, tz);
    // tzOffsetMs: local.getTime() − utc.getTime() (positive = ahead of UTC)
    const tzOffsetMs = localNow.getTime() - now.getTime();

    let startUTC: Date;
    let labels: string[];
    let bucketCount: number;
    let getBucket: (local: Date) => number;

    if (period === 'day') {
      const ls = new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate(), 0, 0, 0);
      startUTC = new Date(ls.getTime() - tzOffsetMs);
      bucketCount = 24;
      labels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}h`);
      getBucket = (d) => d.getHours();
    } else if (period === 'week') {
      const daysFromMon = (localNow.getDay() + 6) % 7;
      const ls = new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate() - daysFromMon, 0, 0, 0);
      startUTC = new Date(ls.getTime() - tzOffsetMs);
      bucketCount = 7;
      labels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
      getBucket = (d) => (d.getDay() + 6) % 7;
    } else if (period === 'month') {
      const ls = new Date(localNow.getFullYear(), localNow.getMonth(), 1, 0, 0, 0);
      startUTC = new Date(ls.getTime() - tzOffsetMs);
      const daysInMonth = new Date(localNow.getFullYear(), localNow.getMonth() + 1, 0).getDate();
      bucketCount = daysInMonth;
      labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
      getBucket = (d) => d.getDate() - 1;
    } else {
      // year
      const ls = new Date(localNow.getFullYear(), 0, 1, 0, 0, 0);
      startUTC = new Date(ls.getTime() - tzOffsetMs);
      bucketCount = 12;
      labels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
      getBucket = (d) => d.getMonth();
    }

    const rows = await prisma.chairSession.findMany({
      where: {
        startedAt: { gte: startUTC },
        status: { notIn: ['CANCELLED'] },
      },
      select: { startedAt: true, expectedAmount: true, correctedAmount: true },
    });

    const revenue = new Array<number>(bucketCount).fill(0);
    const sessionCounts = new Array<number>(bucketCount).fill(0);

    for (const s of rows) {
      const local = toLocalDate(s.startedAt, tz);
      const bucket = getBucket(local);
      if (bucket >= 0 && bucket < bucketCount) {
        revenue[bucket] += Number(s.correctedAmount ?? s.expectedAmount ?? 0);
        sessionCounts[bucket]++;
      }
    }

    const roundedRevenue = revenue.map((v) => Math.round(v * 100) / 100);
    return {
      period,
      labels,
      revenue: roundedRevenue,
      sessions: sessionCounts,
      totalRevenue: Math.round(roundedRevenue.reduce((a, b) => a + b, 0) * 100) / 100,
      totalSessions: sessionCounts.reduce((a, b) => a + b, 0),
    };
  }
}

export const dashboardService = new DashboardService();
export const revenueStatsService = new RevenueStatsService();
