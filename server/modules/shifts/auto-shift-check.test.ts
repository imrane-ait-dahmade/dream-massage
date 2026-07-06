/**
 * Scenario tests for auto-shift period selection, reconciliation, and close timing.
 * Run: npm run test:auto-shift-check
 */
import assert from 'node:assert/strict';
import { buildScheduledDatetime } from '../../utils/time';
import {
  evaluatePeriodOpen,
  getActiveShiftTypeForTime,
  getTodayScheduleForShiftType,
  reconcileOpenShifts,
  resolveExpectedShift,
  type OpenShiftSnapshot,
  type ScheduleSlot,
  type ShiftTypeWindow,
} from './auto-shift-period.logic';
import { evaluateShiftClose } from './shift-close.logic';

const TZ = 'Africa/Casablanca';
const BUSINESS_DATE = '2026-07-06'; // Monday
const PREV_DATE = '2026-07-05';

const MATIN_ID = 'type-matin';
const SOIR_ID  = 'type-soir';
const STAFF_A  = 'staff-a';
const STAFF_B  = 'staff-b';

const SHIFT_TYPES: ShiftTypeWindow[] = [
  { id: MATIN_ID, name: 'MATIN', startTime: '08:00', endTime: '15:00', sortOrder: 1 },
  { id: SOIR_ID,  name: 'SOIR',  startTime: '15:00', endTime: '23:45', sortOrder: 2 },
];

