/**
 * Pure close-eligibility rules for OPEN shifts.
 * Timezone-aware dates use APP_TIMEZONE (business calendar), not UTC midnight.
 */

import { buildScheduledDatetime } from '../../utils/time';

/** Safety cap for OPEN shifts without a scheduled end (manual / legacy rows). */
export const DEFAULT_MAX_OPEN_SHIFT_MS = 14 * 60 * 60 * 1000;

export type ShiftCloseContext = {
  todayBusinessDate: string;
  todayStartUtc: Date;
  timezone: string;
  /** HH:mm shop-wide close (e.g. 23:45). When set, closes today's shifts at/after this time. */
  dailyCloseTime?: string;
  maxOpenMs?: number;
};

export type ShiftCloseCandidate = {
  id: string;
  status: string;
  businessDate: string | null;
  scheduledEndAt: Date | null;
  startedAt: Date;
  staffMemberId: string;
};

export type ShiftCloseDecision = {
  close: boolean;
  reason: string | null;
  endedAt: Date | null;
};

/**
 * Returns true when an OPEN shift should be auto-closed.
 * Never closes a current-day shift that is still inside its scheduled window.
 */
export function evaluateShiftClose(
  shift: ShiftCloseCandidate,
  now: Date,
  todayBusinessDate: string,
  todayStartUtc: Date,
  maxOpenMs: number = DEFAULT_MAX_OPEN_SHIFT_MS,
  dailyCloseTime?: string,
  timezone?: string,
): ShiftCloseDecision {
  if (shift.status !== 'OPEN') {
    return { close: false, reason: null, endedAt: null };
  }

  if (
    dailyCloseTime &&
    timezone &&
    shift.businessDate === todayBusinessDate
  ) {
    const dailyCloseAt = buildScheduledDatetime(todayBusinessDate, dailyCloseTime, timezone);
    if (now >= dailyCloseAt) {
      return { close: true, reason: 'DAILY_CLOSE', endedAt: dailyCloseAt };
    }
  }

  // Keep today's shift while still inside the planned end time.
  if (
    shift.businessDate === todayBusinessDate &&
    shift.scheduledEndAt &&
    shift.scheduledEndAt > now
  ) {
    return { close: false, reason: null, endedAt: null };
  }

  if (shift.scheduledEndAt && shift.scheduledEndAt <= now) {
    return {
      close: true,
      reason: 'SCHEDULE_END',
      endedAt: shift.scheduledEndAt,
    };
  }

  if (shift.businessDate && shift.businessDate < todayBusinessDate) {
    return { close: true, reason: 'STALE_BUSINESS_DATE', endedAt: now };
  }

  if (!shift.businessDate && shift.startedAt < todayStartUtc) {
    return { close: true, reason: 'STALE_STARTED_AT', endedAt: now };
  }

  const openDurationMs = now.getTime() - shift.startedAt.getTime();
  if (!shift.scheduledEndAt && openDurationMs > maxOpenMs) {
    return { close: true, reason: 'MAX_DURATION', endedAt: now };
  }

  return { close: false, reason: null, endedAt: null };
}

/** Before opening a new due shift, only close OPEN rows that are already eligible. */
export function shouldCloseBeforeHandoff(
  shift: ShiftCloseCandidate,
  now: Date,
  ctx: ShiftCloseContext,
): boolean {
  return evaluateShiftClose(
    shift,
    now,
    ctx.todayBusinessDate,
    ctx.todayStartUtc,
    ctx.maxOpenMs,
    ctx.dailyCloseTime,
    ctx.timezone,
  ).close;
}
