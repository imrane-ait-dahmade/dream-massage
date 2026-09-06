/**
 * Shift close modes — handoff vs daily/stale safety (pure, no database).
 */

export type ShiftCloseMode = 'HANDOFF' | 'MANUAL' | 'DAILY_OR_STALE';

const HANDOFF_REASONS = new Set([
  'PERIOD_HANDOFF',
  'SCHEDULE_END',
  'BEFORE_NEW_OPEN',
  'BEFORE_SCHEDULED_START',
]);

const DAILY_OR_STALE_REASONS = new Set([
  'DAILY_CLOSE',
  'STALE_BUSINESS_DATE',
  'STALE_STARTED_AT',
  'MAX_DURATION',
]);

/** Map auto-close reason string to close mode. */
export function shiftCloseModeFromReason(reason: string | null | undefined): ShiftCloseMode {
  if (!reason) return 'MANUAL';
  if (HANDOFF_REASONS.has(reason)) return 'HANDOFF';
  if (DAILY_OR_STALE_REASONS.has(reason)) return 'DAILY_OR_STALE';
  return 'MANUAL';
}

/**
 * HANDOFF + MANUAL: shift may close while sessions started on that shift are still ACTIVE
 * (cross-shift boundary). DAILY_OR_STALE keeps blocking protections.
 */
export function allowsActiveSessionsOnShiftClose(mode: ShiftCloseMode): boolean {
  return mode === 'HANDOFF' || mode === 'MANUAL';
}
