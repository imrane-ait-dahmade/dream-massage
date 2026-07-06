/** Typed result from {@link runAutoShiftCheck} — safe for jobs, HTTP, and logs. */
export type AutoShiftCheckResult = {
  opened: boolean;
  closed: boolean;
  closedIds: string[];
  repaired: boolean;
  openFound: boolean;
  activeShiftId: string | null;
  activeShiftTypeId: string | null;
  activeShiftTypeName: string | null;
  activeStaffMemberId: string | null;
  activeStaffName: string | null;
  reason: string;
  /** @deprecated use `reason` */
  message: string;
  checkedAt: string;
  openedCount: number;
  closedCount: number;
};
