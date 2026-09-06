/**
 * Pure rules for stale ACTIVE session recovery (no database).
 */

export type StaleSessionCandidate = {
  sessionId: string;
  chairId: string;
  chairStatus: string;
  sessionStatus: string;
  startedAtMs: number;
  maybeFinishedSinceMs: number | null;
  lowPowerDetectedAtMs: number | null;
  lastLowPowerEventMs: number | null;
  currentPowerWatts: number | null;
  stopThresholdWatts: number;
  stopConfirmSeconds: number;
  nowMs: number;
  shiftId: string | null;
  shiftStatus: string | null;
  hasOpenShopShift: boolean;
};

export type StaleRecoveryDecision =
  | { action: 'none' }
  | { action: 'finalize'; endedAtMs: number; reason: string }
  | { action: 'mark_review'; reason: string };

/** Chair is in low-power / finishing state (not actively massaging). */
export function isLowPowerReading(
  powerWatts: number | null | undefined,
  stopThresholdWatts: number,
): boolean {
  if (powerWatts == null) return false;
  return powerWatts <= stopThresholdWatts;
}

/** Resolve best-effort end timestamp — never invent from `now` alone for long stale rows. */
export function resolveReliableEndMs(c: StaleSessionCandidate): number | null {
  if (c.lowPowerDetectedAtMs != null) return c.lowPowerDetectedAtMs;
  if (c.maybeFinishedSinceMs != null) return c.maybeFinishedSinceMs;
  if (c.lastLowPowerEventMs != null) return c.lastLowPowerEventMs;
  return null;
}

export function evaluateStaleSessionRecovery(c: StaleSessionCandidate): StaleRecoveryDecision {
  if (c.sessionStatus !== 'ACTIVE') return { action: 'none' };

  const lowPower = isLowPowerReading(c.currentPowerWatts, c.stopThresholdWatts);
  const endMs = resolveReliableEndMs(c);

  // MAYBE_FINISHED + debounce elapsed + reliable end + low power (or prior low-power record).
  if (c.chairStatus === 'MAYBE_FINISHED' && c.maybeFinishedSinceMs != null) {
    const elapsedSec = (c.nowMs - c.maybeFinishedSinceMs) / 1000;
    const hadLowPowerSignal =
      lowPower || c.lowPowerDetectedAtMs != null || c.lastLowPowerEventMs != null;
    if (elapsedSec >= c.stopConfirmSeconds && endMs != null && hadLowPowerSignal) {
      return {
        action: 'finalize',
        endedAtMs: endMs,
        reason:
          elapsedSec > c.stopConfirmSeconds + 60
            ? 'STALE_MAYBE_FINISHED'
            : 'MAYBE_FINISHED_DEBOUNCE_ELAPSED',
      };
    }
  }

  // Orphan: shift closed / no open shift, low power, reliable end, debounce elapsed.
  if (!c.hasOpenShopShift && lowPower && endMs != null) {
    const ageHours = (c.nowMs - c.startedAtMs) / 3_600_000;
    const debounceElapsed =
      c.maybeFinishedSinceMs != null &&
      (c.nowMs - c.maybeFinishedSinceMs) / 1000 >= c.stopConfirmSeconds;
    if (ageHours >= 1 && debounceElapsed) {
      return { action: 'finalize', endedAtMs: endMs, reason: 'ORPHAN_AFTER_SHIFT_CLOSE' };
    }
  }

  // Very stale with no reliable end — do not bill; flag for review.
  const ageHours = (c.nowMs - c.startedAtMs) / 3_600_000;
  if (ageHours >= 12 && endMs == null && !c.hasOpenShopShift) {
    return { action: 'mark_review', reason: 'STALE_NO_RELIABLE_END' };
  }

  return { action: 'none' };
}

/** True when shift must not close yet (real in-progress massage). */
export function isBlockingActiveSession(input: {
  sessionStatus: string;
  chairStatus: string;
  currentPowerWatts: number | null;
  stopThresholdWatts: number;
}): boolean {
  if (input.sessionStatus !== 'ACTIVE') return false;
  if (input.chairStatus === 'MAYBE_ACTIVE') return true;
  if (input.chairStatus === 'ACTIVE') {
    return !isLowPowerReading(input.currentPowerWatts, input.stopThresholdWatts);
  }
  // MAYBE_FINISHED with low power → recoverable, not blocking
  if (input.chairStatus === 'MAYBE_FINISHED') {
    return !isLowPowerReading(input.currentPowerWatts, input.stopThresholdWatts);
  }
  return false;
}

export function countBlockingSessions(
  rows: Array<{
    sessionStatus: string;
    chairStatus: string;
    currentPowerWatts: number | null;
    stopThresholdWatts: number;
  }>,
): number {
  return rows.filter((r) => isBlockingActiveSession(r)).length;
}
