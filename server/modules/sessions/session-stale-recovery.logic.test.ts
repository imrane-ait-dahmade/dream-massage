/**
 * Pure logic tests for stale session recovery.
 * Run: npm run test:stale-recovery
 */
import assert from 'node:assert/strict';
import {
  evaluateStaleSessionRecovery,
  isBlockingActiveSession,
  resolveReliableEndMs,
  countBlockingSessions,
  matchesStaleRecoveryScan,
  shouldSkipCashSyncOnSessionFinalize,
  type StaleSessionCandidate,
} from './session-stale-recovery.logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('session-stale-recovery logic tests');

const BASE: StaleSessionCandidate = {
  sessionId: 's1',
  chairId: 'c1',
  chairStatus: 'MAYBE_FINISHED',
  sessionStatus: 'ACTIVE',
  startedAtMs: Date.now() - 8 * 3_600_000,
  maybeFinishedSinceMs: Date.now() - 200_000,
  lowPowerDetectedAtMs: null,
  lastLowPowerEventMs: null,
  currentPowerWatts: 2,
  stopThresholdWatts: 5,
  stopConfirmSeconds: 180,
  nowMs: Date.now(),
  shiftId: null,
  shiftStatus: 'CLOSED',
  hasOpenShopShift: false,
};

test('MAYBE_FINISHED + debounce elapsed + low power → finalize at maybeFinishedSince', () => {
  const c = { ...BASE };
  const endMs = c.maybeFinishedSinceMs!;
  const d = evaluateStaleSessionRecovery(c);
  assert.equal(d.action, 'finalize');
  if (d.action === 'finalize') {
    assert.equal(d.endedAtMs, endMs);
  }
});

test('MAYBE_FINISHED + debounce not elapsed → none', () => {
  const nowMs = Date.now();
  const c = {
    ...BASE,
    maybeFinishedSinceMs: nowMs - 30_000,
    nowMs,
  };
  const d = evaluateStaleSessionRecovery(c);
  assert.equal(d.action, 'none');
});

test('reliable end prefers lowPowerDetectedAt over maybeFinishedSince', () => {
  const low = Date.now() - 500_000;
  const c = { ...BASE, lowPowerDetectedAtMs: low };
  assert.equal(resolveReliableEndMs(c), low);
});

test('33h stale without reliable end → mark_review', () => {
  const c = {
    ...BASE,
    maybeFinishedSinceMs: null,
    lowPowerDetectedAtMs: null,
    lastLowPowerEventMs: null,
    startedAtMs: Date.now() - 33 * 3_600_000,
    chairStatus: 'MAYBE_FINISHED',
    currentPowerWatts: 2,
  };
  const d = evaluateStaleSessionRecovery(c);
  assert.equal(d.action, 'mark_review');
});

test('ACTIVE chair with high power blocks shift close', () => {
  assert.equal(
    isBlockingActiveSession({
      sessionStatus: 'ACTIVE',
      chairStatus: 'ACTIVE',
      currentPowerWatts: 50,
      stopThresholdWatts: 5,
    }),
    true,
  );
});

test('MAYBE_FINISHED + low power does not block shift close', () => {
  assert.equal(
    isBlockingActiveSession({
      sessionStatus: 'ACTIVE',
      chairStatus: 'MAYBE_FINISHED',
      currentPowerWatts: 2,
      stopThresholdWatts: 5,
    }),
    false,
  );
});

test('countBlockingSessions aggregates correctly', () => {
  const n = countBlockingSessions([
    {
      sessionStatus: 'ACTIVE',
      chairStatus: 'ACTIVE',
      currentPowerWatts: 40,
      stopThresholdWatts: 5,
    },
    {
      sessionStatus: 'ACTIVE',
      chairStatus: 'MAYBE_FINISHED',
      currentPowerWatts: 2,
      stopThresholdWatts: 5,
    },
  ]);
  assert.equal(n, 1);
});

test('matchesStaleRecoveryScan includes disabled chair with ACTIVE session', () => {
  assert.equal(
    matchesStaleRecoveryScan({
      status: 'MAYBE_FINISHED',
      currentSessionId: 'x',
      hasActiveSession: true,
    }),
    true,
  );
});

test('shouldSkipCashSyncOnSessionFinalize for NO_OPEN_SHIFT orphan', () => {
  assert.equal(shouldSkipCashSyncOnSessionFinalize(null), true);
  assert.equal(shouldSkipCashSyncOnSessionFinalize('shift-id'), false);
});

test('linked CLOSED shift session is not treated as orphan when shop closed', () => {
  const nowMs = Date.now();
  const c = {
    ...BASE,
    shiftId: 'shift-matin',
    shiftStatus: 'CLOSED',
    hasOpenShopShift: false,
    chairStatus: 'MAYBE_FINISHED',
    currentPowerWatts: 2,
    maybeFinishedSinceMs: nowMs - 200_000,
    lowPowerDetectedAtMs: nowMs - 200_000,
  };
  const d = evaluateStaleSessionRecovery(c);
  assert.equal(d.action, 'finalize');
  if (d.action === 'finalize') {
    assert.notEqual(d.reason, 'ORPHAN_AFTER_SHIFT_CLOSE');
  }
});

console.log('\nAll session-stale-recovery logic tests passed.');
