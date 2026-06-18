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
      const d   = new Date(today + 'T12:00:00Z');
      const dow = d.getUTCDay();
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
  preset?:        string;
  from?:          string;
  to?:            string;
  period?:        string;
  periodStart?:   string;
  periodEnd?:     string;
  chair?:         string;
  staffMemberId?: string;
  shiftTypeId?:   string;
  shiftId?:       string;
  status?:        string;
  chartPeriod?:   string;
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

// ── Light query types for prime data ───────────────────────────────────────────

type CommRuleLight = {
  pricingPlanId: string;
  type:          string;
  value:         Prisma.Decimal;
};

type TargetBonusLight = {
  shiftTypeId:  string;
  targetAmount: Prisma.Decimal;
  bonusAmount:  Prisma.Decimal;
};

type ShiftLight = {
  id:          string;
  shiftTypeId: string | null;
  status:      string;
};

type BonusAdjLight = {
  shiftId: string;
  amount:  Prisma.Decimal;
};

type OpenShiftSessionLight = {
  expectedAmount:  Prisma.Decimal | null;
  correctedAmount: Prisma.Decimal | null;
  status:          string;
  matchedPlanId:   string | null;
  billingStatus:   string;
  anomalyType:     string | null;
};

// ── Session helpers ────────────────────────────────────────────────────────────

function sessionRevenue(s: SessionRow): number {
  if (s.status === 'ACTIVE') return 0;
  const val = s.correctedAmount ?? s.expectedAmount;
  return val ? Number(val) : 0;
}

// Anomaly types that are real billing problems requiring owner attention.
const BLOCKING_ANOMALIES = new Set([
  'TOO_SHORT',
  'NO_PLAN_MATCH',
  'NO_OPEN_SHIFT',
  'OFFLINE_DURING_SESSION',
  'DEVICE_ERROR',
  'POWER_NOT_FOUND',
  'SESSION_PENDING',
  'MANUAL_REVIEW_REQUIRED',
]);

// Anomaly types that are informational duration badges — the session is still
// priced correctly and should not be treated as a billing problem.
// TODO: future option — bill long continuous sessions as multiple consecutive
// plan blocks (e.g., two 30-min slots at 100 DH) to handle the case where two
// customers use the chair back-to-back without a power-off gap. MVP uses last plan.
const INFORMATIONAL_ANOMALIES = new Set(['TOO_LONG', 'LONG', 'DURATION_EXCEEDED']);

