/**
 * No-shift high-power loop suppression tests (no database).
 * Run: npm run test:chair-no-shift-block
 */
import assert from 'node:assert/strict';
import { decideTransition, type TransitionKind } from './chair-state.logic';
import {
  shouldClearStartBlock,
  shouldSuppressBusinessTransition,
  startBlockReasonFromShiftAnomaly,
  type StartBlockReason,
} from './chair-no-shift-block.logic';
import { shouldBlockFinancialSessionCreation } from '../shifts/shift-open-resolve.logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

type ShiftResolve = { shiftId: string | null; anomalyType: string | null };

type SimState = {
  status: string;
  maybeActiveSinceMs: number | null;
  startBlockReason: StartBlockReason | null;
  sessions: number;
  events: string[];
  dbWrites: number;
  shiftReads: number;
};

const CFG = {
  startThresholdWatts: 7,
  stopThresholdWatts: 5,
  startConfirmSeconds: 30,
  stopConfirmSeconds: 180,
  pollMs: 5_000,
};

/** Mirrors processChairReading block + decideTransition flow without DB. */
function simulateTick(
  state: SimState,
  powerWatts: number,
  nowMs: number,
  selfStartEnabled: boolean,
  resolveShift: () => ShiftResolve,
): TransitionKind | 'SUPPRESSED' {
  if (state.startBlockReason != null) {
    if (shouldClearStartBlock(state.startBlockReason, powerWatts, CFG.startThresholdWatts)) {
      state.startBlockReason = null;
    } else if (shouldSuppressBusinessTransition(
      state.startBlockReason,
      powerWatts,
      CFG.startThresholdWatts,
    )) {
      return 'SUPPRESSED';
    }
  }

  const kind = decideTransition({
    status: state.status,
    powerWatts,
    isOnline: true,
    startThresholdWatts: CFG.startThresholdWatts,
    stopThresholdWatts: CFG.stopThresholdWatts,
    startConfirmSeconds: CFG.startConfirmSeconds,
    stopConfirmSeconds: CFG.stopConfirmSeconds,
    maybeActiveSinceMs: state.maybeActiveSinceMs,
    maybeFinishedSinceMs: null,
    nowMs,
  });

  if (kind === 'NONE' || kind === 'POWER_SAMPLE_ONLY') return kind;

  switch (kind) {
    case 'IDLE_TO_MAYBE_ACTIVE':
      state.status = 'MAYBE_ACTIVE';
      state.maybeActiveSinceMs = nowMs;
      state.events.push('START_DETECTED');
      state.dbWrites += 2;
      break;
    case 'MAYBE_ACTIVE_TO_IDLE':
      state.status = 'IDLE';
      state.maybeActiveSinceMs = null;
      state.dbWrites += 2;
      break;
    case 'MAYBE_ACTIVE_TO_ACTIVE': {
      state.shiftReads += 1;
      const shift = resolveShift();
      if (shouldBlockFinancialSessionCreation(selfStartEnabled, shift)) {
        state.status = 'IDLE';
        state.maybeActiveSinceMs = null;
        state.startBlockReason = startBlockReasonFromShiftAnomaly(shift.anomalyType);
        state.events.push('SESSION_BLOCKED_NO_SHIFT');
        state.dbWrites += 2;
      } else {
        state.status = 'ACTIVE';
        state.maybeActiveSinceMs = null;
        state.startBlockReason = null;
        state.sessions += 1;
        state.dbWrites += 4;
        state.events.push('SESSION_STARTED');
      }
      break;
    }
    default:
      break;
  }

  return kind;
}

function runHighPowerEpisode(
  durationMs: number,
  resolveShift: () => ShiftResolve,
  selfStartEnabled = true,
): SimState {
  const state: SimState = {
    status: 'IDLE',
    maybeActiveSinceMs: null,
    startBlockReason: null,
    sessions: 0,
    events: [],
    dbWrites: 0,
    shiftReads: 0,
  };
  const startMs = 1_000_000;
  for (let t = 0; t <= durationMs; t += CFG.pollMs) {
    simulateTick(state, 30, startMs + t, selfStartEnabled, resolveShift);
  }
  return state;
}

console.log('chair-no-shift-block tests');

test('pure: shouldClearStartBlock when power drops below threshold', () => {
  assert.equal(
    shouldClearStartBlock('NO_OPEN_SHIFT', 4, 7),
    true,
  );
  assert.equal(
    shouldSuppressBusinessTransition('NO_OPEN_SHIFT', 30, 7),
    true,
  );
});

test('TEST A — 20 min high power, no shift: bounded events', () => {
  const state = runHighPowerEpisode(
    20 * 60_000,
    () => ({ shiftId: null, anomalyType: 'NO_OPEN_SHIFT' }),
  );
  assert.equal(state.sessions, 0);
  assert.equal(state.events.filter((e) => e === 'START_DETECTED').length, 1);
  assert.equal(state.events.filter((e) => e === 'SESSION_BLOCKED_NO_SHIFT').length, 1);
  assert.equal(state.shiftReads, 1);
  assert.ok(state.dbWrites <= 8, `expected bounded writes, got ${state.dbWrites}`);
  assert.ok(
    state.events.length <= 2,
    `expected at most 2 events, got ${state.events.length}: ${state.events.join(',')}`,
  );
});

