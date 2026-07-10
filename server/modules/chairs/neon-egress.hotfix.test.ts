/**
 * Neon egress hotfix — unit tests (no database).
 * Run: npx tsx modules/chairs/neon-egress.hotfix.test.ts
 */
import assert from 'node:assert/strict';
import {
  decideTransition,
  transitionNeedsDbWrite,
  createPowerAgg,
  recordPowerSample,
  powerAggAverage,
  powerChanged,
} from './chair-state.logic';
import {
  _resetCircuitForTests,
  _forceOpenForTests,
  allowDbAttempt,
  recordDbFailure,
  recordDbSuccess,
  getCircuitState,
  isTemporaryDbError,
  withDbCircuit,
  DbUnavailableError,
} from '../../utils/db-circuit-breaker';
import { cacheGet, cacheSet, cacheClear, cacheInvalidate } from '../../utils/memory-cache';
import { usageMetrics } from '../../utils/usage-metrics';

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).then(() => {
        console.log(`  ✓ ${name}`);
      }).catch((err: unknown) => {
        console.error(`  ✗ ${name}`);
        throw err;
      });
    }
    console.log(`  ✓ ${name}`);
    return Promise.resolve();
  } catch (err) {
    console.error(`  ✗ ${name}`);
    return Promise.reject(err);
  }
}

