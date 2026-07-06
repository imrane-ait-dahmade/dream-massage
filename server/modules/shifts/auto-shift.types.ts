/** Typed result from {@link runAutoShiftCheck} — safe for jobs, HTTP, and logs. */
export type AutoShiftCheckResult = {
  opened: boolean;
  closed: boolean;
  closedIds: string[];
  openFound: boolean;
  activeShiftId: string | null;
  message: string;
  checkedAt: string;
  /** Count of shifts opened this run (informational). */
  openedCount: number;
  /** Count of shifts closed this run (informational). */
  closedCount: number;
};
