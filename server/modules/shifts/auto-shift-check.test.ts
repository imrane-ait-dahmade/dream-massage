/**
 * Scenario tests for auto-shift period selection and close timing (no database).
 * Run: npm run test:auto-shift-check
 */
import assert from 'node:assert/strict';
import { buildScheduledDatetime } from '../../utils/time';
import {
  evaluatePeriodOpen,
  findActiveShiftTypeAtTime,
  type ScheduleSlot,
  type ShiftTypeWindow,
} from './auto-shift-period.logic';
import { evaluateShiftClose } from './shift-close.logic';

const TZ = 'Africa/Casablanca';
const BUSINESS_DATE = '2026-07-06'; // Monday

const MATIN_ID = '00000000-0000-0000-0004-000000000001';
const SOIR_ID  = '00000000-0000-0000-0004-000000000002';
const KHADIJA  = '00000000-0000-0000-0001-000000000003';
const OUMAIMA  = '00000000-0000-0000-0001-000000000002';

const SHIFT_TYPES: ShiftTypeWindow[] = [
  { id: MATIN_ID, name: 'MATIN', startTime: '08:00', endTime: '15:00', sortOrder: 1 },
  { id: SOIR_ID,  name: 'SOIR',  startTime: '15:00', endTime: '23:45', sortOrder: 2 },
];

const MONDAY_SCHEDULES: ScheduleSlot[] = [
  { id: 'sched-matin', staffMemberId: KHADIJA, staffMemberName: 'Khadija', shiftTypeId: MATIN_ID },
  { id: 'sched-soir',  staffMemberId: OUMAIMA, staffMemberName: 'Oumaima', shiftTypeId: SOIR_ID },
];

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

// ── Period selection ───────────────────────────────────────────────────────────

test('Monday 08:10 — active period is MATIN, staff Khadija', () => {
  const now = at(BUSINESS_DATE, '08:10');
  const active = findActiveShiftTypeAtTime(SHIFT_TYPES, now, BUSINESS_DATE, TZ);
  assert.equal(active?.name, 'MATIN');

  const decision = evaluatePeriodOpen(SHIFT_TYPES, MONDAY_SCHEDULES, now, BUSINESS_DATE, TZ);
  assert.equal(decision.shouldOpen, true);
  assert.equal(decision.activeShiftType?.id, MATIN_ID);
  assert.equal(decision.selectedSchedule?.staffMemberName, 'Khadija');
});

test('Monday 14:59 — still MATIN period', () => {
  const now = at(BUSINESS_DATE, '14:59');
  const active = findActiveShiftTypeAtTime(SHIFT_TYPES, now, BUSINESS_DATE, TZ);
  assert.equal(active?.name, 'MATIN');

  const decision = evaluatePeriodOpen(SHIFT_TYPES, MONDAY_SCHEDULES, now, BUSINESS_DATE, TZ);
  assert.equal(decision.shouldOpen, true);
  assert.equal(decision.selectedSchedule?.staffMemberId, KHADIJA);
});

test('Monday 08:10 — does not select Soir / Oumaima', () => {
  const now = at(BUSINESS_DATE, '08:10');
  const decision = evaluatePeriodOpen(SHIFT_TYPES, MONDAY_SCHEDULES, now, BUSINESS_DATE, TZ);
  assert.notEqual(decision.selectedSchedule?.staffMemberId, OUMAIMA);
  assert.notEqual(decision.activeShiftType?.id, SOIR_ID);
});

test('Monday 15:00 — active period is SOIR, staff Oumaima', () => {
  const now = at(BUSINESS_DATE, '15:00');
  const active = findActiveShiftTypeAtTime(SHIFT_TYPES, now, BUSINESS_DATE, TZ);
  assert.equal(active?.name, 'SOIR');

  const decision = evaluatePeriodOpen(SHIFT_TYPES, MONDAY_SCHEDULES, now, BUSINESS_DATE, TZ);
  assert.equal(decision.shouldOpen, true);
  assert.equal(decision.selectedSchedule?.staffMemberName, 'Oumaima');
});

test('Monday 15:00 — closes MATIN on period handoff', () => {
  const now = at(BUSINESS_DATE, '15:00');
  const d = evaluateShiftClose(
    {
      id: 'matin-shift',
      status: 'OPEN',
      businessDate: BUSINESS_DATE,
      scheduledStartAt: at(BUSINESS_DATE, '08:00'),
      scheduledEndAt: at(BUSINESS_DATE, '15:00'),
      startedAt: at(BUSINESS_DATE, '08:00'),
      staffMemberId: KHADIJA,
      shiftTypeId: MATIN_ID,
    },
    now,
    BUSINESS_DATE,
    at(BUSINESS_DATE, '00:00'),
    undefined,
    '23:45',
    TZ,
    SOIR_ID,
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'PERIOD_HANDOFF');
});

