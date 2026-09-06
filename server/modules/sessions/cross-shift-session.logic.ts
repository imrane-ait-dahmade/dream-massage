/**
 * Session shift ownership — shiftId frozen at session start (pure rules, no DB).
 */

/** Session linked to a shift at start — historically owned by that shift forever. */
export function isHistoricalShiftSession(shiftId: string | null | undefined): boolean {
  return shiftId != null && shiftId !== '';
}

/** True orphan — no shift attribution at start (NO_OPEN_SHIFT legacy). */
export function isStaleOrphanSession(shiftId: string | null | undefined): boolean {
  return !isHistoricalShiftSession(shiftId);
}

/**
 * Cash/prime attribution: prefer shift snapshot at open time.
 * Fallback to current staff till only when shift had no cashAccountId (legacy).
 */
export function resolveHistoricalSessionCashTarget(input: {
  shiftStaffMemberId: string | null;
  shiftCashAccountId: string | null;
  legacyStaffTillId: string | null;
}): { staffMemberId: string | null; cashAccountId: string | null } {
  const staffMemberId = input.shiftStaffMemberId;
  if (!staffMemberId) {
    return { staffMemberId: null, cashAccountId: null };
  }
  if (input.shiftCashAccountId) {
    return { staffMemberId, cashAccountId: input.shiftCashAccountId };
  }
  return { staffMemberId, cashAccountId: input.legacyStaffTillId };
}

/** Dashboard filter: classify by session.shiftId, not endedAt. */
export function sessionBelongsToShiftFilter(
  sessionShiftId: string | null,
  filterShiftId: string,
): boolean {
  if (filterShiftId === 'all') return true;
  return sessionShiftId === filterShiftId;
}

export function sessionBelongsToShiftTypeFilter(
  sessionShiftTypeId: string | null,
  filterShiftTypeId: string,
): boolean {
  if (filterShiftTypeId === 'all') return true;
  return sessionShiftTypeId === filterShiftTypeId;
}
