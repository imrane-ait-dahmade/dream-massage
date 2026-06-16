import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { getTimezone } from '../../utils/time';

// ── Helpers ────────────────────────────────────────────────────────────────────

function toLocalDate(date: Date, tz: string): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: tz }));
}

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

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function d2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Preset date resolver ───────────────────────────────────────────────────────

function resolvePresetDates(preset: string, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'week': {
      // Monday → Sunday of current week
      const d   = new Date(today + 'T12:00:00Z');
      const dow = d.getUTCDay(); // 0=Sun … 6=Sat
      const mon = addDays(today, -((dow + 6) % 7));
      return { from: mon, to: addDays(mon, 6) };
    }
    case 'month': {
      const [y, mo] = today.split('-').map(Number);
      const first = `${y}-${String(mo).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const last = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { from: first, to: last };
    }
    case 'year': {
      const y = today.slice(0, 4);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: today, to: today };
  }
}

// ── Constants ──────────────────────────────────────────────────────────────────

const VALID_PERIODS  = ['all', 'matin', 'soir', 'journee', 'custom'] as const;
const VALID_CHART_P  = ['day', 'week', 'month', 'year'] as const;
const VALID_PRESETS  = ['today', 'yesterday', 'week', 'month', 'year', 'custom'] as const;
const VALID_STATUSES = ['all', 'ACTIVE', 'COMPLETED', 'PENDING', 'CORRECTED', 'ANOMALY'] as const;

type Period       = (typeof VALID_PERIODS)[number];
type ChartPeriod  = (typeof VALID_CHART_P)[number];
type Preset       = (typeof VALID_PRESETS)[number];
type StatusFilter = (typeof VALID_STATUSES)[number];

// ── Param type ─────────────────────────────────────────────────────────────────

export interface HomeDashboardParams {
  preset?:       string;
  from?:         string;
  to?:           string;
  period?:       string;
  periodStart?:  string;
  periodEnd?:    string;
  chair?:        string;
  staffMemberId?: string;
  shiftTypeId?:  string;
  shiftId?:      string;
  status?:       string;
  chartPeriod?:  string;
}

// ── Prisma select ──────────────────────────────────────────────────────────────

const SESSION_SELECT = {
  id:               true,
  chairId:          true,
  shiftId:          true,
  status:           true,
  startedAt:        true,
  endedAt:          true,
  durationSeconds:  true,
  expectedAmount:   true,
  correctedAmount:  true,
  correctionReason: true,
  anomalyType:      true,
  billingStatus:    true,
  matchedPlanId:    true,
  chair:       { select: { id: true, name: true, displayName: true } },
  matchedPlan: { select: { id: true, name: true } },
  shift: {
    select: {
      id:          true,
      staffMember: { select: { name: true } },
      shiftType:   { select: { label: true } },
    },
  },
} as const;

type SessionRow = Prisma.ChairSessionGetPayload<{ select: typeof SESSION_SELECT }>;

// Revenue for one session — ACTIVE sessions are never counted as revenue
function sessionRevenue(s: SessionRow): number {
  if (s.status === 'ACTIVE') return 0;
  const val = s.correctedAmount ?? s.expectedAmount;
  return val ? Number(val) : 0;
}

function isOutOfRule(s: SessionRow): boolean {
  return (
    s.anomalyType  !== null ||
    s.billingStatus === 'PENDING' ||
    s.status        === 'UNCERTAIN' ||
    s.status        === 'ERROR'
  );
}

function warningFor(status: string): string | null {
  if (status === 'MAYBE_FINISHED') return 'Fin possible';
  if (status === 'OFFLINE')        return 'Appareil injoignable';
  if (status === 'ERROR')          return 'Erreur appareil';
  return null;
}

// ── Service ────────────────────────────────────────────────────────────────────

export class HomeDashboardService {
  async get(raw: HomeDashboardParams) {
    const tz    = getTimezone();
    const today = todayInTz(tz);

    // ── Resolve preset → date range ────────────────────────────────────────────
    const preset = (VALID_PRESETS.includes(raw.preset as Preset) ? raw.preset : 'custom') as Preset;
    let from: string;
    let to:   string;
    if (preset !== 'custom') {
      ({ from, to } = resolvePresetDates(preset, today));
    } else {
      from = raw.from || today;
      to   = raw.to   || today;
    }

    // ── Normalize other params ─────────────────────────────────────────────────
    const period        = (VALID_PERIODS.includes(raw.period as Period) ? raw.period : 'all') as Period;
    const chair         = raw.chair         || 'all';
    const staffMemberId = raw.staffMemberId || 'all';
    const shiftTypeId   = raw.shiftTypeId   || 'all';
    const shiftId       = raw.shiftId       || 'all';
    const statusFilter  = (VALID_STATUSES.includes(raw.status as StatusFilter) ? raw.status : 'all') as StatusFilter;
    const chartPeriod   = (VALID_CHART_P.includes(raw.chartPeriod as ChartPeriod) ? raw.chartPeriod : 'day') as ChartPeriod;

    // ── Date range → UTC ───────────────────────────────────────────────────────
    const utcStart = localMidnightUTC(from, tz);
    const utcEnd   = localMidnightUTC(addDays(to, 1), tz);

    // ── Time-of-day window ─────────────────────────────────────────────────────
    const periodWindow = await this.resolvePeriodWindow(period, raw.periodStart, raw.periodEnd);

    // ── Chair filter ───────────────────────────────────────────────────────────
    let chairDbId: string | undefined;
    if (chair !== 'all') {
      const dbChair = await prisma.chair.findFirst({
        where: { OR: [{ name: chair }, { id: chair }] },
        select: { id: true },
      });
      chairDbId = dbChair?.id ?? undefined;
    }

    // ── Shift/staff WHERE fragment ─────────────────────────────────────────────
    const shiftRelFilter =
      staffMemberId !== 'all' || shiftTypeId !== 'all'
        ? {
            ...(staffMemberId !== 'all' ? { staffMemberId } : {}),
            ...(shiftTypeId   !== 'all' ? { shiftTypeId }   : {}),
          }
        : undefined;

    // ── Status WHERE condition ─────────────────────────────────────────────────
    let statusCond: Prisma.ChairSessionWhereInput;
    switch (statusFilter) {
      case 'ACTIVE':
        statusCond = { status: 'ACTIVE' };
        break;
      case 'COMPLETED':
        statusCond = { status: 'COMPLETED' };
        break;
      case 'PENDING':
        statusCond = { status: { not: 'CANCELLED' }, billingStatus: 'PENDING' };
        break;
      case 'CORRECTED':
        statusCond = {
          status: { not: 'CANCELLED' },
          OR: [{ billingStatus: 'CORRECTED' }, { correctedAmount: { not: null } }],
        };
        break;
      case 'ANOMALY':
        statusCond = { status: { not: 'CANCELLED' }, anomalyType: { not: null } };
        break;
      default:
        statusCond = { status: { not: 'CANCELLED' } };
        break;
    }

    // ── Session WHERE clause ───────────────────────────────────────────────────
    const sessionWhere: Prisma.ChairSessionWhereInput = {
      startedAt: { gte: utcStart, lt: utcEnd },
      ...(chairDbId                    ? { chairId: chairDbId } : {}),
      ...(shiftId !== 'all'            ? { shiftId }            : {}),
      ...(shiftRelFilter               ? { shift: shiftRelFilter } : {}),
      ...statusCond,
    };

    // ── Parallel DB fetches ────────────────────────────────────────────────────
    const [
      dbChairs,
      sessions,
      closedShifts,
      allStaff,
      allShiftTypes,
      rangeShifts,
      currentShiftRow,
    ] = await Promise.all([
      // All enabled chairs (for live grid + filterOptions)
      prisma.chair.findMany({
        where:   { isEnabled: true },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true, displayName: true, status: true, currentPowerWatts: true, isOnline: true },
      }),
      // Filtered sessions
      prisma.chairSession.findMany({
        where:   sessionWhere,
        select:  SESSION_SELECT,
        orderBy: { startedAt: 'desc' },
      }),
      // Closed shifts in range → prime snapshots
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
      // All active staff members → filter dropdown
      prisma.staffMember.findMany({
        where:   { isActive: true },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true },
      }),
      // All active shift types → filter dropdown
      prisma.shiftType.findMany({
        where:   { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select:  { id: true, name: true, label: true },
      }),
      // Recent shifts in the date range → shift filter dropdown
      prisma.shift.findMany({
        where:   { startedAt: { gte: utcStart, lt: utcEnd } },
        orderBy: { startedAt: 'desc' },
        take:    50,
        select: {
          id: true, status: true, startedAt: true,
          staffMember: { select: { name: true } },
          shiftType:   { select: { label: true } },
        },
      }),
      // Current open shift (most recent)
      prisma.shift.findFirst({
        where:   { status: 'OPEN' },
        orderBy: { startedAt: 'desc' },
        select: {
          id:             true,
          startedAt:      true,
          scheduledEndAt: true,
          grossRevenue:   true,
          totalPrime:     true,
          netRevenue:     true,
          staffMember: { select: { name: true } },
          shiftType:   { select: { label: true } },
        },
      }),
    ]);

    // ── Time-of-day filter ─────────────────────────────────────────────────────
    const filtered: SessionRow[] = periodWindow
      ? sessions.filter((s) => {
          const local    = toLocalDate(s.startedAt, tz);
          const localMin = local.getHours() * 60 + local.getMinutes();
          return localMin >= periodWindow[0] && localMin < periodWindow[1];
        })
      : sessions;

    // ── Assemble response ──────────────────────────────────────────────────────
    const summary    = this.buildSummary(filtered, dbChairs);
    const prime      = this.buildPrimeRevenue(closedShifts, summary.grossRevenue);
    const liveChairs = this.buildLiveChairs(dbChairs);
    const byChair    = this.buildTotalsByChair(filtered, dbChairs);
    const chart      = this.buildChart(filtered, chartPeriod, from, tz);
    const recent     = this.buildRecentSessions(filtered);

    const filterOptions = {
      chairs: dbChairs.map((c) => ({
        id: c.id, name: c.name, displayName: c.displayName,
      })),
      staffMembers: allStaff.map((s) => ({ id: s.id, name: s.name })),
      shiftTypes:   allShiftTypes.map((st) => ({ id: st.id, label: st.label ?? st.name })),
      shifts: rangeShifts.map((sh) => ({
        id:     sh.id,
        label:  [
          sh.shiftType?.label,
          sh.staffMember.name,
          new Date(sh.startedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        ].filter(Boolean).join(' - '),
        staffMemberName: sh.staffMember.name,
        shiftTypeLabel:  sh.shiftType?.label ?? null,
        status:          sh.status,
      })),
    };

    const currentShift = currentShiftRow
      ? {
          id:              currentShiftRow.id,
          staffMemberName: currentShiftRow.staffMember.name,
          shiftTypeLabel:  currentShiftRow.shiftType?.label ?? null,
          startedAt:       currentShiftRow.startedAt.toISOString(),
          scheduledEndAt:  currentShiftRow.scheduledEndAt?.toISOString() ?? null,
          grossRevenue:    Number(currentShiftRow.grossRevenue  ?? 0),
          totalPrime:      Number(currentShiftRow.totalPrime    ?? 0),
          netRevenue:      Number(currentShiftRow.netRevenue    ?? 0),
        }
      : null;

    return {
      filters: {
        preset, from, to, period, chair,
        staffMemberId, shiftTypeId, shiftId, status: statusFilter, chartPeriod,
      },
      filterOptions,
      currentShift,
      summary: {
        grossRevenue:           summary.grossRevenue,
        netRevenue:             d2(summary.grossRevenue - prime.totalPrime),
        sessionsCount:          summary.sessionsCount,
        completedSessionsCount: summary.completedSessionsCount,
        activeSessionsCount:    summary.activeSessionsCount,
        pendingSessionsCount:   summary.pendingSessionsCount,
        correctedSessionsCount: summary.correctedSessionsCount,
        outOfRuleSessionsCount: summary.outOfRuleSessionsCount,
        activeChairs:           summary.activeChairs,
        offlineChairs:          summary.offlineChairs,
        totalPrime:             prime.totalPrime,
      },
      liveChairs,
      totalsByChair:  byChair,
      primeRevenue:   prime,
      revenueChart:   chart,
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
    const st = await prisma.shiftType.findFirst({
      where:  { name: { equals: period, mode: 'insensitive' }, isActive: true },
      select: { startTime: true, endTime: true },
    });
    if (st) return [parseHHmm(st.startTime), parseHHmm(st.endTime)];
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

  private buildSummary(sessions: SessionRow[], chairs: Array<{ status: string }>) {
    let grossRevenue           = 0;
    let sessionsCount          = 0;
    let completedSessionsCount = 0;
    let activeSessionsCount    = 0;
    let pendingSessionsCount   = 0;
    let correctedSessionsCount = 0;
    let outOfRuleSessionsCount = 0;

    for (const s of sessions) {
      sessionsCount++;
      grossRevenue += sessionRevenue(s);
      if (s.status    === 'ACTIVE')    activeSessionsCount++;
      if (s.status    === 'COMPLETED') completedSessionsCount++;
      if (s.billingStatus === 'PENDING')   pendingSessionsCount++;
      if (s.billingStatus === 'CORRECTED' || s.correctedAmount !== null) correctedSessionsCount++;
      if (isOutOfRule(s))              outOfRuleSessionsCount++;
    }

    return {
      grossRevenue:           d2(grossRevenue),
      sessionsCount,
      completedSessionsCount,
      activeSessionsCount,
      pendingSessionsCount,
      correctedSessionsCount,
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
        if (entry) { entry.count++; entry.revenue += rev; }
        else        rec.plans.set(s.matchedPlanId, { label: s.matchedPlan.name, count: 1, revenue: rev });
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
          label: p.label, count: p.count, revenue: d2(p.revenue),
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
    if (shifts.length === 0) {
      return {
        grossRevenue:   d2(sessionGrossRevenue),
        planCommission: 0,
        targetBonus:    0,
        manualBonus:    0,
        totalPrime:     0,
        netRevenue:     d2(sessionGrossRevenue),
      };
    }
    let grossRevenue = 0, planCommission = 0, targetBonus = 0, manualBonus = 0, totalPrime = 0, netRevenue = 0;
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

  private buildChart(
    sessions: SessionRow[],
    chartPeriod: ChartPeriod,
    from: string,
    tz: string,
  ) {
    const [y, mo] = from.split('-').map(Number);
    let labels: string[], bucketCount: number, getBucket: (local: Date) => number;

    switch (chartPeriod) {
      case 'day':
        bucketCount = 24;
        labels      = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`);
        getBucket   = (dt) => dt.getHours();
        break;
      case 'week':
        bucketCount = 7;
        labels      = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
        getBucket   = (dt) => (dt.getDay() + 6) % 7;
        break;
      case 'month': {
        const daysInMonth = new Date(y, mo, 0).getDate();
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
    return sessions.slice(0, 20).map((s) => {
      const finalAmount =
        s.status === 'ACTIVE'           ? 0 :
        s.correctedAmount !== null       ? Number(s.correctedAmount) :
        s.expectedAmount  !== null       ? Number(s.expectedAmount)  : 0;

      return {
        id:               s.id,
        chairName:        s.chair.name,
        staffMemberName:  s.shift?.staffMember?.name  ?? null,
        shiftTypeLabel:   s.shift?.shiftType?.label   ?? null,
        startedAt:        s.startedAt.toISOString(),
        endedAt:          s.endedAt?.toISOString()    ?? null,
        durationSeconds:  s.durationSeconds,
        status:           s.status,
        matchedPlanName:  s.matchedPlan?.name         ?? null,
        amount:           sessionRevenue(s),
        finalAmount,
        expectedAmount:   s.expectedAmount  != null ? Number(s.expectedAmount)  : null,
        correctedAmount:  s.correctedAmount != null ? Number(s.correctedAmount) : null,
        correctionReason: s.correctionReason ?? null,
        anomalyType:      s.anomalyType,
        billingStatus:    s.billingStatus,
      };
    });
  }
}

export const homeDashboardService = new HomeDashboardService();
