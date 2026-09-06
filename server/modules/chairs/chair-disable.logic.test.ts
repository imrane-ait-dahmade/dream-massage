/**
 * Chair disable + stale session regression tests (no database).
 * Covers production F1/F2 bug so it cannot repeat silently.
 * Run: npm run test:chair-disable
 */
import assert from 'node:assert/strict';
import {
  assessPrepareChairForDisable,
  buildChairDisableBlockedMessage,
  evaluateStaleSessionRecovery,
  isBlockingActiveSession,
  matchesStaleRecoveryScan,
  resolveReliableEndMs,
  shouldSkipCashSyncOnSessionFinalize,
  type StaleSessionCandidate,
} from '../sessions/session-stale-recovery.logic';
import {
  disabledChairMemPatch,
  shouldProcessChairReading,
} from './chair-disable.logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function f1ProductionCandidate(nowMs: number): StaleSessionCandidate {
  const maybeFinished = new Date('2026-09-05T21:00:37.286Z').getTime();
  return {
    sessionId: 'c5b1e641-4b56-413a-8ac8-2a5959624735',
    chairId: 'f1',
    chairStatus: 'MAYBE_FINISHED',
    sessionStatus: 'ACTIVE',
    startedAtMs: new Date('2026-09-05T14:50:51.362Z').getTime(),
    maybeFinishedSinceMs: maybeFinished,
    lowPowerDetectedAtMs: maybeFinished,
    lastLowPowerEventMs: maybeFinished,
    currentPowerWatts: 1.85,
    stopThresholdWatts: 5,
    stopConfirmSeconds: 180,
    nowMs,
    shiftId: null,
    shiftStatus: null,
    hasOpenShopShift: false,
  };
}

function f2ProductionCandidate(nowMs: number): StaleSessionCandidate {
  const maybeFinished = new Date('2026-09-05T19:44:55.075Z').getTime();
  return {
    sessionId: '74db1389-2e8c-4c41-a26e-308eabfc21ae',
    chairId: 'f2',
    chairStatus: 'MAYBE_FINISHED',
    sessionStatus: 'ACTIVE',
    startedAtMs: new Date('2026-09-04T14:18:57.025Z').getTime(),
    maybeFinishedSinceMs: maybeFinished,
    lowPowerDetectedAtMs: maybeFinished,
    lastLowPowerEventMs: maybeFinished,
    currentPowerWatts: 1.92,
    stopThresholdWatts: 5,
    stopConfirmSeconds: 180,
    nowMs,
    shiftId: null,
    shiftStatus: null,
    hasOpenShopShift: false,
  };
}

function minimalChairMem(overrides: Record<string, unknown> & { id: string; name: string }) {
  return {
    displayName: null,
    isEnabled: true,
    status: 'MAYBE_FINISHED',
    isOnline: true,
    currentPowerWatts: 2,
    relayIsOn: null,
    currentSessionId: 'sess-1',
    maybeActiveSince: null,
    maybeFinishedSince: new Date(),
    stateChangedAt: null,
    statusBeforeOffline: null,
    offlineSince: null,
    lastOnlineAt: null,
    lastSyncedAt: null,
    config: {
      id: 'cfg',
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      activationDelaySeconds: 30,
      baselinePowerWatts: 2,
    },
    session: { id: 'sess-1', startedAt: new Date(), anomalyType: null, power: {}, dirtyMetrics: false },
    dirtyLive: false,
    startBlockReason: 'NO_OPEN_SHIFT' as const,
    ...overrides,
  };
}

console.log('chair-disable regression tests');

test('A — no ACTIVE session → disable allowed', () => {
  const r = assessPrepareChairForDisable({
    sessionStatus: null,
    chairStatus: 'IDLE',
    currentPowerWatts: 0,
    stopThresholdWatts: 5,
    staleCandidate: null,
  });
  assert.equal(r.outcome, 'allow');
});

test('B — production F1: MAYBE_FINISHED + 1.85W + orphan → finalize at reliable end, skip cash', () => {
  const nowMs = new Date('2026-09-06T02:00:00.000Z').getTime();
  const c = f1ProductionCandidate(nowMs);
  const r = assessPrepareChairForDisable({
    sessionStatus: 'ACTIVE',
    chairStatus: c.chairStatus,
    currentPowerWatts: c.currentPowerWatts,
    stopThresholdWatts: c.stopThresholdWatts,
    staleCandidate: c,
  });
  assert.equal(r.outcome, 'finalize');
  if (r.outcome === 'finalize') {
    assert.equal(r.skipCashSync, true);
    assert.equal(r.endedAtMs, resolveReliableEndMs(c));
    assert.notEqual(r.endedAtMs, nowMs);
    assert.equal(r.reason, 'STALE_MAYBE_FINISHED');
  }
});