test('TEST B — power drop resets block; new episode allowed', () => {
  const state: SimState = {
    status: 'IDLE',
    maybeActiveSinceMs: null,
    startBlockReason: null,
    sessions: 0,
    events: [],
    dbWrites: 0,
    shiftReads: 0,
  };
  const t0 = 0;
  simulateTick(state, 30, t0, true, () => ({ shiftId: null, anomalyType: 'NO_OPEN_SHIFT' }));
  for (let i = 1; i <= 7; i += 1) {
    simulateTick(state, 30, t0 + i * CFG.startConfirmSeconds * 1000, true, () => ({
      shiftId: null,
      anomalyType: 'NO_OPEN_SHIFT',
    }));
  }
  assert.equal(state.startBlockReason, 'NO_OPEN_SHIFT');
  assert.equal(state.events.filter((e) => e === 'SESSION_BLOCKED_NO_SHIFT').length, 1);

  simulateTick(state, 3, t0 + 60_000, true, () => ({
    shiftId: null,
    anomalyType: 'NO_OPEN_SHIFT',
  }));
  assert.equal(state.startBlockReason, null);

  for (let i = 0; i <= 8; i += 1) {
    simulateTick(state, 30, t0 + 70_000 + i * CFG.pollMs, true, () => ({
      shiftId: null,
      anomalyType: 'NO_OPEN_SHIFT',
    }));
  }
  assert.equal(state.events.filter((e) => e === 'SESSION_BLOCKED_NO_SHIFT').length, 2);
  assert.equal(state.events.filter((e) => e === 'START_DETECTED').length, 2);
});

test('TEST C — shift start while power high clears block and allows session', () => {
  const state: SimState = {
    status: 'IDLE',
    maybeActiveSinceMs: null,
    startBlockReason: null,
    sessions: 0,
    events: [],
    dbWrites: 0,
    shiftReads: 0,
  };
  let shiftOpen = false;
  const resolve = (): ShiftResolve =>
    shiftOpen
      ? { shiftId: 'shift-matin', anomalyType: null }
      : { shiftId: null, anomalyType: 'NO_OPEN_SHIFT' };

  const t0 = 0;
  for (let t = 0; t <= 35_000; t += CFG.pollMs) {
    simulateTick(state, 30, t0 + t, true, resolve);
  }
  assert.equal(state.startBlockReason, 'NO_OPEN_SHIFT');
  assert.equal(state.sessions, 0);

  shiftOpen = true;
  state.startBlockReason = null;

  for (let t = 40_000; t <= 80_000; t += CFG.pollMs) {
    simulateTick(state, 30, t0 + t, true, resolve);
  }
  assert.equal(state.sessions, 1);
  assert.equal(state.events.filter((e) => e === 'SESSION_STARTED').length, 1);
  assert.equal(state.events.filter((e) => e === 'SESSION_BLOCKED_NO_SHIFT').length, 1);
});

test('TEST D — ticks while blocked: no extra shift reads or events', () => {
  const state: SimState = {
    status: 'IDLE',
    maybeActiveSinceMs: null,
    startBlockReason: 'NO_OPEN_SHIFT',
    sessions: 0,
    events: [],
    dbWrites: 0,
    shiftReads: 0,
  };
  for (let i = 0; i < 500; i += 1) {
    const result = simulateTick(state, 30, i * CFG.pollMs, true, () => {
      state.shiftReads += 1;
      return { shiftId: null, anomalyType: 'NO_OPEN_SHIFT' };
    });
    assert.equal(result, 'SUPPRESSED');
  }
  assert.equal(state.shiftReads, 0);
  assert.equal(state.events.length, 0);
  assert.equal(state.dbWrites, 0);
});

test('TEST E — restart (hydrate) allows one new detection then suppresses', () => {
  const state: SimState = {
    status: 'IDLE',
    maybeActiveSinceMs: null,
    startBlockReason: null,
    sessions: 0,
    events: [],
    dbWrites: 0,
    shiftReads: 0,
  };

  for (let t = 0; t <= 40_000; t += CFG.pollMs) {
    simulateTick(state, 30, t, true, () => ({ shiftId: null, anomalyType: 'NO_OPEN_SHIFT' }));
  }
  assert.equal(state.events.filter((e) => e === 'SESSION_BLOCKED_NO_SHIFT').length, 1);

  state.startBlockReason = null;
  state.status = 'IDLE';
  state.maybeActiveSinceMs = null;

  for (let t = 50_000; t <= 90_000; t += CFG.pollMs) {
    simulateTick(state, 30, t, true, () => ({ shiftId: null, anomalyType: 'NO_OPEN_SHIFT' }));
  }
  assert.equal(state.events.filter((e) => e === 'SESSION_BLOCKED_NO_SHIFT').length, 2);

  for (let t = 100_000; t <= 200_000; t += CFG.pollMs) {
    simulateTick(state, 30, t, true, () => ({ shiftId: null, anomalyType: 'NO_OPEN_SHIFT' }));
  }
  assert.equal(state.events.filter((e) => e === 'SESSION_BLOCKED_NO_SHIFT').length, 2);
});

test('TEST F — MULTIPLE_OPEN_SHIFTS: no session, no aggressive loop', () => {
  const state = runHighPowerEpisode(
    10 * 60_000,
    () => ({ shiftId: null, anomalyType: 'MULTIPLE_OPEN_SHIFTS' }),
  );
  assert.equal(state.sessions, 0);
  assert.equal(state.events.filter((e) => e === 'SESSION_BLOCKED_NO_SHIFT').length, 1);
  assert.equal(state.shiftReads, 1);
  assert.equal(state.startBlockReason, 'MULTIPLE_OPEN_SHIFTS');
});

console.log('\nAll chair-no-shift-block tests passed.');
