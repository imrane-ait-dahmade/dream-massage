import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  buildScheduledDatetime,
  getBusinessDate,
  getDayBoundsUtc,
  getTimezone,
} from '../../utils/time';
import { shiftService } from './shift.service';
import type { AutoShiftCheckResult } from './auto-shift.types';
import { SCHEDULE_OPERATIONAL_WHERE } from '../archive/archive-filters';
import {
  getActiveShiftTypeForTime,
  reconcileOpenShifts,
  resolveAutoShiftStartedAt,
  resolveExpectedShift,
  type OpenShiftSnapshot,
  type ScheduleSlot,
  type ShiftTypeWindow,
} from './auto-shift-period.logic';

function autoShiftLog(message: string): void {
  logger.info(`AUTO_SHIFT: ${message}`);
}

function todayDayOfWeek(tz: string, now: Date = new Date()): number {
  const short =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
      .formatToParts(now)
      .find((p) => p.type === 'weekday')?.value ?? '';
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[short] ?? 1;
}

function formatLocalTime(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  }).format(now);
}

// ── Service ────────────────────────────────────────────────────────────────────

class AutoShiftService {
  private async resolveOwnerUserId(): Promise<string | null> {
    try {
      const owner = await prisma.user.findFirst({
        where:   { role: 'OWNER', isActive: true },
        select:  { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (owner) return owner.id;

      const admin = await prisma.user.findFirst({
        where:   { role: 'ADMIN', isActive: true },
        select:  { id: true },
        orderBy: { createdAt: 'asc' },
      });
      return admin?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Central idempotent auto-shift check.
   * Resolves active period → expected schedule → reconciles OPEN shifts → opens if needed.
   */
  async runAutoShiftCheck(now: Date = new Date()): Promise<AutoShiftCheckResult> {
    const checkedAt    = now.toISOString();
    const tz           = getTimezone();
    const businessDate = getBusinessDate(tz);
    const dow          = todayDayOfWeek(tz, now);
    const { start: todayStartUtc } = getDayBoundsUtc(businessDate, tz);
    const localTime    = formatLocalTime(now, tz);

    autoShiftLog(`currentLocalTime: ${localTime} (${tz})`);
    autoShiftLog(`BusinessDate: ${businessDate}`);
    autoShiftLog(`DayOfWeek: ${dow}`);

    const ownerId = await this.resolveOwnerUserId();
    autoShiftLog(`OwnerUserId: ${ownerId ?? 'none'}`);
    autoShiftLog(`RepairEnabled: ${env.AUTO_SHIFT_REPAIR_ENABLED}`);

    const [shiftTypeRows, scheduleRows, openRows] = await Promise.all([
      prisma.shiftType.findMany({
        where:   { isActive: true, archivedAt: null },
        select:  { id: true, name: true, startTime: true, endTime: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.staffSchedule.findMany({
        where: {
          dayOfWeek: dow,
          ...SCHEDULE_OPERATIONAL_WHERE,
          staffMember: { archivedAt: null, isActive: true },
        },
        include: {
          staffMember: { select: { id: true, name: true, isActive: true, archivedAt: true } },
          shiftType:   { select: { id: true, name: true, startTime: true, endTime: true, isActive: true, archivedAt: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      shiftService.listOpenShifts(),
    ]);

    const shiftTypes: ShiftTypeWindow[] = shiftTypeRows.map((st) => ({
      id:        st.id,
      name:      st.name,
      startTime: st.startTime,
      endTime:   st.endTime,
      sortOrder: st.sortOrder,
    }));

    const schedules: ScheduleSlot[] = scheduleRows
      .filter((s) => !s.isOff && s.shiftTypeId && s.shiftType?.isActive && !s.shiftType.archivedAt)
      .map((s) => ({
        id:              s.id,
        staffMemberId:   s.staffMemberId,
        staffMemberName: s.staffMember.name,
        shiftTypeId:     s.shiftTypeId,
        createdAt:       s.createdAt,
      }));

    const openShifts: OpenShiftSnapshot[] = openRows.map((s) => ({
      id:               s.id,
      staffMemberId:    s.staffMemberId,
      shiftTypeId:      s.shiftTypeId,
      businessDate:     s.businessDate,
      staffScheduleId:  s.staffScheduleId,
      scheduledStartAt: s.scheduledStartAt,
      scheduledEndAt:   s.scheduledEndAt,
      startedAt:        s.startedAt,
      status:           s.status,
    }));

    const activeShiftType = getActiveShiftTypeForTime(shiftTypes, now, businessDate, tz);
    autoShiftLog(
      `activeShiftType: ${activeShiftType
        ? `${activeShiftType.name} (${activeShiftType.startTime}–${activeShiftType.endTime})`
        : 'none'}`,
    );

    const { expected, reason: expectedReason, multipleSchedulesWarning } = resolveExpectedShift(
      activeShiftType,
      schedules,
      businessDate,
      tz,
    );

    if (multipleSchedulesWarning) {
      autoShiftLog(`warning: ${multipleSchedulesWarning}`);
      logger.warn(`[auto-shift] ${multipleSchedulesWarning}`);
    }

    autoShiftLog(
      `selectedSchedule: ${expected
        ? `${expected.staffScheduleId} staff=${expected.staffMemberName}`
        : 'none'}`,
    );
    autoShiftLog(
      `existingOpenShift: count=${openShifts.length} ` +
      `[${openShifts.map((s) => `${s.id}:${s.staffMemberId}:${s.shiftTypeId ?? '?'}`).join(', ')}]`,
    );

    const plan = reconcileOpenShifts({
      openShifts,
      expected,
      now,
      businessDate,
      todayStartUtc,
      tz,
      dailyCloseTime:    env.AUTO_SHIFT_SHOP_CLOSE_TIME,
      activeShiftTypeId: activeShiftType?.id ?? null,
      repairEnabled:     env.AUTO_SHIFT_REPAIR_ENABLED,
    });

    autoShiftLog(`decision: ${plan.reason}`);
    for (const action of plan.toClose) {
      autoShiftLog(`close: shift=${action.id} reason=${action.reason}`);
    }

    const closedIds: string[] = [];

    for (const action of plan.toClose) {
      const result = await shiftService.autoCloseShift(action.id, {
        reason:          action.reason,
        endedAt:         now,
        closedByUserId: ownerId,
      });
      if (result.closed) {
        closedIds.push(action.id);
        logger.info(`[auto-shift] Closed shift ${action.id} reason=${action.reason}`);
      }
    }

    let openedCount = 0;

    if (plan.shouldOpen && expected) {
      if (!ownerId) {
        autoShiftLog('decision: skip open — no active OWNER or ADMIN user');
        logger.error('[auto-shift] No active OWNER/ADMIN user found — cannot auto-open shift');
      } else {
        const existing = await prisma.shift.findFirst({
          where:  { staffScheduleId: expected.staffScheduleId, businessDate },
          select: { id: true, status: true, endedAt: true },
        });

        const effectiveStartedAt = resolveAutoShiftStartedAt(expected.scheduledStartAt, now);

        if (existing?.status === 'CLOSED') {
          const reopened = await shiftService.reopenScheduledShift(existing.id, {
            ownerId,
            scheduledStartAt: expected.scheduledStartAt,
            scheduledEndAt:   expected.scheduledEndAt,
            businessDate,
          });
          if (reopened) {
            openedCount = 1;
            autoShiftLog(`opened: re-opened shift ${existing.id} for ${expected.staffMemberName}`);
          }
        } else if (!existing || existing.status !== 'OPEN') {
          await prisma.shift.create({
            data: {
              staffMemberId:       expected.staffMemberId,
              shiftTypeId:         expected.shiftTypeId,
              staffScheduleId:     expected.staffScheduleId,
              businessDate,
              startedAt:           effectiveStartedAt,
              scheduledStartAt:    expected.scheduledStartAt,
              scheduledEndAt:      expected.scheduledEndAt,
              status:              'OPEN',
              openedByUserId:      ownerId,
              openedAutomatically: true,
              notes:               'Auto-ouvert depuis le planning hebdomadaire',
            },
          });
          openedCount = 1;
          autoShiftLog(
            `opened: ${expected.shiftTypeName} for ${expected.staffMemberName} ` +
            `(${expected.startHHmm}–${expected.endHHmm})`,
          );
        }
      }
    }

    const active = await shiftService.getOpenShift();
    const reason = !expected && !active
      ? expectedReason
      : plan.reason;

    const result: AutoShiftCheckResult = {
      opened:              openedCount > 0,
      closed:              closedIds.length > 0,
      closedIds,
      repaired:            plan.repaired || (openedCount > 0 && closedIds.length > 0),
      openFound:           openRows.length > 0,
      activeShiftId:       active?.id ?? null,
      activeShiftTypeId:   active?.shiftType?.id ?? expected?.shiftTypeId ?? null,
      activeShiftTypeName: active?.shiftType?.name ?? expected?.shiftTypeName ?? null,
      activeStaffMemberId: active?.staffMember?.id ?? expected?.staffMemberId ?? null,
      activeStaffName:     active?.staffMember?.name ?? expected?.staffMemberName ?? null,
      reason,
      message:             reason,
      checkedAt,
      openedCount,
      closedCount:         closedIds.length,
    };

    logger.info(
      `[auto-shift] Check: ${reason} ` +
      `(opened=${openedCount} closed=${closedIds.length} active=${active?.id ?? 'none'})`,
    );

    return result;
  }

  /** @deprecated Use runAutoShiftCheck — kept for internal callers during migration. */
  async runAutoShiftSync(): Promise<{
    opened: number;
    closed: number;
    closedIds: string[];
    openFound: number;
  }> {
    const result = await this.runAutoShiftCheck();
    return {
      opened:    result.openedCount,
      closed:    result.closedCount,
      closedIds: result.closedIds,
      openFound: result.openFound ? 1 : 0,
    };
  }
}

export const autoShiftService = new AutoShiftService();

/** Central entry point for jobs, HTTP triggers, and startup. */
export function runAutoShiftCheck(now?: Date): Promise<AutoShiftCheckResult> {
  return autoShiftService.runAutoShiftCheck(now ?? new Date());
}
