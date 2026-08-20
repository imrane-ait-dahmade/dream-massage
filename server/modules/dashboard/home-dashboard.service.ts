import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { getTimezone } from '../../utils/time';
import { STAFF_VISIBLE_WHERE, SESSION_OPERATIONAL_WHERE } from '../archive/archive-filters';
import { cacheGet, cacheSet, cacheInvalidate } from '../../utils/memory-cache';
import { withDbCircuit } from '../../utils/db-circuit-breaker';
import { usageMetrics } from '../../utils/usage-metrics';
import { env } from '../../config/env';
import {
  resolvePresetDates,
  todayBusinessDate,
  type DashboardPreset,
} from './date-range';
import {
  normalizeDashboardFilters,
  buildDashboardSessionWhere,
  buildDashboardShiftsWhere,
} from './dashboard-filters';
import {
  d2,
  sessionRevenue,
  isOutOfRule,
  emptySummary,
  emptyPrime,
  emptyChart,
  emptyChairMap,
  absorbSummary,
  absorbChair,
  absorbChart,
  absorbPrime,
  finalizeSummary,
  finalizeChart,
  type MetricsSession,
  type CommRule,
  type ChairAccum,
} from './session-metrics.logic';

// ── Helpers ────────────────────────────────────────────────────────────────────

function toLocalDate(date: Date, tz: string): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: tz }));
}

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── Constants ──────────────────────────────────────────────────────────────────

const VALID_PERIODS  = ['all', 'matin', 'soir', 'custom'] as const;
const VALID_CHART_P  = ['day', 'week', 'month', 'year'] as const;
const VALID_PRESETS  = ['today', 'yesterday', 'week', 'month', 'year', 'custom'] as const;
const VALID_STATUSES = ['all', 'ACTIVE', 'COMPLETED', 'PENDING', 'CORRECTED', 'ANOMALY'] as const;

/** Batch size for stats streaming — NOT a total cap. */
const STATS_BATCH_SIZE = 1000;
/** Recent sessions table only (never used for KPIs). */
const SESSIONS_TABLE_LIMIT = 50;
/** Shift filter dropdown — UI convenience only. */
const SHIFT_OPTIONS_LIMIT = 100;

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

function toMetricsSession(s: SessionRow): MetricsSession {
  return {
    id:              s.id,
    chairId:         s.chairId,
    shiftId:         s.shiftId,
    status:          s.status,
    startedAt:       s.startedAt,
    durationSeconds: s.durationSeconds,
    expectedAmount:  s.expectedAmount != null ? Number(s.expectedAmount) : null,
    correctedAmount: s.correctedAmount != null ? Number(s.correctedAmount) : null,
    anomalyType:     s.anomalyType,
    billingStatus:   s.billingStatus,
    matchedPlanId:   s.matchedPlanId,
    matchedPlanName: s.matchedPlan?.name ?? null,
  };
}

function warningFor(status: string): string | null {
  if (status === 'MAYBE_FINISHED') return 'Fin possible';
  if (status === 'OFFLINE')        return 'Appareil injoignable';
  if (status === 'ERROR')          return 'Erreur appareil';
  return null;
}

function inPeriodWindow(
  startedAt: Date,
  tz: string,
  window: [number, number] | null,
): boolean {
  if (!window) return true;
  const local = toLocalDate(startedAt, tz);
  const localMin = local.getHours() * 60 + local.getMinutes();
  return localMin >= window[0] && localMin < window[1];
}

// ── Service ────────────────────────────────────────────────────────────────────

