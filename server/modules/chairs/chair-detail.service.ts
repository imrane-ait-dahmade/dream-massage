import { prisma } from '../../prisma';
import { elapsedSeconds } from '../../utils/time';

// ── Date helpers ──────────────────────────────────────────────────────────────
// TODO: Replace with timezone-aware midnight using APP_TIMEZONE (Africa/Casablanca).
// Currently uses local server clock midnight. If server runs in UTC, the Moroccan
// day boundary is off by 1 hour (sessions between 00:00–01:00 Casablanca fall on
// the wrong day). Add a getTimezone() call + Intl arithmetic once a TZ util exists.

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── UUID detection ─────────────────────────────────────────────────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ── Decimal / null coercion ────────────────────────────────────────────────────

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

function toNullNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

// ── Public return types ────────────────────────────────────────────────────────

export interface ChairStats {
  sessionsCount: number;
  completedSessionsCount: number;
  activeSessionsCount: number;
  expectedRevenue: number;
  correctedRevenue: number;
  finalRevenue: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
}

export interface SessionItem {
  id: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  expectedAmount: number | null;
  correctedAmount: number | null;
  finalAmount: number | null;
  billingStatus: string;
  matchedPlanName: string | null;
  shiftId: string | null;
  anomalyType: string | null;
}

export interface EventItem {
  id: string;
  eventType: string;
  powerWatts: number | null;
  message: string | null;
  createdAt: string;
}

export interface ChairDetailOverview {
  chair: {
    id: string;
    name: string;
    displayName: string | null;
    status: string;
    powerWatts: number;
    isOnline: boolean;
    relayIsOn: boolean | null;
    lastSyncedAt: string | null;
    currentSession: {
      id: string;
      startedAt: string;
      elapsedSeconds: number;
      startedAtLabel: string;
    } | null;
  };
  today: ChairStats;
  month: ChairStats;
  recentSessions: SessionItem[];
  events: EventItem[];
}

export interface SessionFilters {
  period?: 'today' | 'month' | 'custom';
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  status?: string;
}

export interface PaginatedSessions {
  items: SessionItem[];
  total: number;
  page: number;
  limit: number;
}

// ── Internal row types (Prisma returns Decimal for money fields) ───────────────

type StatsRow = {
  status: string;
  durationSeconds: number | null;
  expectedAmount: unknown;
  correctedAmount: unknown;
};

type SessionRow = {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  expectedAmount: unknown;
  correctedAmount: unknown;
  billingStatus: string;
  shiftId: string | null;
  anomalyType: string | null;
  matchedPlan: { name: string } | null;
};

// ── Aggregation ────────────────────────────────────────────────────────────────

