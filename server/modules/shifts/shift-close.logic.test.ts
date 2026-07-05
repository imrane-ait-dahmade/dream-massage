/**
 * Unit tests for shift close eligibility (no database).
 * Run: npx tsx modules/shifts/shift-close.logic.test.ts
 */
import assert from 'node:assert/strict';
import {
  evaluateShiftClose,
  shouldCloseBeforeHandoff,
  type ShiftCloseCandidate,
} from './shift-close.logic';

const base: ShiftCloseCandidate = {
  id: 'shift-1',
  status: 'OPEN',
  businessDate: '2026-07-03',
  scheduledEndAt: new Date('2026-07-03T14:00:00Z'),
  startedAt: new Date('2026-07-03T08:00:00Z'),
  staffMemberId: 'staff-1',
};

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('shift-close.logic tests');

test('ignores already CLOSED shifts', () => {
  const d = evaluateShiftClose(
    { ...base, status: 'CLOSED' },
    new Date('2026-07-03T20:00:00Z'),
    '2026-07-03',
    new Date('2026-07-03T00:00:00Z'),
  );
  assert.equal(d.close, false);
});

test('keeps today shift inside scheduled window', () => {
  const d = evaluateShiftClose(
    base,
    new Date('2026-07-03T10:00:00Z'),
    '2026-07-03',
    new Date('2026-07-03T00:00:00Z'),
  );
  assert.equal(d.close, false);
});

test('closes when scheduledEndAt has passed (any business date)', () => {
  const end = new Date('2026-07-01T15:00:00Z');
  const d = evaluateShiftClose(
    { ...base, businessDate: '2026-07-01', scheduledEndAt: end },
    new Date('2026-07-04T10:00:00Z'),
    '2026-07-04',
    new Date('2026-07-04T00:00:00Z'),
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'SCHEDULE_END');
  assert.equal(d.endedAt, end);
});

test('closes stale shift from previous businessDate', () => {
  const d = evaluateShiftClose(
    { ...base, businessDate: '2026-07-01', scheduledEndAt: null },
    new Date('2026-07-04T10:00:00Z'),
    '2026-07-04',
    new Date('2026-07-04T00:00:00Z'),
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'STALE_BUSINESS_DATE');
});

test('closes manual shift without businessDate started before today', () => {
  const d = evaluateShiftClose(
    { ...base, businessDate: null, scheduledEndAt: null, startedAt: new Date('2026-06-30T12:00:00Z') },
    new Date('2026-07-04T10:00:00Z'),
    '2026-07-04',
    new Date('2026-07-04T00:00:00Z'),
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'STALE_STARTED_AT');
});

test('shouldCloseBeforeHandoff is false for active today shift', () => {
  assert.equal(
    shouldCloseBeforeHandoff(
      base,
      new Date('2026-07-03T10:00:00Z'),
      '2026-07-03',
      new Date('2026-07-03T00:00:00Z'),
    ),
    false,
  );
});

test('shouldCloseBeforeHandoff is true after scheduled end', () => {
  assert.equal(
    shouldCloseBeforeHandoff(
      base,
      new Date('2026-07-03T15:00:00Z'),
      '2026-07-03',
      new Date('2026-07-03T00:00:00Z'),
    ),
    true,
  );
});

console.log('All shift-close.logic tests passed.');