const MONDAY_SCHEDULES: ScheduleSlot[] = [
  { id: 'sched-matin', staffMemberId: STAFF_A, staffMemberName: 'Staff A', shiftTypeId: MATIN_ID, createdAt: '2026-01-01' },
  { id: 'sched-soir',  staffMemberId: STAFF_B, staffMemberName: 'Staff B', shiftTypeId: SOIR_ID, createdAt: '2026-01-02' },
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

function shift(partial: Partial<OpenShiftSnapshot> & { id: string }): OpenShiftSnapshot {
  return {
    staffMemberId:    STAFF_A,
    shiftTypeId:      MATIN_ID,
    businessDate:     BUSINESS_DATE,
    staffScheduleId:  'sched-matin',
    scheduledStartAt: at(BUSINESS_DATE, '08:00'),
    scheduledEndAt:   at(BUSINESS_DATE, '15:00'),
    startedAt:        at(BUSINESS_DATE, '08:00'),
    status:           'OPEN',
    ...partial,
  };
}

function reconcileAt(
  hhmm: string,
  openShifts: OpenShiftSnapshot[],
  schedules: ScheduleSlot[] = MONDAY_SCHEDULES,
  businessDate: string = BUSINESS_DATE,
  repairEnabled = true,
) {
  const now = at(businessDate, hhmm);
  const active = getActiveShiftTypeForTime(SHIFT_TYPES, now, businessDate, TZ);
  const { expected } = resolveExpectedShift(active, schedules, businessDate, TZ);
  return {
    plan: reconcileOpenShifts({
      openShifts,
      expected,
      now,
      businessDate,
      todayStartUtc: at(businessDate, '00:00'),
      tz: TZ,
      dailyCloseTime: '23:45',
      activeShiftTypeId: active?.id ?? null,
      repairEnabled,
    }),
    expected,
    active,
    now,
  };
}

console.log('auto-shift-check scenario tests');

// ── Period selection ───────────────────────────────────────────────────────────

test('07:59 — no active period, should not open', () => {
  const { plan, expected } = reconcileAt('07:59', []);
  assert.equal(expected, null);
  assert.equal(plan.shouldOpen, false);
  assert.equal(plan.toClose.length, 0);
});

test('08:00 — opens Matin staff from planning', () => {
  const { plan, expected } = reconcileAt('08:00', []);
  assert.equal(plan.shouldOpen, true);
  assert.equal(expected?.shiftTypeId, MATIN_ID);
  assert.equal(expected?.staffMemberId, STAFF_A);
});

test('10:00 — keeps correct Matin, no duplicate', () => {
  const { plan } = reconcileAt('10:00', [
    shift({ id: 's1' }),
  ]);
  assert.equal(plan.shouldOpen, false);
  assert.equal(plan.keepShiftId, 's1');
  assert.equal(plan.toClose.length, 0);
});

test('10:00 — repairs wrong staff', () => {
  const { plan } = reconcileAt('10:00', [
    shift({ id: 'wrong', staffMemberId: STAFF_B }),
  ]);
  assert.equal(plan.shouldOpen, true);
  assert.equal(plan.toClose.length, 1);
  assert.equal(plan.toClose[0]!.reason, 'WRONG_STAFF');
  assert.equal(plan.repaired, true);
});

test('10:00 — repairs wrong shift type', () => {
  const { plan } = reconcileAt('10:00', [
    shift({
      id:    'wrong-type',
      shiftTypeId: SOIR_ID,
      scheduledStartAt: at(BUSINESS_DATE, '15:00'),
      scheduledEndAt: at(BUSINESS_DATE, '23:45'),
    }),
  ]);
  assert.ok(plan.toClose.length >= 1);
  assert.equal(plan.shouldOpen, true);
  assert.equal(plan.repaired, true);
});

test('15:00 — closes Matin and opens Soir', () => {
  const { plan, expected } = reconcileAt('15:00', [
    shift({ id: 'matin-open' }),
  ]);
  assert.ok(plan.toClose.some((c) => c.id === 'matin-open'));
  assert.equal(plan.shouldOpen, true);
  assert.equal(expected?.shiftTypeId, SOIR_ID);
  assert.equal(expected?.staffMemberId, STAFF_B);
});

test('18:00 — keeps correct Soir shift', () => {
  const { plan } = reconcileAt('18:00', [
    shift({
      id: 'soir',
      staffMemberId: STAFF_B,
      shiftTypeId: SOIR_ID,
      staffScheduleId: 'sched-soir',
      scheduledStartAt: at(BUSINESS_DATE, '15:00'),
      scheduledEndAt: at(BUSINESS_DATE, '23:45'),
      startedAt: at(BUSINESS_DATE, '15:00'),
    }),
  ]);
  assert.equal(plan.shouldOpen, false);
  assert.equal(plan.keepShiftId, 'soir');
});

test('23:45 — closes Soir shift', () => {
  const d = evaluateShiftClose(
    {
      id: 'soir',
      status: 'OPEN',
      businessDate: BUSINESS_DATE,
      scheduledStartAt: at(BUSINESS_DATE, '15:00'),
      scheduledEndAt: at(BUSINESS_DATE, '23:45'),
      startedAt: at(BUSINESS_DATE, '15:00'),
      staffMemberId: STAFF_B,
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

test('23:50 — no active period, closes remaining open shift', () => {
  const { plan } = reconcileAt('23:50', [
    shift({
      id: 'soir-late',
      staffMemberId: STAFF_B,
      shiftTypeId: SOIR_ID,
      scheduledStartAt: at(BUSINESS_DATE, '15:00'),
      scheduledEndAt: at(BUSINESS_DATE, '23:45'),
      startedAt: at(BUSINESS_DATE, '15:00'),
    }),
  ]);
  assert.equal(plan.shouldOpen, false);
  assert.ok(plan.toClose.length >= 1);
});

test('next morning — closes orphan previous-day shift', () => {
  const { plan } = reconcileAt('08:00', [
    shift({
      id: 'orphan',
      businessDate: PREV_DATE,
      scheduledStartAt: at(PREV_DATE, '08:00'),
      scheduledEndAt: at(PREV_DATE, '15:00'),
      startedAt: at(PREV_DATE, '08:00'),
    }),
  ]);
  assert.ok(
    plan.toClose.some((c) => c.reason === 'STALE_BUSINESS_DATE' || c.reason === 'SCHEDULE_END'),
  );
  assert.equal(plan.shouldOpen, true);
});

test('no planning for active period — does not open', () => {
  const now = at(BUSINESS_DATE, '08:10');
  const active = getActiveShiftTypeForTime(SHIFT_TYPES, now, BUSINESS_DATE, TZ);
  const resolved = resolveExpectedShift(
    active,
    [{ id: 'sched-soir', staffMemberId: STAFF_B, staffMemberName: 'Staff B', shiftTypeId: SOIR_ID }],
    BUSINESS_DATE,
    TZ,
  );
  assert.equal(resolved.expected, null);
  assert.match(resolved.reason, /no staff schedule/i);
  const plan = reconcileOpenShifts({
    openShifts: [],
    expected: resolved.expected,
    now,
    businessDate: BUSINESS_DATE,
    todayStartUtc: at(BUSINESS_DATE, '00:00'),
    tz: TZ,
    dailyCloseTime: '23:45',
    activeShiftTypeId: active?.id ?? null,
    repairEnabled: true,
  });
  assert.equal(plan.shouldOpen, false);
});

test('duplicate open shifts — reconciles to one correct shift', () => {
  const { plan } = reconcileAt('10:00', [
    shift({ id: 'keep', startedAt: at(BUSINESS_DATE, '08:00') }),
    shift({ id: 'dup', startedAt: at(BUSINESS_DATE, '08:05') }),
  ]);
  assert.equal(plan.keepShiftId, 'keep');
  assert.equal(plan.toClose.length, 1);
  assert.equal(plan.toClose[0]!.reason, 'DUPLICATE_OPEN_SHIFT');
  assert.equal(plan.shouldOpen, false);
});

test('duplicate open shifts — none match, close all and open correct', () => {
  const { plan } = reconcileAt('10:00', [
    shift({ id: 'bad1', staffMemberId: STAFF_B }),
    shift({ id: 'bad2', staffMemberId: STAFF_B, shiftTypeId: SOIR_ID, scheduledStartAt: at(BUSINESS_DATE, '15:00'), scheduledEndAt: at(BUSINESS_DATE, '23:45') }),
  ]);
  assert.equal(plan.toClose.length, 2);
  assert.equal(plan.shouldOpen, true);
});

test('multiple schedules same period — picks oldest createdAt', () => {
  const schedules: ScheduleSlot[] = [
    { id: 'z-new', staffMemberId: 'staff-z', staffMemberName: 'Z', shiftTypeId: MATIN_ID, createdAt: '2026-06-01' },
    { id: 'a-old', staffMemberId: 'staff-a2', staffMemberName: 'A2', shiftTypeId: MATIN_ID, createdAt: '2026-01-01' },
  ];
  const { schedule, warning } = getTodayScheduleForShiftType(schedules, MATIN_ID);
  assert.equal(schedule?.id, 'a-old');
  assert.ok(warning);
});

test('repair disabled — keeps conflicting manual shift, blocks open', () => {
  const { plan } = reconcileAt('10:00', [
    shift({ id: 'manual', staffMemberId: STAFF_B }),
  ], MONDAY_SCHEDULES, BUSINESS_DATE, false);
  assert.equal(plan.shouldOpen, false);
  assert.equal(plan.repairBlocked, true);
});

test('idempotency — 10 repeated reconciles on correct shift are stable', () => {
  const open = [shift({ id: 'stable' })];
  for (let i = 0; i < 10; i++) {
    const { plan } = reconcileAt('10:00', open);
    assert.equal(plan.shouldOpen, false);
    assert.equal(plan.keepShiftId, 'stable');
    assert.equal(plan.toClose.length, 0);
  }
});

test('08:10 — does not select Soir period', () => {
  const now = at(BUSINESS_DATE, '08:10');
  const active = getActiveShiftTypeForTime(SHIFT_TYPES, now, BUSINESS_DATE, TZ);
  assert.equal(active?.name, 'MATIN');
  const decision = evaluatePeriodOpen(SHIFT_TYPES, MONDAY_SCHEDULES, now, BUSINESS_DATE, TZ);
  assert.equal(decision.selectedSchedule?.staffMemberId, STAFF_A);
});

test('15:00 — Matin closes at schedule end', () => {
  const d = evaluateShiftClose(
    shift({ id: 'matin' }),
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

console.log('All auto-shift-check scenario tests passed.');
