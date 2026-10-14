/**
 * Chair runtime ↔ DB sync rules — unit tests (no database).
 * Run: npx tsx modules/chairs/chair-runtime-db.logic.test.ts
 */
import assert from 'node:assert/strict';
import { createPowerAgg, recordPowerSample, powerAggAverage } from './chair-state.logic';
import {
  carryOverRuntimeState,
  mergePowerAgg,
  runtimeNeedsStaleRecovery,
} from './chair-runtime-db.logic';
import type { ChairMem } from './chair-runtime-cache';

function chair(overrides: Partial<ChairMem> = {}): ChairMem {
  return {
    id: 'c1',
    name: 'F1',
    displayName: null,
    isEnabled: true,
    status: 'IDLE',
    isOnline: true,
    currentPowerWatts: 2.1,
    relayIsOn: true,
    currentSessionId: null,
    maybeActiveSince: null,
    maybeFinishedSince: null,
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
      baselinePowerWatts: 2.1,
    },
    session: null,
    dirtyLive: false,
    startBlockReason: null,
    ...overrides,
  };
}

function session(id: string, power = createPowerAgg(10)) {
  return { id, startedAt: new Date(0), anomalyType: null, power, dirtyMetrics: false };
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('chair-runtime-db logic tests');

test('reconcile keeps full-session average (sum/count) for the same session', () => {
  let power = createPowerAgg(10);
  for (const w of [20, 30, 40]) power = recordPowerSample(power, w);
  const prev = chair({ status: 'ACTIVE', session: session('s1', power), currentSessionId: 's1' });
  const fromDb = chair({
    status: 'ACTIVE',
    currentSessionId: 's1',
    session: session('s1', { min: 10, max: 40, sum: 10, count: 1 }),
  });

  const merged = carryOverRuntimeState(prev, fromDb);
  assert.equal(merged.session?.power.count, 4);
  assert.equal(powerAggAverage(merged.session!.power), 25);
  assert.equal(merged.session?.power.min, 10);
  assert.equal(merged.session?.power.max, 40);
});

test('reconcile does not reuse power stats from a different session', () => {
  const prev = chair({ status: 'ACTIVE', session: session('old', { min: 1, max: 99, sum: 500, count: 10 }) });
  const fromDb = chair({ status: 'ACTIVE', session: session('new', createPowerAgg(12)) });
  const merged = carryOverRuntimeState(prev, fromDb);
  assert.equal(merged.session?.id, 'new');
  assert.equal(merged.session?.power.count, 1);
  assert.equal(merged.session?.power.max, 12);
});

test('reconcile drops memory session when DB has none (session ended elsewhere)', () => {
  const prev = chair({ status: 'ACTIVE', session: session('s1'), currentSessionId: 's1' });
  const fromDb = chair({ status: 'IDLE', session: null });
  const merged = carryOverRuntimeState(prev, fromDb);
  assert.equal(merged.session, null);
  assert.equal(merged.status, 'IDLE');
});

test('reconcile keeps no-shift start block while chair stays IDLE', () => {
  const prev = chair({ status: 'IDLE', startBlockReason: 'NO_OPEN_SHIFT' });
  const merged = carryOverRuntimeState(prev, chair({ status: 'IDLE' }));
  assert.equal(merged.startBlockReason, 'NO_OPEN_SHIFT');
});

test('start block is not carried onto a non-IDLE chair', () => {
  const prev = chair({ status: 'IDLE', startBlockReason: 'NO_OPEN_SHIFT' });
  const merged = carryOverRuntimeState(prev, chair({ status: 'ACTIVE', session: session('s1') }));
  assert.equal(merged.startBlockReason, null);
});

test('unflushed live fields survive re-hydrate and stay dirty', () => {
  const synced = new Date(1_000_000);
  const prev = chair({ dirtyLive: true, currentPowerWatts: 3.4, lastSyncedAt: synced, relayIsOn: false });
  const fromDb = chair({ currentPowerWatts: 2.1, lastSyncedAt: new Date(0), relayIsOn: true });
  const merged = carryOverRuntimeState(prev, fromDb);
  assert.equal(merged.currentPowerWatts, 3.4);
  assert.equal(merged.lastSyncedAt, synced);
  assert.equal(merged.relayIsOn, false);
  assert.equal(merged.dirtyLive, true);
});

test('flushed live fields come from DB', () => {
  const prev = chair({ dirtyLive: false, currentPowerWatts: 3.4 });
  const merged = carryOverRuntimeState(prev, chair({ currentPowerWatts: 2.1 }));
  assert.equal(merged.currentPowerWatts, 2.1);
  assert.equal(merged.dirtyLive, false);
});

test('first hydrate (no previous memory) uses DB values as-is', () => {
  const fromDb = chair({ status: 'ACTIVE', session: session('s1', createPowerAgg(9)) });
  assert.equal(carryOverRuntimeState(undefined, fromDb), fromDb);
});

test('mergePowerAgg: empty memory aggregate falls back to DB seed', () => {
  const merged = mergePowerAgg(createPowerAgg(), { min: 8, max: 15, sum: 8, count: 1 });
  assert.deepEqual(merged, { min: 8, max: 15, sum: 8, count: 1 });
});

test('stale recovery skipped when every chair is idle without session', () => {
  assert.equal(runtimeNeedsStaleRecovery([chair(), chair({ status: 'OFFLINE' })]), false);
  assert.equal(runtimeNeedsStaleRecovery([]), false);
});

test('stale recovery runs when a chair holds or may hold a session', () => {
  assert.equal(runtimeNeedsStaleRecovery([chair(), chair({ status: 'ACTIVE' })]), true);
  assert.equal(runtimeNeedsStaleRecovery([chair({ status: 'MAYBE_FINISHED' })]), true);
  assert.equal(runtimeNeedsStaleRecovery([chair({ status: 'OFFLINE', currentSessionId: 's1' })]), true);
  assert.equal(runtimeNeedsStaleRecovery([chair({ status: 'OFFLINE', session: session('s1') })]), true);
});

console.log(`All ${passed} chair-runtime-db logic tests passed.`);
