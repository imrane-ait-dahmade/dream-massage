import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { getTimezone } from '../../utils/time';

// ── Helpers ────────────────────────────────────────────────────────────────────

function toLocalDate(date: Date, tz: string): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: tz }));
}

// YYYY-MM-DD (in `tz`) → UTC Date at local midnight.
// Uses per-date offset so DST transitions are handled correctly.
function localMidnightUTC(yyyyMmDd: string, tz: string): Date {
  const probeUTC = new Date(`${yyyyMmDd}T00:00:00Z`);
  const local    = new Date(probeUTC.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = local.getTime() - probeUTC.getTime();
  return new Date(probeUTC.getTime() - offsetMs);
}

function addDays(yyyyMmDd: string, n: number): string {
  const [y, mo, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// HH:mm → minutes from midnight
function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function d2(n: number): number {
  return Math.round(n * 100) / 100;
}

const VALID_PERIODS   = ['all', 'matin', 'soir', 'journee', 'custom'] as const;
const VALID_CHART_P   = ['day', 'week', 'month', 'year'] as const;

type Period      = typeof VALID_PERIODS[number];
type ChartPeriod = typeof VALID_CHART_P[number];

// ── Param type ─────────────────────────────────────────────────────────────────

export interface HomeDashboardParams {
  from: string;
  to: string;
  period: Period;
  periodStart?: string;
  periodEnd?: string;
  chair: string;
  chartPeriod: ChartPeriod;
}

// ── Prisma select ──────────────────────────────────────────────────────────────

const SESSION_SELECT = {
  id: true,
  chairId: true,
  status: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  expectedAmount: true,
  correctedAmount: true,
  anomalyType: true,
  billingStatus: true,
  matchedPlanId: true,
  chair: { select: { id: true, name: true, displayName: true } },
  matchedPlan: { select: { id: true, name: true } },
} as const;

type SessionRow = Prisma.ChairSessionGetPayload<{ select: typeof SESSION_SELECT }>;

// Revenue from one session — ACTIVE sessions never count as revenue
function sessionRevenue(s: SessionRow): number {
  if (s.status === 'ACTIVE') return 0;
  const val = s.correctedAmount ?? s.expectedAmount;
  return val ? Number(val) : 0;
}

function isOutOfRule(s: SessionRow): boolean {
  return (
    s.anomalyType !== null ||
    s.billingStatus === 'PENDING' ||
    s.status === 'UNCERTAIN' ||
    s.status === 'ERROR'
  );
}

function warningFor(status: string): string | null {
  if (status === 'MAYBE_FINISHED') return 'Possible end detected';
  if (status === 'OFFLINE') return 'Device unreachable';
  if (status === 'ERROR') return 'Device error';
  return null;
}

// ── Service ────────────────────────────────────────────────────────────────────

export class HomeDashboardService {
  async get(raw: Partial<HomeDashboardParams>) {
    const tz    = getTimezone();
    const today = todayInTz(tz);

    // ── Normalize params ───────────────────────────────────────────────────────
    const from        = raw.from        || today;
    const to          = raw.to          || today;
    const period      = (VALID_PERIODS.includes(raw.period as Period) ? raw.period : 'all') as Period;
    const chair       = raw.chair       || 'all';
    const chartPeriod = (VALID_CHART_P.includes(raw.chartPeriod as ChartPeriod)
                          ? raw.chartPeriod
                          : 'day') as ChartPeriod;

    // ── Date range → UTC ───────────────────────────────────────────────────────
    const utcStart = localMidnightUTC(from, tz);
    const utcEnd   = localMidnightUTC(addDays(to, 1), tz); // exclusive upper bound

    // ── Time-of-day window ─────────────────────────────────────────────────────
    const periodWindow = await this.resolvePeriodWindow(period, raw.periodStart, raw.periodEnd);

    // ── Chair filter ───────────────────────────────────────────────────────────
    let chairId: string | undefined;
    if (chair !== 'all') {
      const dbChair = await prisma.chair.findFirst({
        where: { OR: [{ name: chair }, { id: chair }] },
        select: { id: true },
      });
      chairId = dbChair?.id ?? undefined;
    }

    // ── Parallel DB fetches ────────────────────────────────────────────────────
    const [dbChairs, sessions, shifts] = await Promise.all([
      prisma.chair.findMany({
        where: { isEnabled: true },
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, displayName: true,
          status: true, currentPowerWatts: true, isOnline: true,
        },
      }),
      prisma.chairSession.findMany({
        where: {
          startedAt: { gte: utcStart, lt: utcEnd },
          status:    { not: 'CANCELLED' },
          ...(chairId ? { chairId } : {}),
        },
        select:  SESSION_SELECT,
        orderBy: { startedAt: 'desc' },
      }),
      // Closed shifts whose session-reporting period overlaps the date range.
      // Prime snapshots are written to these columns at shift-close time.
      prisma.shift.findMany({
        where: {
          startedAt: { gte: utcStart, lt: utcEnd },
          status:    { in: ['CLOSED', 'REVIEWED'] },
        },
        select: {
          grossRevenue: true, planCommission: true,
          targetBonus:  true, manualBonus:    true,
          totalPrime:   true, netRevenue:     true,
        },
      }),
    ]);

    // ── Filter by time-of-day ──────────────────────────────────────────────────
    const filtered: SessionRow[] = periodWindow
      ? sessions.filter((s) => {
          const local    = toLocalDate(s.startedAt, tz);
          const localMin = local.getHours() * 60 + local.getMinutes();
          return localMin >= periodWindow[0] && localMin < periodWindow[1];
        })
      : sessions;

    // ── Assemble response ──────────────────────────────────────────────────────
    const summary    = this.buildSummary(filtered, dbChairs);
    const prime      = this.buildPrimeRevenue(shifts, summary.grossRevenue);
    const liveChairs = this.buildLiveChairs(dbChairs);
    const byChair    = this.buildTotalsByChair(filtered, dbChairs);
    const chart      = this.buildChart(filtered, chartPeriod, from, tz);
    const recent     = this.buildRecentSessions(filtered);

    return {
      filters: { from, to, period, chair, chartPeriod },
      summary: {
        grossRevenue:             summary.grossRevenue,
        netRevenue:               d2(summary.grossRevenue - prime.totalPrime),
        sessionsCount:            summary.sessionsCount,
        completedSessionsCount:   summary.completedSessionsCount,
        activeSessionsCount:      summary.activeSessionsCount,
        outOfRuleSessionsCount:   summary.outOfRuleSessionsCount,
        activeChairs:             summary.activeChairs,
        offlineChairs:            summary.offlineChairs,
        totalPrime:               prime.totalPrime,
      },
      liveChairs,
      totalsByChair: byChair,
      primeRevenue:  prime,
      revenueChart:  chart,
      recentSessions: recent,
    };
  }

  // ── Period window resolution ───────────────────────────────────────────────────

  private async resolvePeriodWindow(
    period: Period,
    periodStart?: string,
    periodEnd?: string,
  ): Promise<[number, number] | null> {
    if (period === 'all') return null;

    if (period === 'custom') {
      if (!periodStart || !periodEnd) return null;
      return [parseHHmm(periodStart), parseHHmm(periodEnd)];
    }

    // Look up shift type in DB first (owner can adjust default times)
    const st = await prisma.shiftType.findFirst({
      where: { name: { equals: period, mode: 'insensitive' }, isActive: true },
      select: { startTime: true, endTime: true },
    });
    if (st) return [parseHHmm(st.startTime), parseHHmm(st.endTime)];

    // Hard-coded fallbacks when no ShiftType record exists
    const defaults: Record<string, [string, string]> = {
      matin:   ['10:00', '15:00'],
      soir:    ['15:00', '22:00'],
      journee: ['10:00', '22:00'],
    };
    const def = defaults[period];
    return def ? [parseHHmm(def[0]), parseHHmm(def[1])] : null;
  }

  // ── Live chairs ────────────────────────────────────────────────────────────────

  private buildLiveChairs(
    chairs: Array<{
      id: string; name: string; displayName: string | null;
      status: string; currentPowerWatts: number | null; isOnline: boolean;
    }>,
  ) {
    return chairs.map((c) => ({
      id:          c.id,
      name:        c.name,
      displayName: c.displayName,
      status:      c.status,
      powerWatts:  c.currentPowerWatts ?? 0,
      isOnline:    c.isOnline,
      warning:     warningFor(c.status),
    }));
  }

  // ── Summary ────────────────────────────────────────────────────────────────────

  private buildSummary(
    sessions: SessionRow[],
    chairs: Array<{ status: string }>,
  ) {
    let grossRevenue            = 0;
    let sessionsCount           = 0;
    let completedSessionsCount  = 0;
    let activeSessionsCount     = 0;
    let outOfRuleSessionsCount  = 0;

    for (const s of sessions) {
      sessionsCount++;
      grossRevenue += sessionRevenue(s);
      if (s.status === 'ACTIVE')    activeSessionsCount++;
      if (s.status === 'COMPLETED') completedSessionsCount++;
      if (isOutOfRule(s))           outOfRuleSessionsCount++;
    }

    return {
      grossRevenue:           d2(grossRevenue),
      sessionsCount,
      completedSessionsCount,
      activeSessionsCount,
      outOfRuleSessionsCount,
      activeChairs:  chairs.filter((c) => c.status === 'ACTIVE' || c.status === 'MAYBE_FINISHED').length,
      offlineChairs: chairs.filter((c) => c.status === 'OFFLINE').length,
    };
  }

  // ── Totals by chair ────────────────────────────────────────────────────────────

  private buildTotalsByChair(
    sessions: SessionRow[],
    chairs: Array<{ id: string; name: string; displayName: string | null }>,
  ) {
    type ChairAccum = {
      sessionsCount: number;
      completedSessionsCount: number;
      activeSessionsCount: number;
      outOfRuleSessionsCount: number;
      revenue: number;
      durationTotalSeconds: number;
      plans: Map<string, { label: string; count: number; revenue: number }>;
    };

    const byChair = new Map<string, ChairAccum>(
      chairs.map((c) => [
        c.id,
        {
          sessionsCount: 0, completedSessionsCount: 0,
          activeSessionsCount: 0, outOfRuleSessionsCount: 0,
          revenue: 0, durationTotalSeconds: 0,
          plans: new Map(),
        },
      ]),
    );

    for (const s of sessions) {
      const rec = byChair.get(s.chairId);
      if (!rec) continue;

      const rev = sessionRevenue(s);
      rec.sessionsCount++;
      rec.revenue              += rev;
      rec.durationTotalSeconds += s.durationSeconds ?? 0;
      if (s.status === 'ACTIVE')    rec.activeSessionsCount++;
      if (s.status === 'COMPLETED') rec.completedSessionsCount++;
      if (isOutOfRule(s))           rec.outOfRuleSessionsCount++;

      if (s.matchedPlan && s.matchedPlanId) {
        const entry = rec.plans.get(s.matchedPlanId);
        if (entry) {
          entry.count++;
          entry.revenue += rev;
        } else {
          rec.plans.set(s.matchedPlanId, { label: s.matchedPlan.name, count: 1, revenue: rev });
        }
      }
    }

    return chairs.map((c) => {
      const rec = byChair.get(c.id)!;
      return {
        chairId:                c.id,
        chairName:              c.name,
        displayName:            c.displayName,
        sessionsCount:          rec.sessionsCount,
        completedSessionsCount: rec.completedSessionsCount,
        activeSessionsCount:    rec.activeSessionsCount,
        outOfRuleSessionsCount: rec.outOfRuleSessionsCount,
        revenue:                d2(rec.revenue),
        durationTotalSeconds:   rec.durationTotalSeconds,
        plans: Array.from(rec.plans.values()).map((p) => ({
          label:   p.label,
          count:   p.count,
          revenue: d2(p.revenue),
        })),
      };
    });
  }

  // ── Prime revenue ──────────────────────────────────────────────────────────────

  private buildPrimeRevenue(
    shifts: Array<{
      grossRevenue:   Prisma.Decimal | null;
      planCommission: Prisma.Decimal | null;
      targetBonus:    Prisma.Decimal | null;
      manualBonus:    Prisma.Decimal | null;
      totalPrime:     Prisma.Decimal | null;
      netRevenue:     Prisma.Decimal | null;
    }>,
    sessionGrossRevenue: number,
  ) {
    // TODO: Once live prime calculation is wired at session level, replace
    // with a per-session calculation so the filter (period/chair) is respected.
    // Currently we sum shift-close snapshots, which may not align perfectly
    // with the date/chair/period filter applied to sessions.

    if (shifts.length === 0) {
      // No closed shifts in range — return session revenue without any prime deduction
      return {
        grossRevenue:   d2(sessionGrossRevenue),
        planCommission: 0,
        targetBonus:    0,
        manualBonus:    0,
        totalPrime:     0,
        netRevenue:     d2(sessionGrossRevenue),
      };
    }

    let grossRevenue   = 0;
    let planCommission = 0;
    let targetBonus    = 0;
    let manualBonus    = 0;
    let totalPrime     = 0;
    let netRevenue     = 0;

    for (const s of shifts) {
      grossRevenue   += Number(s.grossRevenue   ?? 0);
      planCommission += Number(s.planCommission ?? 0);
      targetBonus    += Number(s.targetBonus    ?? 0);
      manualBonus    += Number(s.manualBonus    ?? 0);
      totalPrime     += Number(s.totalPrime     ?? 0);
      netRevenue     += Number(s.netRevenue     ?? 0);
    }

    return {
      grossRevenue:   d2(grossRevenue),
      planCommission: d2(planCommission),
      targetBonus:    d2(targetBonus),
      manualBonus:    d2(manualBonus),
      totalPrime:     d2(totalPrime),
      netRevenue:     d2(netRevenue),
    };
  }

  // ── Revenue chart ──────────────────────────────────────────────────────────────
  // Buckets the filtered sessions by chartPeriod, anchored on `from`.

  private buildChart(
    sessions: SessionRow[],
    chartPeriod: ChartPeriod,
    from: string,
    tz: string,
  ) {
    const [y, mo, d] = from.split('-').map(Number);

    let labels:    string[];
    let bucketCount: number;
    let getBucket: (local: Date) => number;

    switch (chartPeriod) {
      case 'day':
        bucketCount = 24;
        labels      = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`);
        getBucket   = (dt) => dt.getHours();
        break;

      case 'week': {
        // Week containing `from`, Mon=0 … Sun=6
        bucketCount = 7;
        labels      = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
        getBucket   = (dt) => (dt.getDay() + 6) % 7;
        break;
      }

      case 'month': {
        const daysInMonth = new Date(y, mo, 0).getDate(); // mo is 1-based, so Date(y, mo, 0) = last day of month mo
        bucketCount = daysInMonth;
        labels      = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
        getBucket   = (dt) => dt.getDate() - 1;
        break;
      }

      case 'year':
      default:
        bucketCount = 12;
        labels      = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
        getBucket   = (dt) => dt.getMonth();
        break;
    }

    const revenue      = new Array<number>(bucketCount).fill(0);
    const sessionCount = new Array<number>(bucketCount).fill(0);

    for (const s of sessions) {
      const local  = toLocalDate(s.startedAt, tz);
      const bucket = getBucket(local);
      if (bucket >= 0 && bucket < bucketCount) {
        revenue[bucket]      += sessionRevenue(s);
        sessionCount[bucket] += 1;
      }
    }

    const roundedRevenue = revenue.map(d2);
    return {
      period:        chartPeriod,
      labels,
      revenue:       roundedRevenue,
      sessions:      sessionCount,
      totalRevenue:  d2(roundedRevenue.reduce((a, b) => a + b, 0)),
      totalSessions: sessionCount.reduce((a, b) => a + b, 0),
    };
  }

  // ── Recent sessions ────────────────────────────────────────────────────────────

  private buildRecentSessions(sessions: SessionRow[]) {
    // sessions are already ordered by startedAt DESC; take the 20 most recent
    return sessions.slice(0, 20).map((s) => ({
      id:              s.id,
      chairName:       s.chair.name,
      startedAt:       s.startedAt.toISOString(),
      endedAt:         s.endedAt?.toISOString() ?? null,
      durationSeconds: s.durationSeconds,
      status:          s.status,
      matchedPlanName: s.matchedPlan?.name ?? null,
      amount:          sessionRevenue(s),
      anomalyType:     s.anomalyType,
      billingStatus:   s.billingStatus,
    }));
  }
}

export const homeDashboardService = new HomeDashboardService();
