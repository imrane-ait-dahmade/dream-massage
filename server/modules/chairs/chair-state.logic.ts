/**
 * Pure helpers for chair power aggregation / skip decisions.
 * Unit-tested without DB.
 */

export type PowerAgg = {
  min: number | null;
  max: number | null;
  sum: number;
  count: number;
};

export function createPowerAgg(initial?: number): PowerAgg {
  if (initial === undefined) {
    return { min: null, max: null, sum: 0, count: 0 };
  }
  return { min: initial, max: initial, sum: initial, count: 1 };
}

export function recordPowerSample(agg: PowerAgg, watts: number): PowerAgg {
  return {
    min: agg.min === null ? watts : Math.min(agg.min, watts),
    max: agg.max === null ? watts : Math.max(agg.max, watts),
    sum: agg.sum + watts,
    count: agg.count + 1,
  };
}

export function powerAggAverage(agg: PowerAgg): number | null {
  if (agg.count <= 0) return null;
  return Math.round((agg.sum / agg.count) * 100) / 100;
}

/** True when live watts changed enough to bother updating UI/memory. */
export function powerChanged(prev: number | null | undefined, next: number, epsilon = 0.05): boolean {
  if (prev === null || prev === undefined) return true;
  return Math.abs(prev - next) >= epsilon;
}

export type TransitionKind =
  | 'NONE'
  | 'IDLE_TO_MAYBE_ACTIVE'
  | 'MAYBE_ACTIVE_TO_IDLE'
  | 'MAYBE_ACTIVE_TO_ACTIVE'
  | 'ACTIVE_TO_MAYBE_FINISHED'
  | 'MAYBE_FINISHED_TO_ACTIVE'
  | 'MAYBE_FINISHED_TO_IDLE'
  | 'POWER_SAMPLE_ONLY'
  | 'OFFLINE'
  | 'ONLINE_RECOVERY';

export interface TransitionInput {
  status: string;
  powerWatts: number;
  isOnline: boolean;
  startThresholdWatts: number;
  stopThresholdWatts: number;
  startConfirmSeconds: number;
  stopConfirmSeconds: number;
  maybeActiveSinceMs: number | null;
  maybeFinishedSinceMs: number | null;
  nowMs: number;
}

/**
 * Decide the business transition for one reading.
 * Debounce windows preserved (startConfirm / stopConfirm).
 */
export function decideTransition(input: TransitionInput): TransitionKind {
  if (!input.isOnline) {
    return input.status === 'OFFLINE' ? 'NONE' : 'OFFLINE';
  }
  if (input.status === 'OFFLINE') return 'ONLINE_RECOVERY';

  const {
    status,
    powerWatts,
    startThresholdWatts,
    stopThresholdWatts,
    startConfirmSeconds,
    stopConfirmSeconds,
    maybeActiveSinceMs,
    maybeFinishedSinceMs,
    nowMs,
  } = input;

  switch (status) {
    case 'IDLE':
      return powerWatts >= startThresholdWatts ? 'IDLE_TO_MAYBE_ACTIVE' : 'NONE';
    case 'MAYBE_ACTIVE': {
      if (powerWatts < startThresholdWatts) return 'MAYBE_ACTIVE_TO_IDLE';
      if (maybeActiveSinceMs !== null) {
        const elapsed = (nowMs - maybeActiveSinceMs) / 1000;
        if (elapsed >= startConfirmSeconds) return 'MAYBE_ACTIVE_TO_ACTIVE';
      }
      return 'NONE';
    }
    case 'ACTIVE':
      if (powerWatts <= stopThresholdWatts) return 'ACTIVE_TO_MAYBE_FINISHED';
      return 'POWER_SAMPLE_ONLY';
    case 'MAYBE_FINISHED': {
      if (powerWatts > stopThresholdWatts) return 'MAYBE_FINISHED_TO_ACTIVE';
      if (maybeFinishedSinceMs !== null) {
        const elapsed = (nowMs - maybeFinishedSinceMs) / 1000;
        if (elapsed >= stopConfirmSeconds) return 'MAYBE_FINISHED_TO_IDLE';
      }
      return 'NONE';
    }
    default:
      return 'NONE';
  }
}

/** True when this transition requires a DB write (not mere power sampling). */
export function transitionNeedsDbWrite(kind: TransitionKind): boolean {
  return kind !== 'NONE' && kind !== 'POWER_SAMPLE_ONLY';
}
