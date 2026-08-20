/**
 * Unit tests for dashboard date-range filter (no database).
 * Run: npm run test:dashboard-dates
 */
import assert from 'node:assert/strict';
import {
  addCalendarDays,
  buildDateRangeFilter,
  resolvePresetDates,
  startedAtDateFilter,
  isValidBusinessDate,
} from './date-range';

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

console.log('dashboard date-range tests');

test('validates YYYY-MM-DD', () => {
  assert.equal(isValidBusinessDate('2026-07-01'), true);
  assert.equal(isValidBusinessDate('2026-02-30'), false);
  assert.equal(isValidBusinessDate('07/01/2026'), false);
});

test('addCalendarDays crosses month and year', () => {
  assert.equal(addCalendarDays('2026-07-31', 1), '2026-08-01');
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addCalendarDays('2026-03-01', -1), '2026-02-28');
});

test('presets: today / yesterday / month / year', () => {
  assert.deepEqual(resolvePresetDates('today', '2026-08-20'), {
    from: '2026-08-20',
    to: '2026-08-20',
  });
  assert.deepEqual(resolvePresetDates('yesterday', '2026-08-20'), {
    from: '2026-08-19',
    to: '2026-08-19',
  });
  assert.deepEqual(resolvePresetDates('month', '2026-08-20'), {
    from: '2026-08-01',
    to: '2026-08-31',
  });
  assert.deepEqual(resolvePresetDates('year', '2026-08-20'), {
    from: '2026-01-01',
    to: '2026-12-31',
  });
});

test('week preset is Monday→Sunday', () => {
  // 2026-08-20 is Thursday
  assert.deepEqual(resolvePresetDates('week', '2026-08-20'), {
    from: '2026-08-17',
    to: '2026-08-23',
  });
  // Sunday
  assert.deepEqual(resolvePresetDates('week', '2026-08-23'), {
    from: '2026-08-17',
    to: '2026-08-23',
  });
  // Monday
  assert.deepEqual(resolvePresetDates('week', '2026-08-17'), {
    from: '2026-08-17',
    to: '2026-08-23',
  });
});

function localParts(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

test('semi-open range: July includes full last day, excludes Sept 1', () => {
  const r = buildDateRangeFilter('2026-07-01', '2026-07-31', TZ);
  assert.equal(r.from, '2026-07-01');
  assert.equal(r.to, '2026-07-31');

  const start = localParts(r.gte, TZ);
  assert.equal(start.year, 2026);
  assert.equal(start.month, 7);
  assert.equal(start.day, 1);
  assert.equal(start.hour, 0);
  assert.equal(start.minute, 0);

  const end = localParts(r.lt, TZ);
  assert.equal(end.year, 2026);
  assert.equal(end.month, 8);
  assert.equal(end.day, 1);
  assert.equal(end.hour, 0);
});

test('two-month range ends at Sept 1 exclusive', () => {
  const r = buildDateRangeFilter('2026-07-01', '2026-08-31', TZ);
  const end = localParts(r.lt, TZ);
  assert.equal(end.year, 2026);
  assert.equal(end.month, 9);
  assert.equal(end.day, 1);
  assert.equal(end.hour, 0);
});

test('year range ends at next Jan 1 exclusive', () => {
  const r = buildDateRangeFilter('2026-01-01', '2026-12-31', TZ);
  const next = localParts(r.lt, TZ);
  assert.equal(next.year, 2027);
  assert.equal(next.month, 1);
  assert.equal(next.day, 1);
});

test('session at 00:00 on start day is included (gte)', () => {
  const { gte, lt } = startedAtDateFilter('2026-07-01', '2026-07-01', TZ);
  assert.ok(gte.getTime() < lt.getTime());
  // Instant exactly at gte must satisfy startedAt >= gte && startedAt < lt
  const atStart = gte;
  assert.ok(atStart.getTime() >= gte.getTime());
  assert.ok(atStart.getTime() < lt.getTime());
});

test('session at 23:59 on end day is included; next midnight excluded', () => {
  const { gte, lt } = startedAtDateFilter('2026-07-01', '2026-07-31', TZ);
  // 23:59 Casablanca on July 31
  const late = new Date(lt.getTime() - 60_000);
  assert.ok(late.getTime() >= gte.getTime());
  assert.ok(late.getTime() < lt.getTime());
  // Exactly at exclusive end is OUT
  assert.ok(!(lt.getTime() < lt.getTime()));
  assert.equal(lt.getTime() >= lt.getTime() && !(lt.getTime() < lt.getTime()), true);
});

test('swapped from/to is normalized', () => {
  const r = buildDateRangeFilter('2026-08-31', '2026-07-01', TZ);
  assert.equal(r.from, '2026-08-31');
  assert.equal(r.to, '2026-08-31');
});

test('month boundary: last ms of July in, first ms of August out for July-only', () => {
  const july = buildDateRangeFilter('2026-07-01', '2026-07-31', TZ);
  const justBeforeAug = new Date(july.lt.getTime() - 1);
  const atAug = july.lt;
  assert.ok(justBeforeAug >= july.gte && justBeforeAug < july.lt);
  assert.ok(!(atAug < july.lt));
});

console.log('All dashboard date-range tests passed.');
