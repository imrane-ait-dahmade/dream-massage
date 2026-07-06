/**
 * Scenario tests for auto-shift timing (no database).
 * Run: npm run test:auto-shift-check
 */
import assert from 'node:assert/strict';
import { buildScheduledDatetime } from '../../utils/time';
import { evaluateShiftClose } from './shift-close.logic';

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

function at(businessDate: string, hhmm: string): Date {
  return buildScheduledDatetime(businessDate, hhmm, TZ);
}

console.log('auto-shift-check scenario tests');

const businessDate = '2026-07-06';

test('07:59 — before shop open, shift should not be eligible for daily close', () => {
  const now = at(businessDate, '07:59');
  const d = evaluateShiftClose(
    {
      id: 's1',
      status: 'OPEN',
      businessDate,
      scheduledEndAt: at(businessDate, '22:00'),
      startedAt: at(businessDate, '08:00'),
      staffMemberId: 'staff-1',
    },
    now,
    businessDate,
    at(businessDate, '00:00'),
    undefined,
    '23:45',
    TZ,
  );
  assert.equal(d.close, false);
});

test('08:00 — shop open window begins (open logic uses separate service)', () => {
  const shopOpen = at(businessDate, '08:00');
  assert.ok(shopOpen instanceof Date);
});

test('23:44 — still inside shop day before daily close', () => {
  const d = evaluateShiftClose(
    {
      id: 's1',
      status: 'OPEN',
      businessDate,
      scheduledEndAt: at(businessDate, '22:00'),
      startedAt: at(businessDate, '08:00'),
      staffMemberId: 'staff-1',
    },
    at(businessDate, '23:44'),
    businessDate,
    at(businessDate, '00:00'),
    undefined,
    '23:45',
    TZ,
  );
  // scheduled end 22:00 already passed → SCHEDULE_END closes before 23:45
  assert.equal(d.close, true);
  assert.equal(d.reason, 'SCHEDULE_END');
});

test('23:45 — daily close triggers for today shift still open', () => {
  const d = evaluateShiftClose(
    {
      id: 's1',
      status: 'OPEN',
      businessDate,
      scheduledEndAt: at(businessDate, '23:50'),
      startedAt: at(businessDate, '08:00'),
      staffMemberId: 'staff-1',
    },
    at(businessDate, '23:45'),
    businessDate,
    at(businessDate, '00:00'),
    undefined,
    '23:45',
    TZ,
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'DAILY_CLOSE');
});

test('next day — orphan shift from previous businessDate closes', () => {
  const d = evaluateShiftClose(
    {
      id: 's1',
      status: 'OPEN',
      businessDate: '2026-07-05',
      scheduledEndAt: null,
      startedAt: at('2026-07-05', '08:00'),
      staffMemberId: 'staff-1',
    },
    at('2026-07-06', '08:15'),
    '2026-07-06',
    at('2026-07-06', '00:00'),
    undefined,
    '23:45',
    TZ,
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'STALE_BUSINESS_DATE');
});

console.log('All auto-shift-check scenario tests passed.');
