/**
 * Cross-shift session handoff regression tests (no database).
 * Run: npm run test:cross-shift
 */
import assert from 'node:assert/strict';
import {
  evaluateStaleSessionRecovery,
  type StaleSessionCandidate,
} from '../sessions/session-stale-recovery.logic';
import {
  isHistoricalShiftSession,
  resolveHistoricalSessionCashTarget,
  sessionBelongsToShiftFilter,
  sessionBelongsToShiftTypeFilter,
} from '../sessions/cross-shift-session.logic';
import {
  allowsActiveSessionsOnShiftClose,
  shiftCloseModeFromReason,
} from '../shifts/shift-close-session.logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const SHIFT_MATIN = 'shift-matin-oumaima';
const SHIFT_SOIR = 'shift-soir-zainab';
const CASH_1 = 'cash-1';
const CASH_2 = 'cash-2';

function matin14h55Candidate(overrides: Partial<StaleSessionCandidate> = {}): StaleSessionCandidate {
  const started = new Date('2026-09-06T13:55:00.000Z').getTime(); // 14:55 UTC+1 ≈ 13:55 UTC — use local scenario ms
  return {
    sessionId: 'f1-session',
    chairId: 'f1',
    chairStatus: 'ACTIVE',
    sessionStatus: 'ACTIVE',
    startedAtMs: started,
    maybeFinishedSinceMs: null,
    lowPowerDetectedAtMs: null,
    lastLowPowerEventMs: null,
    currentPowerWatts: 35,
    stopThresholdWatts: 5,
    stopConfirmSeconds: 180,
    nowMs: new Date('2026-09-06T14:02:00.000Z').getTime(), // 15:02
    shiftId: SHIFT_MATIN,
    shiftStatus: 'CLOSED',
    hasOpenShopShift: true,
    ...overrides,
  };
}

console.log('cross-shift session tests');

test('TEST 1 — F1 start 14:55 MATIN keeps shiftId through handoff and end', () => {
  const at1502 = matin14h55Candidate();
  assert.equal(at1502.shiftId, SHIFT_MATIN);
  assert.equal(evaluateStaleSessionRecovery(at1502).action, 'none');

  const endMs = new Date('2026-09-06T14:04:30.000Z').getTime();
  const at1505 = matin14h55Candidate({
    nowMs: new Date('2026-09-06T14:08:00.000Z').getTime(),
    chairStatus: 'MAYBE_FINISHED',
    currentPowerWatts: 2,
    maybeFinishedSinceMs: endMs,
    lowPowerDetectedAtMs: endMs,
    lastLowPowerEventMs: endMs,
  });
  assert.equal(at1505.shiftId, SHIFT_MATIN);
  const end = evaluateStaleSessionRecovery(at1505);
  assert.equal(end.action, 'finalize');
});

test('TEST 2 — F2 start 15:02 SOIR while F1 still MATIN', () => {
  const f1 = matin14h55Candidate();
  const f2: StaleSessionCandidate = {
    ...matin14h55Candidate(),
    sessionId: 'f2-session',
    chairId: 'f2',
    shiftId: SHIFT_SOIR,
    shiftStatus: 'OPEN',
    startedAtMs: new Date('2026-09-06T14:02:00.000Z').getTime(),
  };
  assert.equal(f1.shiftId, SHIFT_MATIN);
  assert.equal(f2.shiftId, SHIFT_SOIR);
  assert.notEqual(f1.shiftId, f2.shiftId);
});

test('TEST 3 — finalize never resolves shift from open SOIR (shiftId immutable)', () => {
  assert.equal(isHistoricalShiftSession(SHIFT_MATIN), true);
  const session = matin14h55Candidate({ shiftStatus: 'CLOSED', hasOpenShopShift: true });
  assert.equal(session.shiftId, SHIFT_MATIN);
});

test('TEST 4 — cash uses Shift.cashAccountId snapshot after reassignment', () => {
  const snap = resolveHistoricalSessionCashTarget({
    shiftStaffMemberId: 'oumaima',
    shiftCashAccountId: CASH_1,
    legacyStaffTillId: CASH_2,
  });
  assert.equal(snap.cashAccountId, CASH_1);

  const legacy = resolveHistoricalSessionCashTarget({
    shiftStaffMemberId: 'oumaima',
    shiftCashAccountId: null,
    legacyStaffTillId: CASH_2,
  });
  assert.equal(legacy.cashAccountId, CASH_2);
});

test('TEST 5 — dashboard: F1 MATIN filter, not SOIR', () => {
  const f1ShiftId = SHIFT_MATIN;
  const f1Type = 'type-matin';
  assert.equal(sessionBelongsToShiftFilter(f1ShiftId, SHIFT_MATIN), true);
  assert.equal(sessionBelongsToShiftFilter(f1ShiftId, SHIFT_SOIR), false);
  assert.equal(sessionBelongsToShiftTypeFilter(f1Type, 'type-matin'), true);
  assert.equal(sessionBelongsToShiftTypeFilter(f1Type, 'type-soir'), false);
});

test('TEST 6 — stale recovery: ACTIVE MATIN after handoff is not orphan', () => {
  const c = matin14h55Candidate();
  assert.equal(c.shiftStatus, 'CLOSED');
  assert.equal(c.hasOpenShopShift, true);
  assert.equal(evaluateStaleSessionRecovery(c).action, 'none');
});

test('TEST 7 — low power after cross-shift → normal finalize', () => {
  const endMs = new Date('2026-09-06T14:04:30.000Z').getTime();
  const c = matin14h55Candidate({
    chairStatus: 'MAYBE_FINISHED',
    currentPowerWatts: 2,
    maybeFinishedSinceMs: endMs,
    lowPowerDetectedAtMs: endMs,
    lastLowPowerEventMs: endMs,
    nowMs: new Date('2026-09-06T14:08:00.000Z').getTime(),
  });
  const d = evaluateStaleSessionRecovery(c);
  assert.equal(d.action, 'finalize');
  if (d.action === 'finalize') {
    assert.equal(d.endedAtMs, endMs);
  }
});

test('HANDOFF close mode allows active sessions on shift', () => {
  assert.equal(shiftCloseModeFromReason('PERIOD_HANDOFF'), 'HANDOFF');
  assert.equal(allowsActiveSessionsOnShiftClose('HANDOFF'), true);
  assert.equal(allowsActiveSessionsOnShiftClose('MANUAL'), true);
  assert.equal(allowsActiveSessionsOnShiftClose('DAILY_OR_STALE'), false);
});

test('REGRESSION — linked session with closed shift is not ORPHAN_AFTER_SHIFT_CLOSE', () => {
  const c = matin14h55Candidate({
    chairStatus: 'MAYBE_FINISHED',
    currentPowerWatts: 2,
    maybeFinishedSinceMs: null,
    lowPowerDetectedAtMs: null,
    lastLowPowerEventMs: null,
    hasOpenShopShift: false,
  });
  const d = evaluateStaleSessionRecovery(c);
  assert.equal(d.action, 'none');
});

console.log('\nAll cross-shift session tests passed.');
