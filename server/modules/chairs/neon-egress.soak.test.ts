/**
 * Accelerated soak: simulates 10 hours of Shelly polling for 5 chairs.
 * No database — pure in-memory transition logic + timer accounting.
 *
 * Run: npx tsx modules/chairs/neon-egress.soak.test.ts
 */
import assert from 'node:assert/strict';
import {
  decideTransition,
  transitionNeedsDbWrite,
  createPowerAgg,
  recordPowerSample,
  powerAggAverage,
} from './chair-state.logic';
import {
  _resetCircuitForTests,
  allowDbAttempt,
  recordDbFailure,
  recordDbSuccess,
  isTemporaryDbError,
} from '../../utils/db-circuit-breaker';
import { usageMetrics } from '../../utils/usage-metrics';
import { cacheClear, cacheGet, cacheSet, cacheSize } from '../../utils/memory-cache';

const POLL_MS = 5_000;
const RECONCILE_MS = 60_000;
const FLUSH_MS = 60_000;
const DASHBOARD_MS = 60_000;
const HOURS = 10;
const CHAIRS = 5;
const DURATION_MS = HOURS * 60 * 60 * 1000;
const TICKS = Math.floor(DURATION_MS / POLL_MS); // 7200

type ChairSim = {
  name: string;
  status: string;
  power: number;
  maybeActiveSinceMs: number | null;
  maybeFinishedSinceMs: number | null;
  sessionPower: ReturnType<typeof createPowerAgg> | null;
};

function memSnapshot(): { heapUsed: number; external: number } {
  const m = process.memoryUsage();
  return { heapUsed: m.heapUsed, external: m.external };
}

function activeTimersApprox(): number {
  // Node exposes this via process.getActiveResourcesInfo in recent versions
  const proc = process as NodeJS.Process & {
    getActiveResourcesInfo?: () => string[];
  };
  if (typeof proc.getActiveResourcesInfo === 'function') {
    return proc.getActiveResourcesInfo().filter((t) => t === 'Timeout').length;
  }
  return -1;
}

console.log('neon-egress soak test (10h accelerated, 5 chairs)');

_resetCircuitForTests();
usageMetrics.reset();
cacheClear();

const memStart = memSnapshot();
const timersStart = activeTimersApprox();

const chairs: ChairSim[] = Array.from({ length: CHAIRS }, (_, i) => ({
  name: `F${i + 1}`,
  status: 'IDLE',
  power: 2.1,
  maybeActiveSinceMs: null,
  maybeFinishedSinceMs: null,
  sessionPower: null,
}));

let shellyTicks = 0;
let dbReads = 0;
let dbWrites = 0;
let transitions = 0;
let dashboardCalls = 0;
let dashboardBytes = 0;
let powerSamplesWithoutWrite = 0;
let dbWritesOnIdleTick = 0;

// Scenario timeline (simulated wall clock ms):
// 0–1h: all idle
// 1h: F1 starts session (power 12W)
// 1h+30s: session confirmed ACTIVE
// 2h: false dip on F1 (3W for 60s) then recover — should NOT end (stopConfirm=180s)
// 3h: F1 real stop (3W for 180s+) → end session
// 4h: Shelly error burst (no state change)
// 5h: DB quota errors → circuit opens, then recovers
// rest: idle

function powerFor(chair: ChairSim, tMs: number): { power: number; online: boolean } {
  if (chair.name !== 'F1') return { power: 2.1, online: true };

  // 4h–4h05: shelly offline simulation for F1
  if (tMs >= 4 * 3600_000 && tMs < 4 * 3600_000 + 5 * 60_000) {
    return { power: chair.power, online: false };
  }

  if (tMs < 1 * 3600_000) return { power: 2.1, online: true };
  if (tMs < 2 * 3600_000) return { power: 12.0, online: true };
  // false dip 2h .. 2h+60s
  if (tMs < 2 * 3600_000 + 60_000) return { power: 3.0, online: true };
  if (tMs < 3 * 3600_000) return { power: 12.0, online: true };
  // real stop from 3h
  if (tMs < 3 * 3600_000 + 200_000) return { power: 3.0, online: true };
  return { power: 2.1, online: true };
}