export class HomeDashboardService {
  async get(raw: HomeDashboardParams) {
    const cacheKey = `home-dashboard:${JSON.stringify({
      preset: raw.preset,
      from: raw.from,
      to: raw.to,
      period: raw.period,
      periodStart: raw.periodStart,
      periodEnd: raw.periodEnd,
      chair: raw.chair,
      staffMemberId: raw.staffMemberId,
      shiftTypeId: raw.shiftTypeId,
      shiftId: raw.shiftId,
      status: raw.status,
      chartPeriod: raw.chartPeriod,
    })}`;
    const cached = cacheGet<Awaited<ReturnType<HomeDashboardService['_getUncached']>>>(cacheKey);
    if (cached) return cached;

    const data = await withDbCircuit(() => this._getUncached(raw));
    cacheSet(cacheKey, data, env.DASHBOARD_CACHE_TTL_MS);
    return data;
  }

  invalidateCache(): void {
    cacheInvalidate('home-dashboard:');
  }

  private async _getUncached(raw: HomeDashboardParams) {
    const tz    = getTimezone();
    const today = todayBusinessDate(tz);

    const preset = (VALID_PRESETS.includes(raw.preset as Preset) ? raw.preset : 'custom') as Preset;
    let from: string;
    let to:   string;
    if (preset !== 'custom') {
      ({ from, to } = resolvePresetDates(preset, today));
    } else {
      from = raw.from || today;
      to   = raw.to   || today;
    }

    const period        = (VALID_PERIODS.includes(raw.period as Period) ? raw.period : 'all') as Period;
    const chair         = raw.chair         || 'all';
    const chartPeriod   = (VALID_CHART_P.includes(raw.chartPeriod as ChartPeriod) ? raw.chartPeriod : 'day') as ChartPeriod;

    // Shared filters for KPI + chart + table (+ future Excel): dates, status, fille, shift (gated).
    const filters = normalizeDashboardFilters({
      preset,
      from,
      to,
      status:        raw.status,
      staffMemberId: raw.staffMemberId,
      shiftTypeId:   raw.shiftTypeId,
      shiftId:       raw.shiftId,
      tz,
    });
    from = filters.from;
    to   = filters.to;
    const staffMemberId = filters.staffMemberId;
    const shiftTypeId   = filters.shiftTypeId;
    const shiftId       = filters.shiftId;
    const statusFilter  = filters.status as StatusFilter;

    const periodWindow = await this.resolvePeriodWindow(period, raw.periodStart, raw.periodEnd);

    let chairDbId: string | undefined;
    if (chair !== 'all') {
      const dbChair = await prisma.chair.findFirst({
        where:  { OR: [{ name: chair }, { id: chair }] },
        select: { id: true },
      });
      chairDbId = dbChair?.id ?? undefined;
    }

    const sessionWhere = buildDashboardSessionWhere(filters, { chairId: chairDbId });
    const rangeShiftsWhere = buildDashboardShiftsWhere(filters);

    const [
      dbChairs,
      allStaff,
      allShiftTypes,
      rangeShifts,
      currentShiftRow,
      allActiveCommRules,
      allTargetBonusRules,
      sessionsTableRows,
    ] = await Promise.all([
      prisma.chair.findMany({
        where:   { isEnabled: true },
        orderBy: { name: 'asc' },
        select:  { id: true, name: true, displayName: true, status: true, currentPowerWatts: true, isOnline: true },
      }),
      prisma.staffMember.findMany({
        where:   STAFF_VISIBLE_WHERE,
        orderBy: { name: 'asc' },
        select:  { id: true, name: true },
      }),
      prisma.shiftType.findMany({
        where:   { isActive: true, archivedAt: null },
        orderBy: { sortOrder: 'asc' },
        select:  { id: true, name: true, label: true },
      }),
      prisma.shift.findMany({
        where:   rangeShiftsWhere,
        orderBy: { startedAt: 'desc' },
        take:    SHIFT_OPTIONS_LIMIT,
        select: {
          id: true, status: true, startedAt: true,
          staffMember: { select: { name: true } },
          shiftType:   { select: { label: true } },
        },
      }).then((rows) => (filters.allowShift ? rows : [])),
      prisma.shift.findFirst({
        where:   { status: 'OPEN', endedAt: null },
        orderBy: { startedAt: 'desc' },
        select: {
          id:             true,
          startedAt:      true,
          scheduledEndAt: true,
          staffMember: { select: { name: true } },
          shiftType:   { select: { label: true } },
        },
      }),
      prisma.commissionRule.findMany({
        where:  { isActive: true },
        select: { pricingPlanId: true, type: true, value: true },
      }) as Promise<CommRuleLight[]>,
      prisma.shiftTargetBonusRule.findMany({
        where:   { isActive: true },
        orderBy: { targetAmount: 'desc' },
        select:  { shiftTypeId: true, targetAmount: true, bonusAmount: true },
      }) as Promise<TargetBonusLight[]>,
      // LIST ONLY — never used for KPIs / chart / prime
      prisma.chairSession.findMany({
        where:   sessionWhere,
        select:  SESSION_SELECT,
        orderBy: { startedAt: 'desc' },
        take:    SESSIONS_TABLE_LIMIT * (periodWindow ? 4 : 1),
      }),
    ]);

    const commRules: CommRule[] = allActiveCommRules.map((r) => ({
      pricingPlanId: r.pricingPlanId,
      type:          r.type,
      value:         Number(r.value),
    }));

    const { labels, bucketCount, getBucket } = this.chartBuckets(chartPeriod, from);
    const summaryAcc = emptySummary();
    const byChairAcc = emptyChairMap(dbChairs);
    const chartAcc   = emptyChart(bucketCount);
    const primeAcc   = emptyPrime();
    const shiftIds   = new Set<string>();
    const toLocal    = (d: Date) => toLocalDate(d, tz);

    // Stream ALL matching sessions for stats — batch size is not a total cap.
    let cursorId: string | undefined;
    let batchesRead = 0;
    for (;;) {
      const batch = await prisma.chairSession.findMany({
        where:   sessionWhere,
        select:  SESSION_SELECT,
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        take:    STATS_BATCH_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      batchesRead++;

      for (const row of batch) {
        if (!inPeriodWindow(row.startedAt, tz, periodWindow)) continue;
        const s = toMetricsSession(row);
        absorbSummary(summaryAcc, s);
        absorbChair(byChairAcc, s);
        absorbChart(chartAcc, s, getBucket, toLocal);
        absorbPrime(primeAcc, s, commRules);
        if (s.shiftId) shiftIds.add(s.shiftId);
      }

      cursorId = batch[batch.length - 1]!.id;
      if (batch.length < STATS_BATCH_SIZE) break;
    }

    const uniqueShiftIds = [...shiftIds];
    const [shiftsForPrime, bonusAdjustments, openShiftSessions] = await Promise.all([
      uniqueShiftIds.length > 0
        ? (prisma.shift.findMany({
            where:  { id: { in: uniqueShiftIds } },
            select: { id: true, shiftTypeId: true, status: true },
          }) as Promise<ShiftLight[]>)
        : Promise.resolve([] as ShiftLight[]),
      uniqueShiftIds.length > 0
        ? (prisma.shiftBonusAdjustment.findMany({
            where:  { shiftId: { in: uniqueShiftIds } },
            select: { shiftId: true, amount: true },
          }) as Promise<BonusAdjLight[]>)
        : Promise.resolve([] as BonusAdjLight[]),
      currentShiftRow
        ? (prisma.chairSession.findMany({
            where:  { shiftId: currentShiftRow.id, status: { not: 'CANCELLED' }, ...SESSION_OPERATIONAL_WHERE },
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

    const summary = finalizeSummary(summaryAcc);
    const chartFinal = finalizeChart(chartAcc);
    const prime = this.finalizePrimeRevenue(
      primeAcc,
      allTargetBonusRules,
      shiftsForPrime,
      bonusAdjustments,
      summary.grossRevenue,
    );
    const liveChairs = this.buildLiveChairs(dbChairs);
    const byChair = this.formatTotalsByChair(byChairAcc, dbChairs);
    const chart = {
      period: chartPeriod,
      labels,
      ...chartFinal,
    };

    const tableFiltered = sessionsTableRows
      .filter((s) => inPeriodWindow(s.startedAt, tz, periodWindow))
      .slice(0, SESSIONS_TABLE_LIMIT);
    const sessionsTable = this.buildSessionsTable(tableFiltered);

    usageMetrics.incr('dbReads', 8 + batchesRead);

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

    const currentShift = currentShiftRow
      ? this.buildCurrentShiftLive(currentShiftRow, openShiftSessions, allActiveCommRules)
      : null;

    return {
      filters: {
        preset: preset as DashboardPreset, from, to, period, chair,
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
        activeChairs:           dbChairs.filter((c) => c.status === 'ACTIVE' || c.status === 'MAYBE_FINISHED').length,
        offlineChairs:          dbChairs.filter((c) => c.status === 'OFFLINE').length,
        totalPrime:             prime.totalPrime,
      },
      liveChairs,
      totalsByChair:  byChair,
      primeRevenue:   prime,
      revenueChart:   chart,
      sessionsTable,
    };
  }

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
      matin: ['08:00', '15:00'],
      soir:  ['15:00', '23:45'],
    };
    const def = defaults[period];
    return def ? [parseHHmm(def[0]), parseHHmm(def[1])] : null;
  }

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

  private formatTotalsByChair(
    byChair: Map<string, ChairAccum>,
    chairs: Array<{ id: string; name: string; displayName: string | null }>,
  ) {
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

  private finalizePrimeRevenue(
    primeAcc: ReturnType<typeof emptyPrime>,
    targetBonusRules: TargetBonusLight[],
    shifts: ShiftLight[],
    bonusAdj: BonusAdjLight[],
    sessionGrossRevenue: number,
  ) {
    let targetBonus = 0;
    for (const shift of shifts) {
      if (!shift.shiftTypeId) continue;
      const shiftGross = primeAcc.shiftGrossMap.get(shift.id) ?? 0;
      if (shiftGross <= 0) continue;
      const bonusRule = targetBonusRules.find(
        (r) => r.shiftTypeId === shift.shiftTypeId && Number(r.targetAmount) <= shiftGross,
      );
      if (bonusRule) targetBonus += Number(bonusRule.bonusAmount);
    }
    targetBonus = d2(targetBonus);

    let manualBonus = 0;
    for (const adj of bonusAdj) {
      manualBonus += Number(adj.amount);
    }
    manualBonus = d2(manualBonus);

    const planCommission = d2(primeAcc.planCommission);
    const totalPrime = d2(planCommission + targetBonus + manualBonus);

    return {
      grossRevenue:                    d2(sessionGrossRevenue),
      planCommission,
      targetBonus,
      manualBonus,
      totalPrime,
      netRevenue:                      d2(sessionGrossRevenue - totalPrime),
      isEstimated:                     shifts.some((sh) => sh.status === 'OPEN'),
      eligibleCommissionSessionsCount: primeAcc.eligibleCommissionSessionsCount,
      excludedCommissionSessionsCount: primeAcc.excludedCommissionSessionsCount,
      pendingSessionsCount:            primeAcc.pendingSessionsCount,
    };
  }

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

      if (s.status !== 'COMPLETED')  continue;
      if (!s.matchedPlanId)          continue;
      if (amt <= 0)                  continue;
      if (s.anomalyType?.split(',').includes('TOO_SHORT')) continue;
      if (s.billingStatus === 'DISPUTED') continue;
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

  private chartBuckets(chartPeriod: ChartPeriod, from: string) {
    const [y, mo] = from.split('-').map(Number);
    let labels: string[];
    let bucketCount: number;
    let getBucket: (local: Date) => number;

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

    return { labels, bucketCount, getBucket };
  }

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
        matchedPlanId:    s.matchedPlanId,
        amount:           sessionRevenue(toMetricsSession(s)),
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
