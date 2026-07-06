/**
 * Pure period-selection rules for auto-shift (no database).
 * Resolves which ShiftType window contains "now" and whether a shift should open.
 */

import { buildScheduledDatetime } from '../../utils/time';

export type ShiftTypeWindow = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  sortOrder?: number;
};

export type ScheduleSlot = {
  id: string;
  staffMemberId: string;
  staffMemberName: string;
  shiftTypeId: string | null;
};

export type PeriodOpenDecision = {
  shouldOpen: boolean;
  reason: string;
  activeShiftType: ShiftTypeWindow | null;
  selectedSchedule: ScheduleSlot | null;
};

/** True when startTime <= now < endTime in the business timezone. */
export function isWithinShiftPeriod(
  startHHmm: string,
  endHHmm: string,
  now: Date,
  businessDate: string,
  tz: string,
): boolean {
  const start = buildScheduledDatetime(businessDate, startHHmm, tz);
  const end   = buildScheduledDatetime(businessDate, endHHmm, tz);
  return now >= start && now < end;
}

/** Active period shift type: startTime <= local now < endTime. */
export function findActiveShiftTypeAtTime(
  types: ShiftTypeWindow[],
  now: Date,
  businessDate: string,
  tz: string,
): ShiftTypeWindow | null {
  const active = types
    .filter((st) => isWithinShiftPeriod(st.startTime, st.endTime, now, businessDate, tz))
    .sort((a, b) => {
      const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (order !== 0) return order;
      return a.startTime.localeCompare(b.startTime);
    });

  return active[0] ?? null;
}

/** Pick the schedule row for today's active shift type. */
export function selectScheduleForActiveShiftType(
  schedules: ScheduleSlot[],
  activeShiftTypeId: string,
): ScheduleSlot | null {
  const matches = schedules.filter((s) => s.shiftTypeId === activeShiftTypeId);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    return [...matches].sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
  }
  return matches[0] ?? null;
}

export function evaluatePeriodOpen(
  types: ShiftTypeWindow[],
  schedules: ScheduleSlot[],
  now: Date,
  businessDate: string,
  tz: string,
  opts?: { beforeShopOpen?: boolean },
): PeriodOpenDecision {
  if (opts?.beforeShopOpen) {
    return {
      shouldOpen:       false,
      reason:           'before shop open',
      activeShiftType:  null,
      selectedSchedule: null,
    };
  }

  const activeShiftType = findActiveShiftTypeAtTime(types, now, businessDate, tz);
  if (!activeShiftType) {
    return {
      shouldOpen:       false,
      reason:           'no active shift period for current local time',
      activeShiftType:  null,
      selectedSchedule: null,
    };
  }

  const selectedSchedule = selectScheduleForActiveShiftType(schedules, activeShiftType.id);
  if (!selectedSchedule) {
    return {
      shouldOpen:       false,
      reason:           `no staff schedule for ${activeShiftType.name} on this day`,
      activeShiftType,
      selectedSchedule: null,
    };
  }

  return {
    shouldOpen:       true,
    reason:           `open ${activeShiftType.name} for ${selectedSchedule.staffMemberName}`,
    activeShiftType,
    selectedSchedule,
  };
}

/** startedAt when auto-opening inside the active period window. */
export function resolveAutoShiftStartedAt(
  scheduledStartAt: Date,
  now: Date,
): Date {
  return now.getTime() >= scheduledStartAt.getTime() ? scheduledStartAt : now;
}