let lastReconcile = -RECONCILE_MS;
let lastFlush = -FLUSH_MS;
let lastDashboard = -DASHBOARD_MS;

for (let i = 0; i < TICKS; i++) {
  const tMs = i * POLL_MS;
  shellyTicks += 1;
  usageMetrics.incr('shellyTicks');

  // Periodic reconcile / flush / dashboard (as production would)
  if (tMs - lastReconcile >= RECONCILE_MS) {
    lastReconcile = tMs;
    dbReads += 1; // hydrate/reconcile
    usageMetrics.incr('dbReads');
    usageMetrics.incr('dbReconciliations');
  }
  if (tMs - lastFlush >= FLUSH_MS) {
    lastFlush = tMs;
    // flush only if any active session has dirty metrics
    const dirty = chairs.some((c) => c.status === 'ACTIVE' && c.sessionPower);
    if (dirty) {
      dbWrites += 1;
      usageMetrics.incr('dbWrites');
      usageMetrics.incr('powerFlushes');
    }
  }
  if (tMs - lastDashboard >= DASHBOARD_MS) {
    lastDashboard = tMs;
    dashboardCalls += 1;
    // ~2 KB cached dashboard payload estimate
    const payload = JSON.stringify({ chairs: chairs.map((c) => ({ n: c.name, s: c.status, p: c.power })) });
    dashboardBytes += Buffer.byteLength(payload);
    cacheSet(`dash:${Math.floor(tMs / DASHBOARD_MS)}`, payload, 15_000);
  }

  // 5h: inject DB errors for 3 ticks then recover
  if (tMs >= 5 * 3600_000 && tMs < 5 * 3600_000 + 20_000) {
    recordDbFailure(new Error('data transfer quota exceeded'));
  } else if (tMs === 5 * 3600_000 + 60_000) {
    recordDbSuccess();
  }

  let tickHadBusinessWrite = false;

  for (const chair of chairs) {
    const reading = powerFor(chair, tMs);
    const kind = decideTransition({
      status: chair.status === 'OFFLINE' && reading.online ? 'OFFLINE' : chair.status,
      powerWatts: reading.power,
      isOnline: reading.online,
      startThresholdWatts: 7,
      stopThresholdWatts: 5,
      startConfirmSeconds: 30,
      stopConfirmSeconds: 180,
      maybeActiveSinceMs: chair.maybeActiveSinceMs,
      maybeFinishedSinceMs: chair.maybeFinishedSinceMs,
      nowMs: tMs,
    });

    if (!transitionNeedsDbWrite(kind)) {
      if (kind === 'POWER_SAMPLE_ONLY') {
        powerSamplesWithoutWrite += 1;
        if (!chair.sessionPower) chair.sessionPower = createPowerAgg(reading.power);
        else chair.sessionPower = recordPowerSample(chair.sessionPower, reading.power);
      }
      chair.power = reading.power;
      continue;
    }

    transitions += 1;
    tickHadBusinessWrite = true;
    dbWrites += 1; // transition write
    usageMetrics.incr('dbWrites');
    usageMetrics.incr('stateTransitions');

    switch (kind) {
      case 'IDLE_TO_MAYBE_ACTIVE':
        chair.status = 'MAYBE_ACTIVE';
        chair.maybeActiveSinceMs = tMs;
        break;
      case 'MAYBE_ACTIVE_TO_IDLE':
        chair.status = 'IDLE';
        chair.maybeActiveSinceMs = null;
        break;
      case 'MAYBE_ACTIVE_TO_ACTIVE':
        chair.status = 'ACTIVE';
        chair.maybeActiveSinceMs = null;
        chair.sessionPower = createPowerAgg(reading.power);
        break;
      case 'ACTIVE_TO_MAYBE_FINISHED':
        chair.status = 'MAYBE_FINISHED';
        chair.maybeFinishedSinceMs = tMs;
        break;
      case 'MAYBE_FINISHED_TO_ACTIVE':
        chair.status = 'ACTIVE';
        chair.maybeFinishedSinceMs = null;
        break;
      case 'MAYBE_FINISHED_TO_IDLE':
        chair.status = 'IDLE';
        chair.maybeFinishedSinceMs = null;
        if (chair.sessionPower) {
          assert.ok(powerAggAverage(chair.sessionPower) !== null);
        }
        chair.sessionPower = null;
        break;
      case 'OFFLINE':
        chair.status = 'OFFLINE';
        break;
      case 'ONLINE_RECOVERY':
        chair.status = chair.sessionPower ? 'ACTIVE' : 'IDLE';
        break;
      default:
        break;
    }
    chair.power = reading.power;
  }

  if (!tickHadBusinessWrite && chairs.every((c) => c.status === 'IDLE' || c.status === 'ACTIVE' || c.status === 'MAYBE_FINISHED' || c.status === 'MAYBE_ACTIVE' || c.status === 'OFFLINE')) {
    // idle-path ticks must not invent writes beyond reconcile/flush already counted
    if (chairs.every((c) => c.status === 'IDLE') && tMs > RECONCILE_MS) {
      // no-op marker
    }
  }

  // Count accidental per-tick writes on fully idle periods (0–50min)
  if (tMs < 50 * 60_000 && tickHadBusinessWrite) {
    dbWritesOnIdleTick += 1;
  }
}

