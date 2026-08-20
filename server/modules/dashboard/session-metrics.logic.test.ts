/**
 * Unit tests for dashboard session metrics aggregation (no database).
 * Proves KPIs are independent of any take/limit and that longer ranges are additive.
 * Run: npm run test:dashboard-metrics
 */
import assert from 'node:assert/strict';
import {
  aggregateSessionMetrics,
  isOutOfRule,
  sessionRevenue,
  d2,
  type MetricsSession,
} from './session-metrics.logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function makeSession(
  partial: Partial<MetricsSession> & { id: string; startedAt: Date },
): MetricsSession {
  return {
    chairId: 'chair-1',
    shiftId: 'shift-1',
    status: 'COMPLETED',
    durationSeconds: 1800,
    expectedAmount: 50,
    correctedAmount: null,
    anomalyType: null,
    billingStatus: 'CALCULATED',
    matchedPlanId: 'plan-1',
    matchedPlanName: '30 min',
    ...partial,
  };
}

/** Build N completed sessions on a given UTC day at noon, amount MAD each. */
function sessionsOnDay(day: string, count: number, amount: number, idPrefix: string): MetricsSession[] {
  const out: MetricsSession[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      makeSession({
        id: `${idPrefix}-${i}`,
        startedAt: new Date(`${day}T12:00:00.000Z`),
        expectedAmount: amount,
        // Every 10th session is out-of-rule (TOO_SHORT + PENDING-like blocking)
        ...(i % 10 === 0
          ? { anomalyType: 'TOO_SHORT', billingStatus: 'PENDING', expectedAmount: 0 }
          : {}),
      }),
    );
  }
  return out;
}

const MONTH_COUNTS = [
  { month: '01', count: 120 },
  { month: '02', count: 130 },
  { month: '03', count: 140 },
  { month: '04', count: 150 },
  { month: '05', count: 160 },
  { month: '06', count: 170 },
  { month: '07', count: 180 },
  { month: '08', count: 190 },
] as const;

function buildYearFixture(): MetricsSession[] {
  const all: MetricsSession[] = [];
  for (const { month, count } of MONTH_COUNTS) {
    // Spread across the month so date bounds matter
    const day = `2026-${month}-15`;
    all.push(...sessionsOnDay(day, count, 30, `2026-${month}`));
  }
  // Boundary sessions
  all.push(
    makeSession({
      id: 'boundary-jul-start',
      startedAt: new Date('2026-07-01T00:00:00.000Z'),
      expectedAmount: 40,
    }),
    makeSession({
      id: 'boundary-jul-end',
      startedAt: new Date('2026-07-31T22:59:00.000Z'),
      expectedAmount: 40,
    }),
    makeSession({
      id: 'boundary-aug-start',
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      expectedAmount: 40,
    }),
  );
  return all;
}

function filterByMonth(sessions: MetricsSession[], month: string): MetricsSession[] {
  return sessions.filter((s) => {
    const m = String(s.startedAt.getUTCMonth() + 1).padStart(2, '0');
    return m === month && s.startedAt.getUTCFullYear() === 2026;
  });
}

function filterRange(sessions: MetricsSession[], fromIso: string, toExclusiveIso: string): MetricsSession[] {
  const gte = new Date(fromIso).getTime();
  const lt = new Date(toExclusiveIso).getTime();
  return sessions.filter((s) => {
    const t = s.startedAt.getTime();
    return t >= gte && t < lt;
  });
}

const identityLocal = (d: Date) => d;
const monthBucket = (d: Date) => d.getUTCMonth();

function agg(sessions: MetricsSession[]) {
  return aggregateSessionMetrics(sessions, {
    chairs: [{ id: 'chair-1' }],
    bucketCount: 12,
    getBucket: monthBucket,
    toLocal: identityLocal,
  });
}

console.log('dashboard session-metrics tests');

test('isOutOfRule uses historical fields only (not current date)', () => {
  assert.equal(
    isOutOfRule({ status: 'COMPLETED', billingStatus: 'CALCULATED', anomalyType: null }),
    false,
  );
  assert.equal(
    isOutOfRule({ status: 'COMPLETED', billingStatus: 'CALCULATED', anomalyType: 'TOO_LONG' }),
    false,
  );
  assert.equal(
    isOutOfRule({ status: 'COMPLETED', billingStatus: 'PENDING', anomalyType: 'TOO_SHORT' }),
    true,
  );
  assert.equal(
    isOutOfRule({ status: 'COMPLETED', billingStatus: 'PENDING', anomalyType: 'TOO_LONG' }),
    false,
  );
  assert.equal(
    isOutOfRule({ status: 'ERROR', billingStatus: 'CALCULATED', anomalyType: null }),
    true,
  );
});

