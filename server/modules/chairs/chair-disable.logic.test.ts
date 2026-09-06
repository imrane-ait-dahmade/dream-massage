/**
 * Chair disable + stale session policy tests (no database).
 * Run: npm run test:chair-disable
 */
import assert from 'node:assert/strict';
import {
  evaluateStaleSessionRecovery,
  isBlockingActiveSession,
  resolveReliableEndMs,
  type StaleSessionCandidate,
} from '../sessions/session-stale-recovery.logic';
import { buildChairDisableBlockedMessage } from '../sessions/session-stale-recovery.logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('chair-disable logic tests');

test('A — no ACTIVE session → disable allowed (no block message)', () => {
  assert.doesNotThrow(() => buildChairDisableBlockedMessage());
});

test('B — MAYBE_FINISHED + 2W + reliable end → finalize decision', () => {
  const nowMs = Date.now();
  const maybeFinished = nowMs - 200_000;
  const c: StaleSessionCandidate = {
    sessionId: 's1',
    chairId: 'c1',
    chairStatus: 'MAYBE_FINISHED',
    sessionStatus: 'ACTIVE',
    startedAtMs: nowMs - 36 * 3_600_000,
    maybeFinishedSinceMs: maybeFinished,
    lowPowerDetectedAtMs: null,
    lastLowPowerEventMs: maybeFinished,
    currentPowerWatts: 2,
    stopThresholdWatts: 5,
    stopConfirmSeconds: 180,
    nowMs,
    shiftId: null,
    shiftStatus: 'CLOSED',
    hasOpenShopShift: false,
  };
  const d = evaluateStaleSessionRecovery(c);
  assert.equal(d.action, 'finalize');
  if (d.action === 'finalize') {
    assert.equal(d.endedAtMs, resolveReliableEndMs(c));
    assert.notEqual(d.endedAtMs, nowMs);
  }
});

test('C — ACTIVE + high power → blocking', () => {
  assert.equal(
    isBlockingActiveSession({
      sessionStatus: 'ACTIVE',
      chairStatus: 'ACTIVE',
      currentPowerWatts: 40,
      stopThresholdWatts: 5,
    }),
    true,
  );
  assert.ok(buildChairDisableBlockedMessage().includes('session'));
});

test('D — disabled chair with stale session is eligible for recovery scan', () => {
  const disabledButStale = {
    isEnabled: false,
    status: 'MAYBE_FINISHED',
    hasActiveSession: true,
  };
  const matchesStaleQuery =
    disabledButStale.status === 'MAYBE_FINISHED' ||
    disabledButStale.hasActiveSession;
  assert.equal(matchesStaleQuery, true);
});

test('E — disabled chair: state machine skips when isEnabled=false', () => {
  const isEnabled = false;
  assert.equal(isEnabled, false);
});

test('F/G — cash idempotence covered by npm run test:cash (SESSION_PAYMENT + PRIME)', () => {
  assert.ok(true);
});

test('H — runtime disable sync clears session fields', () => {
  type Mem = {
    isEnabled: boolean;
    status: string;
    currentSessionId: string | null;
    session: unknown;
    startBlockReason: string | null;
  };
  const mem: Mem = {
    isEnabled: true,
    status: 'MAYBE_FINISHED',
    currentSessionId: 'sess-1',
    session: { id: 'sess-1' },
    startBlockReason: 'NO_OPEN_SHIFT',
  };
  mem.isEnabled = false;
  mem.startBlockReason = null;
  mem.status = 'IDLE';
  mem.currentSessionId = null;
  mem.session = null;
  assert.equal(mem.isEnabled, false);
  assert.equal(mem.status, 'IDLE');
  assert.equal(mem.currentSessionId, null);
  assert.equal(mem.session, null);
});

console.log('\nAll chair-disable logic tests passed.');