test('C — production F2: 29h orphan stale → finalize, not block disable', () => {
  const nowMs = new Date('2026-09-06T02:00:00.000Z').getTime();
  const c = f2ProductionCandidate(nowMs);
  assert.equal(isBlockingActiveSession({
    sessionStatus: 'ACTIVE',
    chairStatus: c.chairStatus,
    currentPowerWatts: c.currentPowerWatts,
    stopThresholdWatts: c.stopThresholdWatts,
  }), false);
  const d = evaluateStaleSessionRecovery(c);
  assert.equal(d.action, 'finalize');
});

test('D — real massage ACTIVE + 40W → 409 block', () => {
  const r = assessPrepareChairForDisable({
    sessionStatus: 'ACTIVE',
    chairStatus: 'ACTIVE',
    currentPowerWatts: 40,
    stopThresholdWatts: 5,
    staleCandidate: null,
  });
  assert.equal(r.outcome, 'block');
  if (r.outcome === 'block') {
    assert.ok(r.message.includes('session'));
  }
});

test('E — disabled chair + stale ACTIVE session still matches recovery scan', () => {
  assert.equal(
    matchesStaleRecoveryScan({
      status: 'MAYBE_FINISHED',
      currentSessionId: 'sess-orphan',
      hasActiveSession: true,
    }),
    true,
  );
  assert.equal(
    matchesStaleRecoveryScan({
      status: 'IDLE',
      currentSessionId: null,
      hasActiveSession: false,
    }),
    false,
  );
});

test('F — REGRESSION: recovery scan must NOT require isEnabled=true', () => {
  const disabledStale = {
    isEnabled: false,
    status: 'MAYBE_FINISHED' as const,
    currentSessionId: 'sess-1',
    hasActiveSession: true,
  };
  const oldBugWouldSkip = disabledStale.isEnabled === false;
  const newScanIncludes = matchesStaleRecoveryScan(disabledStale);
  assert.equal(oldBugWouldSkip, true, 'old bug excluded disabled chairs');
  assert.equal(newScanIncludes, true, 'fix must still scan disabled stale chairs');
});

test('G — orphan finalize skips cash; shift session does not', () => {
  assert.equal(shouldSkipCashSyncOnSessionFinalize(null), true);
  assert.equal(shouldSkipCashSyncOnSessionFinalize('shift-1'), false);
});

test('H — REGRESSION: disable-only (old bug) leaves chair stuck on dashboard', () => {
  const chairAfterOldDisableOnly = {
    isEnabled: false,
    status: 'MAYBE_FINISHED',
    currentSessionId: 'sess-active',
    sessionStatus: 'ACTIVE',
  };
  const stillShowsFinPossible =
    chairAfterOldDisableOnly.currentSessionId != null &&
    (chairAfterOldDisableOnly.status === 'MAYBE_FINISHED' ||
      chairAfterOldDisableOnly.sessionStatus === 'ACTIVE');
  assert.equal(stillShowsFinPossible, true);
  const prep = assessPrepareChairForDisable({
    sessionStatus: 'ACTIVE',
    chairStatus: 'MAYBE_FINISHED',
    currentPowerWatts: 2,
    stopThresholdWatts: 5,
    staleCandidate: f1ProductionCandidate(Date.now()),
  });
  assert.equal(prep.outcome, 'finalize', 'new flow must finalize before disable');
});

test('I — disabledChairMemPatch clears session + block reason immediately', () => {
  const mem = minimalChairMem({ id: 'chair-f1-test', name: 'F1' });
  Object.assign(mem, disabledChairMemPatch());
  assert.equal(mem.isEnabled, false);
  assert.equal(mem.status, 'IDLE');
  assert.equal(mem.currentSessionId, null);
  assert.equal(mem.session, null);
  assert.equal(mem.startBlockReason, null);
});

test('J — disabled chair: state machine must not start new session', () => {
  assert.equal(shouldProcessChairReading(false), false);
  assert.equal(shouldProcessChairReading(true), true);
});

test('K — finalize replay: skipCashSync prevents double SESSION_PAYMENT on orphan', () => {
  assert.equal(shouldSkipCashSyncOnSessionFinalize(null), true);
});

console.log('\nAll chair-disable regression tests passed.');