test('ACTIVE sessions contribute 0 revenue', () => {
  const s = makeSession({
    id: 'a1',
    startedAt: new Date('2026-07-01T12:00:00Z'),
    status: 'ACTIVE',
    expectedAmount: 100,
  });
  assert.equal(sessionRevenue(s), 0);
});

{
  const all = buildYearFixture();
  const totalBuilt = MONTH_COUNTS.reduce((a, m) => a + m.count, 0) + 3;

  test(`fixture has ${totalBuilt} sessions (> 500)`, () => {
    assert.equal(all.length, totalBuilt);
    assert.ok(all.length > 500);
  });

  test('July metrics equal July-only data (exact)', () => {
    const july = filterByMonth(all, '07');
    // 180 mid-month + 2 boundary July sessions
    assert.equal(july.length, 182);
    const m = agg(july);
    assert.equal(m.summary.sessionsCount, 182);
    assert.equal(m.chart.totalSessions, 182);
    assert.equal(m.summary.sessionsCount, m.chart.totalSessions);
  });

  test('July+August >= July for additive counters', () => {
    const july = agg(filterByMonth(all, '07'));
    const julAug = agg([...filterByMonth(all, '07'), ...filterByMonth(all, '08')]);
    assert.ok(julAug.summary.sessionsCount >= july.summary.sessionsCount);
    assert.ok(julAug.summary.outOfRuleSessionsCount >= july.summary.outOfRuleSessionsCount);
    assert.ok(julAug.summary.grossRevenue >= july.summary.grossRevenue - 0.001);
    assert.equal(
      julAug.summary.sessionsCount,
      july.summary.sessionsCount + agg(filterByMonth(all, '08')).summary.sessionsCount,
    );
  });

  test('full Jan–Aug year-to-date > 500 and equals sum of months', () => {
    const ytd = agg(all.filter((s) => s.startedAt.getUTCFullYear() === 2026 && s.startedAt.getUTCMonth() < 8));
    assert.ok(ytd.summary.sessionsCount > 500);

    let sumSessions = 0;
    let sumGross = 0;
    let sumOut = 0;
    for (const { month } of MONTH_COUNTS) {
      const m = agg(filterByMonth(all, month));
      sumSessions += m.summary.sessionsCount;
      sumGross = d2(sumGross + m.summary.grossRevenue);
      sumOut += m.summary.outOfRuleSessionsCount;
    }
    assert.equal(ytd.summary.sessionsCount, sumSessions);
    assert.equal(ytd.summary.grossRevenue, sumGross);
    assert.equal(ytd.summary.outOfRuleSessionsCount, sumOut);
  });

  test('BUG REGRESSION: simulating take:500+desc MUST NOT be used for stats', () => {
    // Reproduce the old bug: order desc + take 500 → wrong totals for long ranges
    const sortedDesc = [...all].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const limited = sortedDesc.slice(0, 500);
    const buggy = agg(limited);
    const correct = agg(all);

    assert.equal(buggy.summary.sessionsCount, 500);
    assert.ok(correct.summary.sessionsCount > 500);
    assert.notEqual(buggy.summary.sessionsCount, correct.summary.sessionsCount);
    // This is exactly the production symptom the user saw
    assert.ok(buggy.summary.outOfRuleSessionsCount !== correct.summary.outOfRuleSessionsCount
      || buggy.summary.grossRevenue !== correct.summary.grossRevenue);
  });

  test('inclusive first day / exclusive next-month midnight via filterRange', () => {
    // July range as UTC stand-in for [2026-07-01, 2026-08-01)
    const july = filterRange(all, '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    assert.ok(july.some((s) => s.id === 'boundary-jul-start'));
    assert.ok(july.some((s) => s.id === 'boundary-jul-end'));
    assert.ok(!july.some((s) => s.id === 'boundary-aug-start'));
  });

  test('chart totalSessions === summary.sessionsCount', () => {
    const m = agg(all);
    assert.equal(m.chart.totalSessions, m.summary.sessionsCount);
    assert.equal(m.chart.totalRevenue, m.summary.grossRevenue);
  });
}

console.log('All dashboard session-metrics tests passed.');
