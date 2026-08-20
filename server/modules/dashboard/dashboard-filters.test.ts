/**
 * Unit tests for dashboard filter composition (no database).
 * Run: npm run test:dashboard-filters
 */
import assert from 'node:assert/strict';
import {
  canFilterByShift,
  normalizeDashboardFilters,
  buildDashboardSessionWhere,
  buildStaffShiftRelationFilter,
} from './dashboard-filters';

const TZ = 'Africa/Casablanca';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('dashboard-filters tests');

test('canFilterByShift only today/yesterday', () => {
  assert.equal(canFilterByShift('today'), true);
  assert.equal(canFilterByShift('yesterday'), true);
  assert.equal(canFilterByShift('week'), false);
  assert.equal(canFilterByShift('month'), false);
  assert.equal(canFilterByShift('year'), false);
  assert.equal(canFilterByShift('custom'), false);
});

test('CAS 6: leaving today clears shiftId in normalize', () => {
  const today = normalizeDashboardFilters({
    preset: 'today',
    from: '2026-08-20',
    to: '2026-08-20',
    shiftId: 'shift-khadija',
    staffMemberId: 'all',
    tz: TZ,
  });
  assert.equal(today.shiftId, 'shift-khadija');
  assert.equal(today.allowShift, true);

  const month = normalizeDashboardFilters({
    preset: 'month',
    from: '2026-08-01',
    to: '2026-08-31',
    shiftId: 'shift-khadija', // stale from UI
    staffMemberId: 'staff-khadija',
    tz: TZ,
  });
  assert.equal(month.shiftId, 'all');
  assert.equal(month.allowShift, false);
  assert.equal(month.staffMemberId, 'staff-khadija');
});

test('CAS 2: fille only → shift.staffMemberId, no shiftId', () => {
  const n = normalizeDashboardFilters({
    preset: 'today',
    from: '2026-08-20',
    to: '2026-08-20',
    staffMemberId: 'staff-k',
    shiftId: 'all',
    tz: TZ,
  });
  const where = buildDashboardSessionWhere(n);
  assert.equal(where.shiftId, undefined);
  assert.deepEqual(where.shift, { staffMemberId: 'staff-k' });
});

test('CAS 3: fille + shift → both AND', () => {
  const n = normalizeDashboardFilters({
    preset: 'today',
    from: '2026-08-20',
    to: '2026-08-20',
    staffMemberId: 'staff-k',
    shiftId: 'shift-x',
    tz: TZ,
  });
  const where = buildDashboardSessionWhere(n);
  assert.equal(where.shiftId, 'shift-x');
  assert.deepEqual(where.shift, { staffMemberId: 'staff-k' });
});

test('CAS 5: month + fille → staff filter, shift ignored', () => {
  const n = normalizeDashboardFilters({
    preset: 'month',
    from: '2026-08-01',
    to: '2026-08-31',
    staffMemberId: 'staff-k',
    shiftId: 'shift-x',
    tz: TZ,
  });
  const where = buildDashboardSessionWhere(n);
  assert.equal(where.shiftId, undefined);
  assert.deepEqual(where.shift, { staffMemberId: 'staff-k' });
});

test('CAS 7: year + fille keeps staffMemberId', () => {
  const n = normalizeDashboardFilters({
    preset: 'year',
    from: '2026-01-01',
    to: '2026-12-31',
    staffMemberId: 'staff-k',
    tz: TZ,
  });
  assert.equal(n.staffMemberId, 'staff-k');
  assert.equal(n.shiftId, 'all');
  const where = buildDashboardSessionWhere(n);
  assert.deepEqual(where.shift, { staffMemberId: 'staff-k' });
});

test('custom period never allows shiftId', () => {
  const n = normalizeDashboardFilters({
    preset: 'custom',
    from: '2026-07-01',
    to: '2026-08-31',
    shiftId: 'shift-x',
    tz: TZ,
  });
  assert.equal(n.shiftId, 'all');
  assert.equal(buildDashboardSessionWhere(n).shiftId, undefined);
});

test('all girls → no shift relation filter', () => {
  assert.equal(buildStaffShiftRelationFilter('all', 'all'), undefined);
  const n = normalizeDashboardFilters({
    preset: 'today',
    from: '2026-08-20',
    to: '2026-08-20',
    tz: TZ,
  });
  assert.equal(buildDashboardSessionWhere(n).shift, undefined);
});

test('date range still semi-open after normalize', () => {
  const n = normalizeDashboardFilters({
    preset: 'month',
    from: '2026-07-01',
    to: '2026-07-31',
    tz: TZ,
  });
  assert.ok(n.utcStart.getTime() < n.utcEnd.getTime());
  const where = buildDashboardSessionWhere(n);
  assert.deepEqual(where.startedAt, { gte: n.utcStart, lt: n.utcEnd });
});

console.log('All dashboard-filters tests passed.');