function computeStats(rows: StatsRow[]): ChairStats {
  let completedCount = 0;
  let activeCount = 0;
  let expectedRevenue = 0;
  let correctedRevenue = 0;
  let finalRevenue = 0;
  let totalDuration = 0;
  let durationCount = 0;

  for (const s of rows) {
    if (s.status === 'COMPLETED') completedCount++;
    if (s.status === 'ACTIVE') activeCount++;

    const expected = toNum(s.expectedAmount);
    const corrected = toNullNum(s.correctedAmount);
    // finalAmount = correctedAmount if set, otherwise expectedAmount
    const finalAmt = corrected !== null ? corrected : expected;

    expectedRevenue += expected;
    if (corrected !== null) correctedRevenue += corrected;
    finalRevenue += finalAmt;

    if (s.durationSeconds !== null) {
      totalDuration += s.durationSeconds;
      durationCount++;
    }
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;

  return {
    sessionsCount: rows.length,
    completedSessionsCount: completedCount,
    activeSessionsCount: activeCount,
    expectedRevenue: r2(expectedRevenue),
    correctedRevenue: r2(correctedRevenue),
    finalRevenue: r2(finalRevenue),
    totalDurationSeconds: totalDuration,
    averageDurationSeconds: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
  };
}

// ── Session mapper ─────────────────────────────────────────────────────────────

function mapSession(s: SessionRow): SessionItem {
  const expected = toNullNum(s.expectedAmount);
  const corrected = toNullNum(s.correctedAmount);
  return {
    id: s.id,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    durationSeconds: s.durationSeconds ?? null,
    expectedAmount: expected,
    correctedAmount: corrected,
    finalAmount: corrected !== null ? corrected : expected,
    billingStatus: s.billingStatus,
    matchedPlanName: s.matchedPlan?.name ?? null,
    shiftId: s.shiftId ?? null,
    anomalyType: s.anomalyType ?? null,
  };
}

// ── Shared Prisma select for session rows ──────────────────────────────────────

const SESSION_SELECT = {
  id: true,
  status: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  expectedAmount: true,
  correctedAmount: true,
  billingStatus: true,
  shiftId: true,
  anomalyType: true,
  matchedPlan: { select: { name: true } },
};

// ── Service ────────────────────────────────────────────────────────────────────

class ChairDetailService {
  private chairWhere(chairIdOrName: string) {
    return isUuid(chairIdOrName)
      ? { id: chairIdOrName }
      : { name: chairIdOrName.toUpperCase() };
  }

  async getChairOverview(chairIdOrName: string): Promise<ChairDetailOverview | null> {
    const chair = await prisma.chair.findFirst({
      where: this.chairWhere(chairIdOrName),
      include: {
        sessions: {
          where: { status: 'ACTIVE' },
          take: 1,
          orderBy: { startedAt: 'desc' },
        },
      },
    });
    if (!chair) return null;

    const todayStart = startOfToday();
    const monthStart = startOfMonth();

    const statsSelect = {
      status: true,
      durationSeconds: true,
      expectedAmount: true,
      correctedAmount: true,
    };

    // Fire all four sub-queries in parallel
    const [todayRows, monthRows, recentRows, eventRows] = await Promise.all([
      prisma.chairSession.findMany({
        where: {
          chairId: chair.id,
          startedAt: { gte: todayStart },
          status: { notIn: ['CANCELLED'] },
        },
        select: statsSelect,
      }),
      prisma.chairSession.findMany({
        where: {
          chairId: chair.id,
          startedAt: { gte: monthStart },
          status: { notIn: ['CANCELLED'] },
        },
        select: statsSelect,
      }),
      prisma.chairSession.findMany({
        where: {
          chairId: chair.id,
          status: { notIn: ['CANCELLED'] },
        },
        select: SESSION_SELECT,
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
      prisma.chairEvent.findMany({
        where: { chairId: chair.id },
        select: {
          id: true,
          eventType: true,
          powerWatts: true,
          message: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const activeSession = chair.sessions[0] ?? null;
    const currentSession = activeSession
      ? {
          id: activeSession.id,
          startedAt: activeSession.startedAt.toISOString(),
          elapsedSeconds: elapsedSeconds(activeSession.startedAt),
          startedAtLabel: activeSession.startedAt.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Africa/Casablanca',
          }),
        }
      : null;

    return {
      chair: {
        id: chair.id,
        name: chair.name,
        displayName: chair.displayName,
        status: chair.status,
        powerWatts: chair.currentPowerWatts ?? 0,
        isOnline: chair.isOnline,
        relayIsOn: chair.relayIsOn,
        lastSyncedAt: chair.lastSyncedAt?.toISOString() ?? null,
        currentSession,
      },
      today: computeStats(todayRows as StatsRow[]),
      month: computeStats(monthRows as StatsRow[]),
      recentSessions: (recentRows as unknown as SessionRow[]).map(mapSession),
      events: eventRows.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        powerWatts: e.powerWatts ?? null,
        message: e.message ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async getChairSessions(
    chairIdOrName: string,
    filters: SessionFilters,
  ): Promise<PaginatedSessions | null> {
    const chair = await prisma.chair.findFirst({
      where: this.chairWhere(chairIdOrName),
      select: { id: true },
    });
    if (!chair) return null;

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;

    if (filters.period === 'today') {
      dateFrom = startOfToday();
    } else if (filters.period === 'month') {
      dateFrom = startOfMonth();
    } else {
      // custom or no period — use explicit from/to
      if (filters.from) dateFrom = new Date(`${filters.from}T00:00:00`);
      if (filters.to) dateTo = new Date(`${filters.to}T23:59:59.999`);
    }

    // Build where dynamically; `any` avoids complex Prisma enum casting for runtime-safe code
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      chairId: chair.id,
      status: filters.status ? filters.status : { notIn: ['CANCELLED'] },
    };
    if (dateFrom || dateTo) {
      where.startedAt = {};
      if (dateFrom) where.startedAt.gte = dateFrom;
      if (dateTo) where.startedAt.lte = dateTo;
    }

    const [total, rows] = await Promise.all([
      prisma.chairSession.count({ where }),
      prisma.chairSession.findMany({
        where,
        select: SESSION_SELECT,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: (rows as unknown as SessionRow[]).map(mapSession),
      total,
      page,
      limit,
    };
  }
}

export const chairDetailService = new ChairDetailService();