test('Monday 08:10 — wrongly opened SOIR shift closes (before scheduled start)', () => {
  const now = at(BUSINESS_DATE, '08:10');
  const d = evaluateShiftClose(
    {
      id: 'soir-early',
      status: 'OPEN',
      businessDate: BUSINESS_DATE,
      scheduledStartAt: at(BUSINESS_DATE, '15:00'),
      scheduledEndAt: at(BUSINESS_DATE, '23:45'),
      startedAt: at(BUSINESS_DATE, '08:00'),
      staffMemberId: OUMAIMA,
      shiftTypeId: SOIR_ID,
    },
    now,
    BUSINESS_DATE,
    at(BUSINESS_DATE, '00:00'),
    undefined,
    '23:45',
    TZ,
    MATIN_ID,
  );
  assert.equal(d.close, true);
  assert.ok(d.reason === 'BEFORE_SCHEDULED_START' || d.reason === 'PERIOD_HANDOFF');
});

test('Monday 23:45 — daily close triggers for SOIR still open', () => {
  const d = evaluateShiftClose(
    {
      id: 'soir-shift',
      status: 'OPEN',
      businessDate: BUSINESS_DATE,
      scheduledStartAt: at(BUSINESS_DATE, '15:00'),
      scheduledEndAt: at(BUSINESS_DATE, '23:45'),
      startedAt: at(BUSINESS_DATE, '15:00'),
      staffMemberId: OUMAIMA,
      shiftTypeId: SOIR_ID,
    },
    at(BUSINESS_DATE, '23:45'),
    BUSINESS_DATE,
    at(BUSINESS_DATE, '00:00'),
    undefined,
    '23:45',
    TZ,
    SOIR_ID,
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'DAILY_CLOSE');
});

test('No schedule for active period — clear skip message', () => {
  const now = at(BUSINESS_DATE, '08:10');
  const decision = evaluatePeriodOpen(
    SHIFT_TYPES,
    [{ id: 'sched-soir', staffMemberId: OUMAIMA, staffMemberName: 'Oumaima', shiftTypeId: SOIR_ID }],
    now,
    BUSINESS_DATE,
    TZ,
  );
  assert.equal(decision.shouldOpen, false);
  assert.match(decision.reason, /no staff schedule for MATIN/i);
});

test('07:59 — before shop open, no period open', () => {
  const now = at(BUSINESS_DATE, '07:59');
  const decision = evaluatePeriodOpen(
    SHIFT_TYPES,
    MONDAY_SCHEDULES,
    now,
    BUSINESS_DATE,
    TZ,
    { beforeShopOpen: true },
  );
  assert.equal(decision.shouldOpen, false);
  assert.equal(decision.activeShiftType, null);
});

test('14:59 — MATIN shift stays open inside scheduled window', () => {
  const d = evaluateShiftClose(
    {
      id: 'matin-shift',
      status: 'OPEN',
      businessDate: BUSINESS_DATE,
      scheduledStartAt: at(BUSINESS_DATE, '08:00'),
      scheduledEndAt: at(BUSINESS_DATE, '15:00'),
      startedAt: at(BUSINESS_DATE, '08:00'),
      staffMemberId: KHADIJA,
      shiftTypeId: MATIN_ID,
    },
    at(BUSINESS_DATE, '14:59'),
    BUSINESS_DATE,
    at(BUSINESS_DATE, '00:00'),
    undefined,
    '23:45',
    TZ,
    MATIN_ID,
  );
  assert.equal(d.close, false);
});

test('15:00 — MATIN closes at schedule end when still open', () => {
  const d = evaluateShiftClose(
    {
      id: 'matin-shift',
      status: 'OPEN',
      businessDate: BUSINESS_DATE,
      scheduledStartAt: at(BUSINESS_DATE, '08:00'),
      scheduledEndAt: at(BUSINESS_DATE, '15:00'),
      startedAt: at(BUSINESS_DATE, '08:00'),
      staffMemberId: KHADIJA,
      shiftTypeId: MATIN_ID,
    },
    at(BUSINESS_DATE, '15:00'),
    BUSINESS_DATE,
    at(BUSINESS_DATE, '00:00'),
    undefined,
    '23:45',
    TZ,
    MATIN_ID,
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'SCHEDULE_END');
});

test('next day — orphan shift from previous businessDate closes', () => {
  const d = evaluateShiftClose(
    {
      id: 's1',
      status: 'OPEN',
      businessDate: '2026-07-05',
      scheduledStartAt: null,
      scheduledEndAt: null,
      startedAt: at('2026-07-05', '08:00'),
      staffMemberId: KHADIJA,
    },
    at(BUSINESS_DATE, '08:15'),
    BUSINESS_DATE,
    at(BUSINESS_DATE, '00:00'),
    undefined,
    '23:45',
    TZ,
  );
  assert.equal(d.close, true);
  assert.equal(d.reason, 'STALE_BUSINESS_DATE');
});

console.log('All auto-shift-check scenario tests passed.');