async function main() {
  console.log('neon-egress hotfix tests');

  await test('identical power → NONE (IDLE) — no DB write', () => {
    const kind = decideTransition({
      status: 'IDLE',
      powerWatts: 2.1,
      isOnline: true,
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      maybeActiveSinceMs: null,
      maybeFinishedSinceMs: null,
      nowMs: Date.now(),
    });
    assert.equal(kind, 'NONE');
    assert.equal(transitionNeedsDbWrite(kind), false);
  });

  await test('OFF → ACTIVE path: IDLE → MAYBE_ACTIVE when power >= 7W', () => {
    const kind = decideTransition({
      status: 'IDLE',
      powerWatts: 12,
      isOnline: true,
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      maybeActiveSinceMs: null,
      maybeFinishedSinceMs: null,
      nowMs: Date.now(),
    });
    assert.equal(kind, 'IDLE_TO_MAYBE_ACTIVE');
    assert.equal(transitionNeedsDbWrite(kind), true);
  });

  await test('MAYBE_ACTIVE → ACTIVE after startConfirm debounce', () => {
    const now = 1_000_000;
    const kind = decideTransition({
      status: 'MAYBE_ACTIVE',
      powerWatts: 12,
      isOnline: true,
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      maybeActiveSinceMs: now - 30_000,
      maybeFinishedSinceMs: null,
      nowMs: now,
    });
    assert.equal(kind, 'MAYBE_ACTIVE_TO_ACTIVE');
  });

  await test('ACTIVE → MAYBE_FINISHED respects stop threshold', () => {
    const kind = decideTransition({
      status: 'ACTIVE',
      powerWatts: 4,
      isOnline: true,
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      maybeActiveSinceMs: null,
      maybeFinishedSinceMs: null,
      nowMs: Date.now(),
    });
    assert.equal(kind, 'ACTIVE_TO_MAYBE_FINISHED');
  });

  await test('ACTIVE → OFF debounce: MAYBE_FINISHED waits stopConfirmSeconds', () => {
    const now = 1_000_000;
    const early = decideTransition({
      status: 'MAYBE_FINISHED',
      powerWatts: 3,
      isOnline: true,
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      maybeActiveSinceMs: null,
      maybeFinishedSinceMs: now - 60_000,
      nowMs: now,
    });
    assert.equal(early, 'NONE');

    const done = decideTransition({
      status: 'MAYBE_FINISHED',
      powerWatts: 3,
      isOnline: true,
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      maybeActiveSinceMs: null,
      maybeFinishedSinceMs: now - 180_000,
      nowMs: now,
    });
    assert.equal(done, 'MAYBE_FINISHED_TO_IDLE');
  });

  await test('power aggregation min/max/avg correct', () => {
    let agg = createPowerAgg(10);
    agg = recordPowerSample(agg, 20);
    agg = recordPowerSample(agg, 15);
    assert.equal(agg.min, 10);
    assert.equal(agg.max, 20);
    assert.equal(powerAggAverage(agg), 15);
    assert.equal(powerChanged(10, 10), false);
    assert.equal(powerChanged(10, 10.1), true);
  });

  await test('POWER_SAMPLE_ONLY does not need DB write', () => {
    const kind = decideTransition({
      status: 'ACTIVE',
      powerWatts: 12,
      isOnline: true,
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      maybeActiveSinceMs: null,
      maybeFinishedSinceMs: null,
      nowMs: Date.now(),
    });
    assert.equal(kind, 'POWER_SAMPLE_ONLY');
    assert.equal(transitionNeedsDbWrite(kind), false);
  });

  await test('circuit breaker blocks after consecutive failures', async () => {
    _resetCircuitForTests();
    assert.equal(allowDbAttempt(), true);
    recordDbFailure(new Error('data transfer quota exceeded'));
    recordDbFailure(new Error('data transfer quota exceeded'));
    recordDbFailure(new Error('data transfer quota exceeded'));
    assert.equal(getCircuitState(), 'open');
    assert.equal(allowDbAttempt(), false);

    await assert.rejects(
      () => withDbCircuit(async () => 'ok'),
      (err: unknown) => err instanceof DbUnavailableError,
    );

    recordDbSuccess();
    assert.equal(getCircuitState(), 'closed');
    assert.equal(allowDbAttempt(), true);
  });

  await test('isTemporaryDbError classifies Neon quota', () => {
    assert.equal(
      isTemporaryDbError(new Error('Your project has exceeded the data transfer quota')),
      true,
    );
    assert.equal(isTemporaryDbError(new Error('syntax error at or near')), false);
  });

  await test('memory cache respects key / user scope', () => {
    cacheClear();
    cacheSet('home:userA:today', { v: 1 }, 15_000);
    cacheSet('home:userB:today', { v: 2 }, 15_000);
    assert.equal(cacheGet<{ v: number }>('home:userA:today')?.v, 1);
    assert.equal(cacheGet<{ v: number }>('home:userB:today')?.v, 2);
    cacheInvalidate('home:userA:');
    assert.equal(cacheGet('home:userA:today'), undefined);
    assert.equal(cacheGet<{ v: number }>('home:userB:today')?.v, 2);
    cacheClear();
  });

  await test('realtime-job singleton guard is idempotent', () => {
    // Mirrors startRealtimeJob() process-level guard without loading env/DB.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const g = { __realtimeJobStarted: false };

    function start(): boolean {
      if (intervalId !== null || g.__realtimeJobStarted) return false;
      g.__realtimeJobStarted = true;
      intervalId = setInterval(() => {}, 60_000);
      return true;
    }
    function stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
        g.__realtimeJobStarted = false;
      }
    }

    assert.equal(start(), true);
    assert.equal(start(), false); // second start blocked
    assert.equal(g.__realtimeJobStarted, true);
    stop();
    assert.equal(intervalId, null);
    assert.equal(start(), true);
    stop();
  });

  await test('30-min simulated idle: high shelly ticks, zero transition DB writes', () => {
    usageMetrics.reset();
    const ticks = Math.floor((30 * 60_000) / 5000);
    let dbWrites = 0;
    for (let i = 0; i < ticks; i++) {
      usageMetrics.incr('shellyTicks');
      const kind = decideTransition({
        status: 'IDLE',
        powerWatts: 2.1,
        isOnline: true,
        startThresholdWatts: 7,
        stopThresholdWatts: 5,
        startConfirmSeconds: 30,
        stopConfirmSeconds: 180,
        maybeActiveSinceMs: null,
        maybeFinishedSinceMs: null,
        nowMs: i * 5000,
      });
      if (transitionNeedsDbWrite(kind)) dbWrites += 1;
    }
    const snap = usageMetrics.snapshot();
    assert.equal(snap.shellyTicks, 360);
    assert.equal(dbWrites, 0);
    usageMetrics.reset();
  });

  await test('_forceOpenForTests opens circuit', () => {
    _resetCircuitForTests();
    _forceOpenForTests();
    assert.equal(allowDbAttempt(), false);
    _resetCircuitForTests();
  });

  console.log('All neon-egress hotfix tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
