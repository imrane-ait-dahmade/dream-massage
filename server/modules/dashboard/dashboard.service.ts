import { elapsedSeconds, nowISO, getTimezone } from '../../utils/time';
import { prisma } from '../../prisma';
import { SESSION_OPERATIONAL_WHERE } from '../archive/archive-filters';
import { cacheGet, cacheSet, cacheInvalidate } from '../../utils/memory-cache';
import { usageMetrics } from '../../utils/usage-metrics';
import {
  withDbCircuit,
  DbUnavailableError,
  allowDbAttempt,
} from '../../utils/db-circuit-breaker';
import { getAllChairMem, isRuntimeHydrated } from '../chairs/chair-runtime-cache';
import { env } from '../../config/env';

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

const STATE_CACHE_KEY = 'dashboard:state';

function warningFor(status: ChairStatus): string | null {
  if (status === 'MAYBE_FINISHED') return 'Possible end detected';
  if (status === 'OFFLINE') return 'Device unreachable';
  if (status === 'ERROR') return 'Device error';
  return null;
}

export class DashboardService {
  /**
   * Returns live dashboard state.
   * Prefers in-memory chair runtime when hydrated; caches full payload 15s.
   * Throws DbUnavailableError when DB is down — never a fake empty dashboard.
   */
  async getState(): Promise<DashboardState> {
    const cached = cacheGet<DashboardState>(STATE_CACHE_KEY);
    if (cached) return cached;

    if (!allowDbAttempt() && isRuntimeHydrated()) {
      // Serve memory-only snapshot without hitting Neon
      const mem = this._memoryChairs();
      const state: DashboardState = {
        serverTime: nowISO(),
        connection: 'live',
        todayStats: {
          expectedRevenue: 0,
          sessionsCount: 0,
          activeChairs: mem.filter((c) => c.status === 'ACTIVE' || c.status === 'MAYBE_FINISHED').length,
          offlineChairs: mem.filter((c) => c.status === 'OFFLINE').length,
        },
        openShift: null,
        chairs: mem,
      };
      return state;
    }

    try {
      const state = await withDbCircuit(() => this._dbState());
      cacheSet(STATE_CACHE_KEY, state, env.DASHBOARD_CACHE_TTL_MS);
      return state;
    } catch (err) {
      if (err instanceof DbUnavailableError) throw err;
      // Non-temporary: still surface as unavailable rather than empty fake data
      console.error('[dashboard] DB read failed:', err instanceof Error ? err.message : String(err));
      throw new DbUnavailableError('Database temporarily unavailable', 60);
    }
  }

  invalidateCache(): void {
    cacheInvalidate(STATE_CACHE_KEY);
  }

  private _memoryChairs(): ChairState[] {
    return getAllChairMem().map((c) => {
      const status = c.status as ChairStatus;
      return {
        id: c.id,
        name: c.name,
        displayName: c.displayName,
        status,
        powerWatts: c.currentPowerWatts ?? 0,
        isOnline: c.isOnline,
        sessionStartedAt: c.session ? c.session.startedAt.toISOString() : null,
        elapsedSeconds: c.session ? elapsedSeconds(c.session.startedAt) : 0,
        warning: warningFor(status),
      };
    });
  }

  private async _dbState(): Promise<DashboardState> {
    usageMetrics.incr('dbReads', 3);

    // Prefer memory for live chair fields when available
    let chairs: ChairState[];
    if (isRuntimeHydrated()) {
      chairs = this._memoryChairs();
    } else {
      const dbChairs = await prisma.chair.findMany({
        where: { isEnabled: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          displayName: true,
          status: true,
          currentPowerWatts: true,
          isOnline: true,
          sessions: {
            where: { status: 'ACTIVE' },
            take: 1,
            orderBy: { startedAt: 'desc' },
            select: { startedAt: true },
          },
        },
      });

      chairs = dbChairs.map((c) => {
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
    }

    // Aggregate today stats in PostgreSQL — do not download all rows
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayAgg = await prisma.chairSession.aggregate({
      where: {
        ...SESSION_OPERATIONAL_WHERE,
        startedAt: { gte: todayStart },
        status: { notIn: ['CANCELLED'] },
      },
      _count: { _all: true },
      _sum: { expectedAmount: true },
    });

    const sessionsCount = todayAgg._count._all;
    const expectedRevenue =
      Math.round(Number(todayAgg._sum.expectedAmount ?? 0) * 100) / 100;
    const activeChairs = chairs.filter(
      (c) => c.status === 'ACTIVE' || c.status === 'MAYBE_FINISHED',
    ).length;
    const offlineChairs = chairs.filter((c) => c.status === 'OFFLINE').length;

    const shiftRow = await prisma.shift.findFirst({
      where: { status: 'OPEN', endedAt: null },
      select: {
        id: true,
        startedAt: true,
        staffMember: { select: { name: true } },
      },
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
    const cacheKey = `dashboard:revenue:${period}`;
    const cached = cacheGet<RevenueStats>(cacheKey);
    if (cached) return cached;

    const stats = await withDbCircuit(() => this._compute(period));
    cacheSet(cacheKey, stats, env.DASHBOARD_CACHE_TTL_MS);
    return stats;
  }

  private async _compute(period: string): Promise<RevenueStats> {
    usageMetrics.incr('dbReads');
    const tz = getTimezone();
    const now = new Date();
    const localNow = toLocalDate(now, tz);
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
      const ls = new Date(localNow.getFullYear(), 0, 1, 0, 0, 0);
      startUTC = new Date(ls.getTime() - tzOffsetMs);
      bucketCount = 12;
      labels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
      getBucket = (d) => d.getMonth();
    }

    const rows = await prisma.chairSession.findMany({
      where: {
        ...SESSION_OPERATIONAL_WHERE,
        startedAt: { gte: startUTC },
        status: { notIn: ['CANCELLED'] },
      },
      select: { startedAt: true, expectedAmount: true, correctedAmount: true },
      take: 5000,
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
