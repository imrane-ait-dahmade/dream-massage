import { elapsedSeconds, nowISO } from '../../utils/time';
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

export const dashboardService = new DashboardService();
