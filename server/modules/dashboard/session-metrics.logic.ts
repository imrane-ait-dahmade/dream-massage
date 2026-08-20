/**
 * Pure session metrics for the home dashboard.
 * Used both by the service (streaming batches) and by unit tests.
 * Never apply pagination / take / limit here — callers must pass the full filtered set
 * or stream every matching row into the accumulator.
 */

export const BLOCKING_ANOMALIES = new Set([
  'TOO_SHORT',
  'NO_PLAN_MATCH',
  'NO_OPEN_SHIFT',
  'OFFLINE_DURING_SESSION',
  'DEVICE_ERROR',
  'POWER_NOT_FOUND',
  'SESSION_PENDING',
  'MANUAL_REVIEW_REQUIRED',
]);

export const INFORMATIONAL_ANOMALIES = new Set(['TOO_LONG', 'LONG', 'DURATION_EXCEEDED']);

export interface MetricsSession {
  id: string;
  chairId: string;
  shiftId: string | null;
  status: string;
  startedAt: Date;
  durationSeconds: number | null;
  expectedAmount: number | null;
  correctedAmount: number | null;
  anomalyType: string | null;
  billingStatus: string;
  matchedPlanId: string | null;
  matchedPlanName: string | null;
}

export function d2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sessionRevenue(s: MetricsSession): number {
  if (s.status === 'ACTIVE') return 0;
  const val = s.correctedAmount ?? s.expectedAmount;
  return val != null ? Number(val) : 0;
}

/**
 * Historical out-of-rule classification from stored session fields only.
 * Must NOT depend on "now", current shift, or current chair status.
 */
export function isOutOfRule(s: Pick<MetricsSession, 'status' | 'billingStatus' | 'anomalyType'>): boolean {
  if (s.status === 'UNCERTAIN' || s.status === 'ERROR') return true;
  if (s.billingStatus === 'DISPUTED') return true;

  const anomalies = s.anomalyType?.split(',').map((a) => a.trim()).filter(Boolean) ?? [];
  const isBilled = s.billingStatus === 'CALCULATED' || s.billingStatus === 'CORRECTED';

  if (s.billingStatus === 'PENDING') {
    const isOnlyDurationBadge =
      anomalies.length > 0 && anomalies.every((a) => INFORMATIONAL_ANOMALIES.has(a));
    return !isOnlyDurationBadge;
  }

  if (isBilled) return anomalies.some((a) => BLOCKING_ANOMALIES.has(a));
  return true;
}

export interface SummaryAccum {
  grossRevenue: number;
  sessionsCount: number;
  completedSessionsCount: number;
  activeSessionsCount: number;
  pendingSessionsCount: number;
  correctedSessionsCount: number;
  outOfRuleSessionsCount: number;
}

export interface ChairPlanAccum {
  label: string;
  count: number;
  revenue: number;
}

export interface ChairAccum {
  sessionsCount: number;
  completedSessionsCount: number;
  activeSessionsCount: number;
  outOfRuleSessionsCount: number;
  revenue: number;
  durationTotalSeconds: number;
  plans: Map<string, ChairPlanAccum>;
}

export interface ChartAccum {
  revenue: number[];
  sessionCount: number[];
}

export interface PrimeAccum {
  planCommission: number;
  eligibleCommissionSessionsCount: number;
  excludedCommissionSessionsCount: number;
  pendingSessionsCount: number;
  shiftGrossMap: Map<string, number>;
}

export function emptySummary(): SummaryAccum {
  return {
    grossRevenue: 0,
    sessionsCount: 0,
    completedSessionsCount: 0,
    activeSessionsCount: 0,
    pendingSessionsCount: 0,
    correctedSessionsCount: 0,
    outOfRuleSessionsCount: 0,
  };
}

export function emptyPrime(): PrimeAccum {
  return {
    planCommission: 0,
    eligibleCommissionSessionsCount: 0,
    excludedCommissionSessionsCount: 0,
    pendingSessionsCount: 0,
    shiftGrossMap: new Map(),
  };
}

export function emptyChart(bucketCount: number): ChartAccum {
  return {
    revenue: new Array<number>(bucketCount).fill(0),
    sessionCount: new Array<number>(bucketCount).fill(0),
  };
}

export function emptyChairMap(
  chairs: Array<{ id: string }>,
): Map<string, ChairAccum> {
  return new Map(
    chairs.map((c) => [
      c.id,
      {
        sessionsCount: 0,
        completedSessionsCount: 0,
        activeSessionsCount: 0,
        outOfRuleSessionsCount: 0,
        revenue: 0,
        durationTotalSeconds: 0,
        plans: new Map(),
      },
    ]),
  );
}

export function absorbSummary(acc: SummaryAccum, s: MetricsSession): void {
  acc.sessionsCount++;
  acc.grossRevenue += sessionRevenue(s);
  if (s.status === 'ACTIVE') acc.activeSessionsCount++;
  if (s.status === 'COMPLETED') acc.completedSessionsCount++;
  if (s.billingStatus === 'PENDING') acc.pendingSessionsCount++;
  if (s.billingStatus === 'CORRECTED' || s.correctedAmount !== null) acc.correctedSessionsCount++;
  if (isOutOfRule(s)) acc.outOfRuleSessionsCount++;
}