function isOutOfRule(s: SessionRow): boolean {
  // Technical session errors always require attention.
  if (s.status === 'UNCERTAIN' || s.status === 'ERROR') return true;
  // DISPUTED billing requires explicit owner resolution.
  if (s.billingStatus === 'DISPUTED') return true;

  const anomalies = s.anomalyType?.split(',').map((a) => a.trim()) ?? [];
  const isBilled  = s.billingStatus === 'CALCULATED' || s.billingStatus === 'CORRECTED';

  // PENDING: out of rule unless the ONLY anomaly is a duration badge (TOO_LONG).
  // TOO_LONG+PENDING is legacy data — PricingService now writes CALCULATED for this.
  if (s.billingStatus === 'PENDING') {
    const isOnlyDurationBadge =
      anomalies.length > 0 && anomalies.every((a) => INFORMATIONAL_ANOMALIES.has(a));
    return !isOnlyDurationBadge;
  }

  // Billed sessions: only flag if a real blocking anomaly is present.
  // TOO_LONG/LONG with a calculated price are informational — not rule violations.
  if (isBilled) return anomalies.some((a) => BLOCKING_ANOMALIES.has(a));

  // Any other unexpected billing state is flagged for safety.
  return true;
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

    // ── Resolve preset → date range ───────────────────────────────────────────
    const preset = (VALID_PRESETS.includes(raw.preset as Preset) ? raw.preset : 'custom') as Preset;
    let from: string;
    let to:   string;
    if (preset !== 'custom') {
      ({ from, to } = resolvePresetDates(preset, today));
    } else {
      from = raw.from || today;
      to   = raw.to   || today;
    }

    // ── Normalize other params ────────────────────────────────────────────────
    const period        = (VALID_PERIODS.includes(raw.period as Period) ? raw.period : 'all') as Period;
    const chair         = raw.chair         || 'all';
    const staffMemberId = raw.staffMemberId || 'all';
    const shiftTypeId   = raw.shiftTypeId   || 'all';
    const shiftId       = raw.shiftId       || 'all';
    const statusFilter  = (VALID_STATUSES.includes(raw.status as StatusFilter) ? raw.status : 'all') as StatusFilter;
    const chartPeriod   = (VALID_CHART_P.includes(raw.chartPeriod as ChartPeriod) ? raw.chartPeriod : 'day') as ChartPeriod;

    // ── Date range → UTC ──────────────────────────────────────────────────────
    const utcStart = localMidnightUTC(from, tz);
    const utcEnd   = localMidnightUTC(addDays(to, 1), tz);

    // ── Time-of-day window ────────────────────────────────────────────────────
    const periodWindow = await this.resolvePeriodWindow(period, raw.periodStart, raw.periodEnd);

    // ── Chair filter ──────────────────────────────────────────────────────────
    let chairDbId: string | undefined;
    if (chair !== 'all') {
      const dbChair = await prisma.chair.findFirst({
        where:  { OR: [{ name: chair }, { id: chair }] },
        select: { id: true },
      });
      chairDbId = dbChair?.id ?? undefined;
    }

    // ── Shift/staff WHERE fragment ────────────────────────────────────────────
    const shiftRelFilter =
      staffMemberId !== 'all' || shiftTypeId !== 'all'
        ? {
            ...(staffMemberId !== 'all' ? { staffMemberId } : {}),
            ...(shiftTypeId   !== 'all' ? { shiftTypeId }   : {}),
          }
        : undefined;

    // ── Status WHERE condition ────────────────────────────────────────────────
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

    // ── Session WHERE clause ──────────────────────────────────────────────────
    const sessionWhere: Prisma.ChairSessionWhereInput = {
      startedAt: { gte: utcStart, lt: utcEnd },
      ...(chairDbId ? { chairId: chairDbId } : {}),
      ...(shiftId !== 'all'
        ? { shiftId }
        : shiftRelFilter
        ? { shift: shiftRelFilter }
        : {}),
      ...statusCond,
    };

    // ── Shift filter options WHERE ─────────────────────────────────────────────
    const rangeShiftsWhere: Prisma.ShiftWhereInput = {
      startedAt: { gte: utcStart, lt: utcEnd },
      ...(staffMemberId !== 'all' ? { staffMemberId } : {}),
      ...(shiftTypeId   !== 'all' ? { shiftTypeId }   : {}),
    };

    // ── Batch 1: core data + lookup tables + commission rule tables ────────────
    const [
      dbChairs,
      sessions,
      allStaff,
      allShiftTypes,
      rangeShifts,
      currentShiftRow,
      allActiveCommRules,
      allTargetBonusRules,
    ] = await Promise.all([
      prisma.chair.findMany({
        where:   { isEnabled: true },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true, displayName: true, status: true, currentPowerWatts: true, isOnline: true },
      }),
      prisma.chairSession.findMany({
        where:   sessionWhere,
        select:  SESSION_SELECT,
        orderBy: { startedAt: 'desc' },
      }),
      prisma.staffMember.findMany({
        where:   { isActive: true },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true },
      }),
      prisma.shiftType.findMany({
        where:   { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select:  { id: true, name: true, label: true },
      }),
      prisma.shift.findMany({
        where:   rangeShiftsWhere,
        orderBy: { startedAt: 'desc' },
        take:    100,
        select: {
          id: true, status: true, startedAt: true,
          staffMember: { select: { name: true } },
          shiftType:   { select: { label: true } },
        },
      }),
      // Current OPEN shift for the shift-summary card
      prisma.shift.findFirst({
        where:   { status: 'OPEN' },
        orderBy: { startedAt: 'desc' },
        select: {
          id:             true,
          startedAt:      true,
          scheduledEndAt: true,
          staffMember: { select: { name: true } },
          shiftType:   { select: { label: true } },
        },
      }),
      // All currently active commission rules (small table — no date-validity check
      // here because the home dashboard is in estimation mode; historical accuracy
      // is handled by PrimeCalculationService used in the shift detail view)
      prisma.commissionRule.findMany({
        where:  { isActive: true },
        select: { pricingPlanId: true, type: true, value: true },
      }) as Promise<CommRuleLight[]>,
      // All active target-bonus rules sorted desc so first match = highest threshold
      prisma.shiftTargetBonusRule.findMany({
        where:   { isActive: true },
        orderBy: { targetAmount: 'desc' },
        select:  { shiftTypeId: true, targetAmount: true, bonusAmount: true },
      }) as Promise<TargetBonusLight[]>,
    ]);

    // ── Time-of-day filter ────────────────────────────────────────────────────
    const filtered: SessionRow[] = periodWindow
      ? sessions.filter((s) => {
          const local    = toLocalDate(s.startedAt, tz);
          const localMin = local.getHours() * 60 + local.getMinutes();
          return localMin >= periodWindow[0] && localMin < periodWindow[1];
        })
      : sessions;

    // ── Batch 2: shift context for prime + open-shift live sessions ────────────
    const uniqueShiftIdsFromFiltered: string[] = [
      ...new Set(
        filtered
          .map((s) => s.shiftId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const [shiftsForPrime, bonusAdjustments, openShiftSessions] = await Promise.all([
      uniqueShiftIdsFromFiltered.length > 0
        ? (prisma.shift.findMany({
            where:  { id: { in: uniqueShiftIdsFromFiltered } },
            select: { id: true, shiftTypeId: true, status: true },
          }) as Promise<ShiftLight[]>)
        : Promise.resolve([] as ShiftLight[]),
      uniqueShiftIdsFromFiltered.length > 0
        ? (prisma.shiftBonusAdjustment.findMany({
            where:  { shiftId: { in: uniqueShiftIdsFromFiltered } },
            select: { shiftId: true, amount: true },
          }) as Promise<BonusAdjLight[]>)
        : Promise.resolve([] as BonusAdjLight[]),
      // All sessions in the currently OPEN shift (unfiltered — for the shift card)
      currentShiftRow
        ? (prisma.chairSession.findMany({
            where:  { shiftId: currentShiftRow.id, status: { not: 'CANCELLED' } },
            select: {
              expectedAmount:  true,
              correctedAmount: true,
              status:          true,
              matchedPlanId:   true,
              billingStatus:   true,
              anomalyType:     true,
            },
          }) as Promise<OpenShiftSessionLight[]>)
        : Promise.resolve([] as OpenShiftSessionLight[]),
    ]);

    // ── Assemble sections ─────────────────────────────────────────────────────
    const summary    = this.buildSummary(filtered, dbChairs);
    const prime      = this.buildPrimeRevenueInline(
      filtered,
      allActiveCommRules,
      allTargetBonusRules,
      shiftsForPrime,
      bonusAdjustments,
      summary.grossRevenue,
    );
    const liveChairs = this.buildLiveChairs(dbChairs);
    const byChair    = this.buildTotalsByChair(filtered, dbChairs);
    const chart      = this.buildChart(filtered, chartPeriod, from, tz);
    const sessionsTable = this.buildSessionsTable(filtered);

    // ── Filter options ────────────────────────────────────────────────────────
    const seenShiftIds = new Set<string>();
    const uniqueRangeShifts = rangeShifts.filter((sh) => {
      if (seenShiftIds.has(sh.id)) return false;
      seenShiftIds.add(sh.id);
      return true;
    });

    const filterOptions = {
      chairs:       dbChairs.map((c) => ({ id: c.id, name: c.name, displayName: c.displayName })),
      staffMembers: allStaff.map((s) => ({ id: s.id, name: s.name })),
      shiftTypes:   allShiftTypes.map((st) => ({ id: st.id, label: st.label ?? st.name })),
      shifts: uniqueRangeShifts.map((sh) => ({
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

    // ── Current shift — live numbers from open-shift sessions ─────────────────
    // Reads the snapshot columns for CLOSED shifts only when the UI explicitly
    // navigates to them. For the OPEN shift we always calculate live so the
    // owner sees real-time revenue as sessions complete throughout the day.
    const currentShift = currentShiftRow
      ? this.buildCurrentShiftLive(
          currentShiftRow,
          openShiftSessions,
          allActiveCommRules,
        )
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
      sessionsTable,
    };
  }

  // ── Period window ──────────────────────────────────────────────────────────────

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
      if (s.status      === 'ACTIVE')    activeSessionsCount++;
      if (s.status      === 'COMPLETED') completedSessionsCount++;
      if (s.billingStatus === 'PENDING')  pendingSessionsCount++;
      if (s.billingStatus === 'CORRECTED' || s.correctedAmount !== null) correctedSessionsCount++;
      if (isOutOfRule(s)) outOfRuleSessionsCount++;
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
      sessionsCount:          number;
      completedSessionsCount: number;
      activeSessionsCount:    number;
      outOfRuleSessionsCount: number;
      revenue:                number;
      durationTotalSeconds:   number;
      plans: Map<string, { label: string; count: number; revenue: number }>;
    };

    const byChair = new Map<string, ChairAccum>(
      chairs.map((c) => [c.id, {
        sessionsCount: 0, completedSessionsCount: 0,
        activeSessionsCount: 0, outOfRuleSessionsCount: 0,
        revenue: 0, durationTotalSeconds: 0,
        plans: new Map(),
      }]),
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

  // ── Prime revenue — inline estimation ─────────────────────────────────────────
  // Applies currently active rules to filtered sessions WITHOUT the validFrom/validTo
  // date check used by PrimeCalculationService. This gives the owner an accurate
  // estimate of what the commission looks like under the current ruleset, even when
  // sessions predate today's rule activation.
  //
  // isEstimated = true whenever any shift in the filtered set is still OPEN.
  // The shift detail view (PrimeCalculationService) uses the stricter historical check.

  private buildPrimeRevenueInline(
    sessions:         SessionRow[],
    commRules:        CommRuleLight[],
    targetBonusRules: TargetBonusLight[],  // sorted desc by targetAmount
    shifts:           ShiftLight[],
    bonusAdj:         BonusAdjLight[],
    sessionGrossRevenue: number,
  ) {
    // ── Plan commission ───────────────────────────────────────────────────────
    let planCommission                    = 0;
    let eligibleCommissionSessionsCount   = 0;
    let excludedCommissionSessionsCount   = 0;
    let pendingSessionsCount              = 0;

    for (const s of sessions) {
      // Only COMPLETED sessions generate commission
      if (s.status !== 'COMPLETED') continue;
      if (!s.matchedPlanId) continue;

      const finalAmount =
        s.correctedAmount !== null ? Number(s.correctedAmount) :
        s.expectedAmount  !== null ? Number(s.expectedAmount)  : 0;

      if (finalAmount <= 0) { excludedCommissionSessionsCount++; continue; }

      // TOO_SHORT always excluded from commission (amount=0, no valid plan).
      if (s.anomalyType?.split(',').includes('TOO_SHORT')) {
        excludedCommissionSessionsCount++;
        continue;
      }

      // DISPUTED requires explicit owner resolution before commission.
      if (s.billingStatus === 'DISPUTED') {
        excludedCommissionSessionsCount++;
        continue;
      }

      // PENDING + TOO_LONG: valid plan/price exists — eligible, same as CALCULATED.
      // PENDING without TOO_LONG anomaly means pricing genuinely failed → exclude.
      if (s.billingStatus === 'PENDING') {
        const isTooLong = s.anomalyType?.split(',').includes('TOO_LONG') ?? false;
        if (!isTooLong) {
          pendingSessionsCount++;
          excludedCommissionSessionsCount++;
          continue;
        }
        // fall through — TOO_LONG PENDING is treated as CALCULATED below
      } else if (s.billingStatus !== 'CALCULATED' && s.billingStatus !== 'CORRECTED') {
        excludedCommissionSessionsCount++;
        continue;
      }

      // Find active rule for this plan (no date-validity check — estimation mode)
      const rule = commRules.find((r) => r.pricingPlanId === s.matchedPlanId);
      if (!rule) continue;  // no rule for this plan → 0 commission (correct)

      const commission =
        rule.type === 'PERCENTAGE'
          ? d2(finalAmount * Number(rule.value) / 100)
          : Number(rule.value);

      planCommission += commission;
      eligibleCommissionSessionsCount++;
    }
    planCommission = d2(planCommission);

    // ── Target bonus — per shift, based on sessions in the filter ─────────────
    // Build shift → filtered-session gross revenue map
    const shiftGrossMap = new Map<string, number>();
    for (const s of sessions) {
      if (!s.shiftId) continue;
      const rev = sessionRevenue(s);
      shiftGrossMap.set(s.shiftId, (shiftGrossMap.get(s.shiftId) ?? 0) + rev);
    }

    let targetBonus = 0;
    for (const shift of shifts) {
      if (!shift.shiftTypeId) continue;
      const shiftGross = shiftGrossMap.get(shift.id) ?? 0;
      if (shiftGross <= 0) continue;
      // Highest matching threshold (rules sorted desc)
      const bonusRule = targetBonusRules.find(
        (r) => r.shiftTypeId === shift.shiftTypeId && Number(r.targetAmount) <= shiftGross,
      );
      if (bonusRule) targetBonus += Number(bonusRule.bonusAmount);
    }
    targetBonus = d2(targetBonus);

    // ── Manual bonus — sum of adjustments on shifts in this filter ────────────
    let manualBonus = 0;
    for (const adj of bonusAdj) {
      manualBonus += Number(adj.amount);
    }
    manualBonus = d2(manualBonus);

    const totalPrime = d2(planCommission + targetBonus + manualBonus);

    return {
      grossRevenue:                    d2(sessionGrossRevenue),
      planCommission,
      targetBonus,
      manualBonus,
      totalPrime,
      netRevenue:                      d2(sessionGrossRevenue - totalPrime),
      isEstimated:                     shifts.some((sh) => sh.status === 'OPEN'),
      eligibleCommissionSessionsCount,
      excludedCommissionSessionsCount,
      pendingSessionsCount,
    };
  }

  // ── Current shift — live from its actual sessions ─────────────────────────────
  // The Shift table's grossRevenue/totalPrime/netRevenue snapshot columns are only
  // written at close time. For OPEN shifts we compute them live so the card always
  // shows real-time values.

  private buildCurrentShiftLive(
    row: {
      id:             string;
      startedAt:      Date;
      scheduledEndAt: Date | null;
      staffMember:    { name: string };
      shiftType:      { label: string | null } | null;
    },
    sessions: OpenShiftSessionLight[],
    commRules: CommRuleLight[],
  ) {
    let grossRevenue   = 0;
    let planCommission = 0;

    for (const s of sessions) {
      if (s.status === 'ACTIVE') continue;
      const amt =
        s.correctedAmount !== null ? Number(s.correctedAmount) :
        s.expectedAmount  !== null ? Number(s.expectedAmount)  : 0;
      grossRevenue += amt;

      // Commission eligibility (mirrors buildPrimeRevenueInline logic)
      if (s.status !== 'COMPLETED')  continue;
      if (!s.matchedPlanId)          continue;
      if (amt <= 0)                  continue;
      if (s.anomalyType?.split(',').includes('TOO_SHORT')) continue;
      if (s.billingStatus === 'DISPUTED') continue;
      // PENDING+TOO_LONG is eligible (valid plan/price); plain PENDING is not.
      if (s.billingStatus === 'PENDING' && !s.anomalyType?.split(',').includes('TOO_LONG')) continue;

      const rule = commRules.find((r) => r.pricingPlanId === s.matchedPlanId);
      if (!rule) continue;

      planCommission +=
        rule.type === 'PERCENTAGE'
          ? d2(amt * Number(rule.value) / 100)
          : Number(rule.value);
    }

    const totalPrime = d2(planCommission);

    return {
      id:              row.id,
      staffMemberName: row.staffMember.name,
      shiftTypeLabel:  row.shiftType?.label ?? null,
      startedAt:       row.startedAt.toISOString(),
      scheduledEndAt:  row.scheduledEndAt?.toISOString() ?? null,
      grossRevenue:    d2(grossRevenue),
      totalPrime,
      netRevenue:      d2(grossRevenue - totalPrime),
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

  // ── Sessions table ─────────────────────────────────────────────────────────────
  // Returns ALL sessions matching the applied filters, ordered by startedAt DESC.
  // No row cap — the client displays the full list and scrolls the page.

  private buildSessionsTable(sessions: SessionRow[]) {
    const items = sessions.map((s) => {
      const finalAmount =
        s.status === 'ACTIVE'           ? 0 :
        s.correctedAmount !== null       ? Number(s.correctedAmount) :
        s.expectedAmount  !== null       ? Number(s.expectedAmount)  : 0;

      return {
        id:               s.id,
        chairName:        s.chair.name,
        staffMemberName:  s.shift?.staffMember?.name ?? null,
        shiftTypeLabel:   s.shift?.shiftType?.label  ?? null,
        startedAt:        s.startedAt.toISOString(),
        endedAt:          s.endedAt?.toISOString()   ?? null,
        durationSeconds:  s.durationSeconds,
        status:           s.status,
        matchedPlanName:  s.matchedPlan?.name        ?? null,
        amount:           sessionRevenue(s),
        finalAmount,
        expectedAmount:   s.expectedAmount  != null ? Number(s.expectedAmount)  : null,
        correctedAmount:  s.correctedAmount != null ? Number(s.correctedAmount) : null,
        correctionReason: s.correctionReason ?? null,
        anomalyType:      s.anomalyType,
        billingStatus:    s.billingStatus,
        isOutOfRule:      isOutOfRule(s),
      };
    });
    return { items, total: items.length };
  }
}

export const homeDashboardService = new HomeDashboardService();
