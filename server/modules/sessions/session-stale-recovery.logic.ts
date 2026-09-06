/**
 * Pure rules for stale ACTIVE session recovery (no database).
 */
import {
  isHistoricalShiftSession,
  isStaleOrphanSession,
} from './cross-shift-session.logic';

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

  // Cross-shift: real massage on historical shift — not stale (even if shift is CLOSED).
  if (
    isHistoricalShiftSession(c.shiftId) &&
    isBlockingActiveSession({
      sessionStatus: c.sessionStatus,
      chairStatus: c.chairStatus,
      currentPowerWatts: c.currentPowerWatts,
      stopThresholdWatts: c.stopThresholdWatts,
    })
  ) {
    return { action: 'none' };
  }

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

  // Orphan: no shift at start, shop closed, low power, reliable end, debounce elapsed.
  if (
    !c.hasOpenShopShift &&
    isStaleOrphanSession(c.shiftId) &&
    lowPower &&
    endMs != null
  ) {
    const ageHours = (c.nowMs - c.startedAtMs) / 3_600_000;
    const debounceElapsed =
      c.maybeFinishedSinceMs != null &&
      (c.nowMs - c.maybeFinishedSinceMs) / 1000 >= c.stopConfirmSeconds;
    if (ageHours >= 1 && debounceElapsed) {
      return { action: 'finalize', endedAtMs: endMs, reason: 'ORPHAN_AFTER_SHIFT_CLOSE' };
    }
  }

  // Very stale orphan with no reliable end — do not bill; flag for review.
  const ageHours = (c.nowMs - c.startedAtMs) / 3_600_000;
  if (ageHours >= 12 && endMs == null && !c.hasOpenShopShift && isStaleOrphanSession(c.shiftId)) {
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

export function buildChairDisableBlockedMessage(): string {
  return 'Impossible de désactiver ce fauteuil : une session est encore en cours.';
}

/** Recovery must scan disabled chairs with orphan ACTIVE sessions (regression: no isEnabled filter). */
export function matchesStaleRecoveryScan(chair: {
  status: string;
  currentSessionId: string | null;
  hasActiveSession: boolean;
}): boolean {
  if (chair.hasActiveSession) return true;
  if (
    chair.currentSessionId != null &&
    (chair.status === 'ACTIVE' || chair.status === 'MAYBE_FINISHED')
  ) {
    return true;
  }
  return false;
}

/** Orphan NO_OPEN_SHIFT sessions cannot credit cash — finalize without till sync. */
export function shouldSkipCashSyncOnSessionFinalize(shiftId: string | null): boolean {
  return shiftId == null;
}

export type ChairDisablePrepInput = {
  sessionStatus: string | null;
  chairStatus: string;
  currentPowerWatts: number | null;
  stopThresholdWatts: number;
  staleCandidate: StaleSessionCandidate | null;
};

export type ChairDisablePrepResult =
  | { outcome: 'allow' }
  | { outcome: 'block'; message: string }
  | {
      outcome: 'finalize';
      endedAtMs: number;
      reason: string;
      skipCashSync: boolean;
    }
  | { outcome: 'mark_review'; reason: string };

/** Pure policy for Settings disable — mirrors prepareChairForDisable(). */
export function assessPrepareChairForDisable(input: ChairDisablePrepInput): ChairDisablePrepResult {
  if (input.sessionStatus !== 'ACTIVE') {
    return { outcome: 'allow' };
  }

  if (
    isBlockingActiveSession({
      sessionStatus: input.sessionStatus,
      chairStatus: input.chairStatus,
      currentPowerWatts: input.currentPowerWatts,
      stopThresholdWatts: input.stopThresholdWatts,
    })
  ) {
    return { outcome: 'block', message: buildChairDisableBlockedMessage() };
  }

  if (!input.staleCandidate) {
    return { outcome: 'block', message: buildChairDisableBlockedMessage() };
  }

  const decision = evaluateStaleSessionRecovery(input.staleCandidate);
  if (decision.action === 'finalize') {
    return {
      outcome: 'finalize',
      endedAtMs: decision.endedAtMs,
      reason: decision.reason,
      skipCashSync: shouldSkipCashSyncOnSessionFinalize(input.staleCandidate.shiftId),
    };
  }
  if (decision.action === 'mark_review') {
    return { outcome: 'mark_review', reason: decision.reason };
  }

  return { outcome: 'block', message: buildChairDisableBlockedMessage() };
}
