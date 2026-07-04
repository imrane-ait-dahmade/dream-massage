/**
 * Pure close-eligibility rules for OPEN shifts.
 * Timezone-aware dates use APP_TIMEZONE (business calendar), not UTC midnight.
 */

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

/** OPEN shifts that must be closed regardless of business date filters. */
export function evaluateShiftClose(
  shift: ShiftCloseCandidate,
  now: Date,
  todayBusinessDate: string,
  todayStartUtc: Date,
): ShiftCloseDecision {
  if (shift.status !== 'OPEN') {
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

  return { close: false, reason: null, endedAt: null };
}

/** When opening a new shift, any remaining OPEN row must be closed first (shop-wide). */
export function shouldForceCloseBeforeNewOpen(shift: ShiftCloseCandidate): boolean {
  return shift.status === 'OPEN';
}
