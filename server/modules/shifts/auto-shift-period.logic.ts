/**
 * Pure period-selection and reconciliation rules for auto-shift (no database).
 */

import { buildScheduledDatetime } from '../../utils/time';
import { evaluateShiftClose, type ShiftCloseCandidate } from './shift-close.logic';

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
  createdAt?: Date | string;
};

export type ExpectedShiftState = {
  staffMemberId: string;
  staffMemberName: string;
  staffScheduleId: string;
  shiftTypeId: string;
  shiftTypeName: string;
  businessDate: string;
  startHHmm: string;
  endHHmm: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
};

export type OpenShiftSnapshot = {
  id: string;
  staffMemberId: string;
  shiftTypeId: string | null;
  businessDate: string | null;
  staffScheduleId?: string | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  startedAt: Date;
  status: string;
};

export type ReconcileCloseAction = {
  id: string;
  reason: string;
};

export type ReconcilePlan = {
  toClose: ReconcileCloseAction[];
  keepShiftId: string | null;
  shouldOpen: boolean;
  reason: string;
  repaired: boolean;
  multipleSchedulesWarning: string | null;
  repairBlocked: boolean;
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
export function getActiveShiftTypeForTime(
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

/** @deprecated alias */
export const findActiveShiftTypeAtTime = getActiveShiftTypeForTime;

function scheduleSortKey(slot: ScheduleSlot): number {
  if (slot.createdAt instanceof Date) return slot.createdAt.getTime();
  if (typeof slot.createdAt === 'string') return new Date(slot.createdAt).getTime();
  return 0;
}

/** Pick today's schedule for an active shift type (deterministic: createdAt, then id). */
export function getTodayScheduleForShiftType(
  schedules: ScheduleSlot[],
  shiftTypeId: string,
): { schedule: ScheduleSlot | null; warning: string | null } {
  const matches = schedules.filter((s) => s.shiftTypeId === shiftTypeId);
  if (matches.length === 0) {
    return { schedule: null, warning: null };
  }

  const sorted = [...matches].sort((a, b) => {
    const byCreated = scheduleSortKey(a) - scheduleSortKey(b);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });

  const warning = matches.length > 1
    ? `multiple schedules for shift type — selected ${sorted[0]!.id} (oldest createdAt)`
    : null;

  return { schedule: sorted[0] ?? null, warning };
}

export function selectScheduleForActiveShiftType(
  schedules: ScheduleSlot[],
  activeShiftTypeId: string,
): ScheduleSlot | null {
  return getTodayScheduleForShiftType(schedules, activeShiftTypeId).schedule;
}

export function resolveExpectedShift(
  activeShiftType: ShiftTypeWindow | null,
  schedules: ScheduleSlot[],
  businessDate: string,
  tz: string,
): { expected: ExpectedShiftState | null; reason: string; multipleSchedulesWarning: string | null } {
  if (!activeShiftType) {
    return {
      expected: null,
      reason:   'no active shift period for current local time',
      multipleSchedulesWarning: null,
    };
  }

  const { schedule, warning } = getTodayScheduleForShiftType(schedules, activeShiftType.id);
  if (!schedule) {
    return {
      expected: null,
      reason:   `no staff schedule for ${activeShiftType.name} on this day`,
      multipleSchedulesWarning: null,
    };
  }

  const scheduledStartAt = buildScheduledDatetime(businessDate, activeShiftType.startTime, tz);
  const scheduledEndAt   = buildScheduledDatetime(businessDate, activeShiftType.endTime, tz);

  return {
    expected: {
      staffMemberId:   schedule.staffMemberId,
      staffMemberName: schedule.staffMemberName,
      staffScheduleId: schedule.id,
      shiftTypeId:     activeShiftType.id,
      shiftTypeName:   activeShiftType.name,
      businessDate,
      startHHmm:       activeShiftType.startTime,
      endHHmm:         activeShiftType.endTime,
      scheduledStartAt,
      scheduledEndAt,
    },
    reason: `expected ${activeShiftType.name} for ${schedule.staffMemberName}`,
    multipleSchedulesWarning: warning,
  };
}

export function shiftMatchesExpected(
  shift: OpenShiftSnapshot,
  expected: ExpectedShiftState,
): boolean {
  return (
    shift.status === 'OPEN'
    && shift.businessDate === expected.businessDate
    && shift.shiftTypeId === expected.shiftTypeId
    && shift.staffMemberId === expected.staffMemberId
  );
}

function toCloseCandidate(shift: OpenShiftSnapshot): ShiftCloseCandidate {
  return {
    id:               shift.id,
    status:           shift.status,
    businessDate:     shift.businessDate,
    scheduledStartAt: shift.scheduledStartAt,
    scheduledEndAt:   shift.scheduledEndAt,
    startedAt:        shift.startedAt,
    staffMemberId:    shift.staffMemberId,
    shiftTypeId:      shift.shiftTypeId,
  };
}

function mismatchReason(shift: OpenShiftSnapshot, expected: ExpectedShiftState): string {
  if (shift.businessDate !== expected.businessDate) return 'WRONG_BUSINESS_DATE';
  if (shift.shiftTypeId !== expected.shiftTypeId) return 'WRONG_SHIFT_TYPE';
  if (shift.staffMemberId !== expected.staffMemberId) return 'WRONG_STAFF';
  return 'WRONG_SHIFT';
}

/**
 * Decide which OPEN shifts to close, which to keep, and whether to open the expected shift.
 * Idempotent: a correct lone OPEN shift yields shouldOpen=false and toClose=[].
 */
export function reconcileOpenShifts(params: {
  openShifts: OpenShiftSnapshot[];
  expected: ExpectedShiftState | null;
  now: Date;
  businessDate: string;
  todayStartUtc: Date;
  tz: string;
  dailyCloseTime: string;
  activeShiftTypeId: string | null;
  repairEnabled: boolean;
}): ReconcilePlan {
  const {
    openShifts,
    expected,
    now,
    businessDate,
    todayStartUtc,
    tz,
    dailyCloseTime,
    activeShiftTypeId,
    repairEnabled,
  } = params;

  const toClose: ReconcileCloseAction[] = [];
  const matching: OpenShiftSnapshot[] = [];
  let repairBlocked = false;
  let repaired = false;

  for (const shift of openShifts) {
    const eligibility = evaluateShiftClose(
      toCloseCandidate(shift),
      now,
      businessDate,
      todayStartUtc,
      undefined,
      dailyCloseTime,
      tz,
      activeShiftTypeId,
    );

    if (eligibility.close) {
      toClose.push({ id: shift.id, reason: eligibility.reason ?? 'AUTO_CLOSE' });
      continue;
    }

    if (!expected) {
      toClose.push({ id: shift.id, reason: 'NO_ACTIVE_PERIOD' });
      continue;
    }

    if (!shiftMatchesExpected(shift, expected)) {
      if (!repairEnabled) {
        repairBlocked = true;
        continue;
      }
      toClose.push({ id: shift.id, reason: mismatchReason(shift, expected) });
      repaired = true;
      continue;
    }

    matching.push(shift);
  }

  if (repairBlocked && expected && matching.length === 0 && toClose.length === 0) {
    const conflicting = openShifts.find(
      (s) => !toClose.some((c) => c.id === s.id) && !shiftMatchesExpected(s, expected),
    );
    return {
      toClose:                  [],
      keepShiftId:              conflicting?.id ?? null,
      shouldOpen:               false,
      reason:                   'repair disabled — manual shift conflicts with planning',
      repaired:                 false,
      multipleSchedulesWarning: null,
      repairBlocked:            true,
    };
  }

  let keepShiftId: string | null = null;

  const wrongShiftClosed = toClose.some((action) => {
    const row = openShifts.find((s) => s.id === action.id);
    return Boolean(expected && row && !shiftMatchesExpected(row, expected));
  });
  if (wrongShiftClosed) repaired = true;

  if (matching.length > 0) {
    const sorted = [...matching].sort((a, b) => {
      const aSched = expected && a.staffScheduleId === expected.staffScheduleId ? 0 : 1;
      const bSched = expected && b.staffScheduleId === expected.staffScheduleId ? 0 : 1;
      if (aSched !== bSched) return aSched - bSched;
      return a.startedAt.getTime() - b.startedAt.getTime();
    });
    keepShiftId = sorted[0]!.id;

    for (const dup of sorted.slice(1)) {
      toClose.push({ id: dup.id, reason: 'DUPLICATE_OPEN_SHIFT' });
      repaired = true;
    }
  }

  const closeIds = new Set(toClose.map((c) => c.id));
  if (keepShiftId && closeIds.has(keepShiftId)) {
    keepShiftId = null;
  }

  const shouldOpen = Boolean(expected) && !keepShiftId;

  let reason: string;
  if (repairBlocked) {
    reason = 'repair disabled — manual shift conflicts with planning';
  } else if (!expected) {
    reason = 'no active shift period for current local time';
  } else if (keepShiftId && !shouldOpen) {
    reason = `correct ${expected.shiftTypeName} shift open for ${expected.staffMemberName}`;
  } else if (shouldOpen) {
    reason = `open ${expected!.shiftTypeName} for ${expected!.staffMemberName}`;
  } else {
    reason = 'no changes';
  }

  if (repaired && toClose.length > 0) {
    reason = `repaired: ${reason}`;
  }

  return {
    toClose,
    keepShiftId,
    shouldOpen,
    reason,
    repaired: repaired && toClose.length > 0,
    multipleSchedulesWarning: null,
    repairBlocked,
  };
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

  const activeShiftType = getActiveShiftTypeForTime(types, now, businessDate, tz);
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