export function absorbChair(byChair: Map<string, ChairAccum>, s: MetricsSession): void {
  const rec = byChair.get(s.chairId);
  if (!rec) return;
  const rev = sessionRevenue(s);
  rec.sessionsCount++;
  rec.revenue += rev;
  rec.durationTotalSeconds += s.durationSeconds ?? 0;
  if (s.status === 'ACTIVE') rec.activeSessionsCount++;
  if (s.status === 'COMPLETED') rec.completedSessionsCount++;
  if (isOutOfRule(s)) rec.outOfRuleSessionsCount++;
  if (s.matchedPlanName && s.matchedPlanId) {
    const entry = rec.plans.get(s.matchedPlanId);
    if (entry) {
      entry.count++;
      entry.revenue += rev;
    } else {
      rec.plans.set(s.matchedPlanId, { label: s.matchedPlanName, count: 1, revenue: rev });
    }
  }
}

export function absorbChart(
  chart: ChartAccum,
  s: MetricsSession,
  getBucket: (local: Date) => number,
  toLocal: (d: Date) => Date,
): void {
  const bucket = getBucket(toLocal(s.startedAt));
  if (bucket >= 0 && bucket < chart.revenue.length) {
    chart.revenue[bucket] += sessionRevenue(s);
    chart.sessionCount[bucket] += 1;
  }
}

export type CommRule = { pricingPlanId: string; type: string; value: number };

/** Incremental plan-commission + per-shift gross (for target bonus later). */
export function absorbPrime(acc: PrimeAccum, s: MetricsSession, commRules: CommRule[]): void {
  if (s.shiftId) {
    const rev = sessionRevenue(s);
    acc.shiftGrossMap.set(s.shiftId, (acc.shiftGrossMap.get(s.shiftId) ?? 0) + rev);
  }

  if (s.status !== 'COMPLETED') return;
  if (!s.matchedPlanId) return;

  const finalAmount =
    s.correctedAmount !== null ? Number(s.correctedAmount) :
    s.expectedAmount !== null ? Number(s.expectedAmount) : 0;

  if (finalAmount <= 0) {
    acc.excludedCommissionSessionsCount++;
    return;
  }

  if (s.anomalyType?.split(',').includes('TOO_SHORT')) {
    acc.excludedCommissionSessionsCount++;
    return;
  }
  if (s.billingStatus === 'DISPUTED') {
    acc.excludedCommissionSessionsCount++;
    return;
  }

  if (s.billingStatus === 'PENDING') {
    const isTooLong = s.anomalyType?.split(',').includes('TOO_LONG') ?? false;
    if (!isTooLong) {
      acc.pendingSessionsCount++;
      acc.excludedCommissionSessionsCount++;
      return;
    }
  } else if (s.billingStatus !== 'CALCULATED' && s.billingStatus !== 'CORRECTED') {
    acc.excludedCommissionSessionsCount++;
    return;
  }

  const rule = commRules.find((r) => r.pricingPlanId === s.matchedPlanId);
  if (!rule) return;

  const commission =
    rule.type === 'PERCENTAGE'
      ? d2(finalAmount * Number(rule.value) / 100)
      : Number(rule.value);

  acc.planCommission += commission;
  acc.eligibleCommissionSessionsCount++;
}

export function finalizeSummary(acc: SummaryAccum) {
  return {
    ...acc,
    grossRevenue: d2(acc.grossRevenue),
  };
}

export function finalizeChart(chart: ChartAccum) {
  const revenue = chart.revenue.map(d2);
  return {
    revenue,
    sessions: chart.sessionCount,
    totalRevenue: d2(revenue.reduce((a, b) => a + b, 0)),
    totalSessions: chart.sessionCount.reduce((a, b) => a + b, 0),
  };
}

/**
 * Aggregate a full (non-paginated) session list — for tests and one-shot callers.
 * Intentionally has no take/limit parameter.
 */
export function aggregateSessionMetrics(
  sessions: MetricsSession[],
  opts: {
    chairs: Array<{ id: string }>;
    bucketCount: number;
    getBucket: (local: Date) => number;
    toLocal: (d: Date) => Date;
    commRules?: CommRule[];
  },
) {
  const summary = emptySummary();
  const byChair = emptyChairMap(opts.chairs);
  const chart = emptyChart(opts.bucketCount);
  const prime = emptyPrime();
  const rules = opts.commRules ?? [];

  for (const s of sessions) {
    absorbSummary(summary, s);
    absorbChair(byChair, s);
    absorbChart(chart, s, opts.getBucket, opts.toLocal);
    absorbPrime(prime, s, rules);
  }

  return {
    summary: finalizeSummary(summary),
    byChair,
    chart: finalizeChart(chart),
    prime: {
      ...prime,
      planCommission: d2(prime.planCommission),
    },
  };
}
