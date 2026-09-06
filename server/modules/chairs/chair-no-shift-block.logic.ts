/**
 * Pure rules for suppressing repeated start attempts when self-start blocks session creation.
 */

export type StartBlockReason = 'NO_OPEN_SHIFT' | 'MULTIPLE_OPEN_SHIFTS';

export function isPowerAtOrAboveStartThreshold(
  powerWatts: number,
  startThresholdWatts: number,
): boolean {
  return powerWatts >= startThresholdWatts;
}

/** Power dropped below start threshold → end of blocked episode. */
export function shouldClearStartBlock(
  startBlockReason: StartBlockReason | null,
  powerWatts: number,
  startThresholdWatts: number,
): boolean {
  if (startBlockReason == null) return false;
  return !isPowerAtOrAboveStartThreshold(powerWatts, startThresholdWatts);
}

/** While blocked and power still high → skip business transitions entirely. */
export function shouldSuppressBusinessTransition(
  startBlockReason: StartBlockReason | null,
  powerWatts: number,
  startThresholdWatts: number,
): boolean {
  if (startBlockReason == null) return false;
  return isPowerAtOrAboveStartThreshold(powerWatts, startThresholdWatts);
}

export function startBlockReasonFromShiftAnomaly(
  anomalyType: string | null,
): StartBlockReason {
  return anomalyType === 'MULTIPLE_OPEN_SHIFTS'
    ? 'MULTIPLE_OPEN_SHIFTS'
    : 'NO_OPEN_SHIFT';
}