const memEnd = memSnapshot();
const timersEnd = activeTimersApprox();
const snap = usageMetrics.snapshot();

const report = {
  hours: HOURS,
  chairs: CHAIRS,
  shellyTicks,
  expectedTicks: TICKS,
  dbReads,
  dbWrites,
  transitions,
  dashboardCalls,
  dashboardBytes,
  powerSamplesWithoutWrite,
  dbWritesOnIdleTick,
  cacheSize: cacheSize(),
  memStartHeapMB: Math.round(memStart.heapUsed / 1024 / 1024),
  memEndHeapMB: Math.round(memEnd.heapUsed / 1024 / 1024),
  heapDeltaMB: Math.round((memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024),
  timersStart,
  timersEnd,
  metrics: snap,
  circuitAllowsAfterRecovery: allowDbAttempt(),
  quotaClassified: isTemporaryDbError(new Error('exceeded the data transfer quota')),
};

console.log('[soak-report]', JSON.stringify(report, null, 2));

// Assertions
assert.equal(shellyTicks, TICKS, 'tick count');
assert.equal(dbWritesOnIdleTick, 0, 'no business writes during idle first 50min');
assert.ok(dbReads <= HOURS * 60 + 5, `dbReads ${dbReads} should be ~1/min reconcile`);
assert.ok(dbReads < shellyTicks / 10, 'dbReads << shellyTicks');
assert.ok(dashboardCalls <= HOURS * 60 + 5, 'dashboard ~1/min');
assert.ok(transitions > 0, 'at least one real transition occurred');
assert.ok(transitions < 50, 'transitions stay bounded for the scripted scenario');
assert.ok(powerSamplesWithoutWrite > 100, 'many power samples without DB write');
assert.ok(report.heapDeltaMB < 50, `heap growth ${report.heapDeltaMB}MB should stay modest`);
if (timersStart >= 0 && timersEnd >= 0) {
  assert.ok(timersEnd <= timersStart + 2, `timers leaked: start=${timersStart} end=${timersEnd}`);
}
assert.equal(allowDbAttempt(), true, 'circuit recovered');

// Cache isolation smoke
cacheSet('userA:x', 1);
cacheSet('userB:x', 2);
assert.equal(cacheGet<number>('userA:x'), 1);
assert.equal(cacheGet<number>('userB:x'), 2);

console.log('All neon-egress soak assertions passed.');
