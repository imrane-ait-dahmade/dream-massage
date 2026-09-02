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
import {
  evaluateShiftClose,
  shouldCloseBeforeHandoff,
  type ShiftCloseCandidate,
  type ShiftCloseContext,
} from './shift-close.logic';
import type { AutoShiftCheckResult } from './auto-shift.types';
import { SCHEDULE_OPERATIONAL_WHERE } from '../archive/archive-filters';
import {
  evaluatePeriodOpen,
  findActiveShiftTypeAtTime,
  resolveAutoShiftStartedAt,
  type ScheduleSlot,
  type ShiftTypeWindow,
} from './auto-shift-period.logic';

function autoShiftLog(message: string): void {
  logger.info(`AUTO_SHIFT: ${message}`);
}

// ── Timezone helpers (schedule windows) ────────────────────────────────────────

function todayDayOfWeek(tz: string): number {
  const short =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'weekday')?.value ?? '';
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[short] ?? 1;
}

function toCloseCandidate(row: {
  id: string;
  status: string;
  businessDate: string | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  startedAt: Date;
  staffMemberId: string;
  shiftTypeId?: string | null;
}): ShiftCloseCandidate {
  return {
    id:               row.id,
    status:           row.status,
    businessDate:     row.businessDate,
    scheduledStartAt: row.scheduledStartAt,
    scheduledEndAt:   row.scheduledEndAt,
    startedAt:        row.startedAt,
    staffMemberId:    row.staffMemberId,
    shiftTypeId:      row.shiftTypeId ?? null,
  };
}

function buildCloseContext(
  tz: string,
  businessDate: string,
  activeShiftTypeId?: string | null,
): ShiftCloseContext {
  const { start: todayStartUtc } = getDayBoundsUtc(businessDate, tz);
  return {
    todayBusinessDate: businessDate,
    todayStartUtc,
    timezone:          tz,
    dailyCloseTime:    env.AUTO_SHIFT_SHOP_CLOSE_TIME,
    activeShiftTypeId,
  };
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
   * Closes every OPEN shift that is eligible — no businessDate=today filter.
   * Idempotent: already CLOSED rows are never selected.
   */
  async closeEligibleOpenShifts(
    now: Date,
    opts?: { reasonOverride?: string; ownerId?: string | null; activeShiftTypeId?: string | null },
  ): Promise<{ closed: number; closedIds: string[]; openFound: number }> {
    const tz                = getTimezone();
    const todayBusinessDate = getBusinessDate(tz);
    const closeCtx          = buildCloseContext(tz, todayBusinessDate, opts?.activeShiftTypeId);
    const ownerId           = opts?.ownerId ?? await this.resolveOwnerUserId();

    const openShifts = await shiftService.listOpenShifts();
    const openFound  = openShifts.length;

    if (openFound === 0) {
      logger.info('[auto-shift] Close scan: openFound=0 closed=0');
      return { closed: 0, closedIds: [], openFound: 0 };
    }

    logger.info(
      `[auto-shift] Close scan: openFound=${openFound} ids=[${openShifts.map((s) => s.id).join(', ')}]`,
    );

    const closedIds: string[] = [];

    for (const row of openShifts) {
      const decision = evaluateShiftClose(
        toCloseCandidate(row),
        now,
        closeCtx.todayBusinessDate,
        closeCtx.todayStartUtc,
        undefined,
        closeCtx.dailyCloseTime,
        closeCtx.timezone,
        closeCtx.activeShiftTypeId,
      );
      if (!decision.close) {
        logger.info(
          `[auto-shift] Keeping shift ${row.id} (${row.staffMember.name}) open ` +
          `(businessDate=${row.businessDate ?? 'null'})`,
        );
        continue;
      }

      const reason = opts?.reasonOverride ?? decision.reason ?? 'AUTO_CLOSE';
      const result = await shiftService.autoCloseShift(row.id, {
        reason,
        endedAt:        decision.endedAt ?? now,
        closedByUserId: ownerId,
      });

      if (result.closed) {
        closedIds.push(row.id);
        logger.info(
          `[auto-shift] Closed shift ${row.id} (${row.staffMember.name}) reason=${reason}`,
        );
      }
    }

    logger.info(
      `[auto-shift] Close scan done: openFound=${openFound} closed=${closedIds.length} ` +
      `closedIds=[${closedIds.join(', ')}]`,
    );

    return { closed: closedIds.length, closedIds, openFound };
  }

  /**
   * Before opening a due shift, close any OPEN rows that would block creation.
   * Shop-wide when ALLOW_MULTIPLE_OPEN_SHIFTS=false; per-staff otherwise.
   */
  private async closeBlockingOpenShiftsBeforeOpen(
    now: Date,
    staffMemberId: string,
    ownerId: string | null,
    closeCtx: ShiftCloseContext,
  ): Promise<number> {
    const openShifts = await shiftService.listOpenShifts();
    if (openShifts.length === 0) return 0;

    const toClose = env.ALLOW_MULTIPLE_OPEN_SHIFTS
      ? openShifts.filter(
          (s) =>
            s.staffMemberId === staffMemberId &&
            shouldCloseBeforeHandoff(toCloseCandidate(s), now, closeCtx),
        )
      : openShifts.filter((s) =>
          shouldCloseBeforeHandoff(toCloseCandidate(s), now, closeCtx),
        );

    let closed = 0;
    for (const row of toClose) {
      const result = await shiftService.autoCloseShift(row.id, {
        reason:          'BEFORE_NEW_OPEN',
        endedAt:         now,
        closedByUserId: ownerId,
      });
      if (result.closed) {
        closed++;
        logger.info(
          `[auto-shift] Pre-open cleanup: closed ${row.id} (${row.staffMember.name})`,
        );
      }
    }
    return closed;
  }

  /**
   * Opens the shift for the current period (Matin or Soir) based on local time.
   * Only one schedule row is selected: today's active ShiftType window + StaffSchedule.
   */
  async openDueShifts(
    now: Date,
    ownerId: string | null,
    activeShiftTypeId?: string | null,
  ): Promise<{ opened: number; skipReason?: string }> {
    if (env.SELF_START_SHIFT_ENABLED) {
      autoShiftLog('decision: skip — SELF_START_SHIFT_ENABLED (auto-open from planning disabled)');
      return { opened: 0, skipReason: 'self-start mode: auto-open disabled' };
    }

    const tz           = getTimezone();
    const businessDate = getBusinessDate(tz);
    const dow          = todayDayOfWeek(tz);
    const shopOpenAt   = buildScheduledDatetime(businessDate, env.AUTO_SHIFT_SHOP_OPEN_TIME, tz);
    const closeCtx     = buildCloseContext(tz, businessDate, activeShiftTypeId);
    const localTime    = formatLocalTime(now, tz);

    autoShiftLog(`currentLocalTime: ${localTime} (${tz})`);
    autoShiftLog(`BusinessDate: ${businessDate}`);
    autoShiftLog(`DayOfWeek: ${dow}`);

    const beforeShopOpen = now < shopOpenAt;

    const [shiftTypes, schedules, openShifts] = await Promise.all([
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
          staffMember: { select: { id: true, name: true } },
          shiftType:   { select: { id: true, name: true, startTime: true, endTime: true } },
        },
      }),
      shiftService.listOpenShifts(),
    ]);

    const typeWindows: ShiftTypeWindow[] = shiftTypes.map((st) => ({
      id:        st.id,
      name:      st.name,
      startTime: st.startTime,
      endTime:   st.endTime,
      sortOrder: st.sortOrder,
    }));

    const scheduleSlots: ScheduleSlot[] = schedules.map((s) => ({
      id:              s.id,
      staffMemberId:   s.staffMemberId,
      staffMemberName: s.staffMember.name,
      shiftTypeId:     s.shiftTypeId,
    }));

    const periodDecision = evaluatePeriodOpen(
      typeWindows,
      scheduleSlots,
      now,
      businessDate,
      tz,
      { beforeShopOpen },
    );

    const activeType =
      periodDecision.activeShiftType
      ?? findActiveShiftTypeAtTime(typeWindows, now, businessDate, tz);

    autoShiftLog(
      `activeShiftType: ${activeType ? `${activeType.name} (${activeType.startTime}–${activeType.endTime})` : 'none'}`,
    );
    autoShiftLog(
      `selectedSchedule: ${periodDecision.selectedSchedule
        ? `${periodDecision.selectedSchedule.id} staff=${periodDecision.selectedSchedule.staffMemberName}`
        : 'none'}`,
    );
    autoShiftLog(
      `existingOpenShift: count=${openShifts.length} ` +
      `[${openShifts.map((s) => `${s.id}:${s.staffMember.name}:${s.shiftTypeId ?? '?'}`).join(', ')}]`,
    );
    autoShiftLog(`OwnerUserId: ${ownerId ?? 'none'}`);

    if (!periodDecision.shouldOpen || !periodDecision.selectedSchedule || !activeType) {
      autoShiftLog(`decision: skip — ${periodDecision.reason}`);
      if (!beforeShopOpen) {
        logger.info(`[auto-shift] Open scan skipped: ${periodDecision.reason}`);
      }
      return { opened: 0, skipReason: periodDecision.reason };
    }

    const schedule = schedules.find((s) => s.id === periodDecision.selectedSchedule!.id);
    if (!schedule) {
      autoShiftLog('decision: skip — selected schedule row not found');
      return { opened: 0, skipReason: 'selected schedule not found' };
    }

    const startHHmm = schedule.shiftType?.startTime ?? activeType.startTime;
    const endHHmm   = schedule.shiftType?.endTime ?? activeType.endTime;

    autoShiftLog(`selectedStaff: ${schedule.staffMember.name}`);

    const scheduledStartAt = buildScheduledDatetime(businessDate, startHHmm, tz);
    const scheduledEndAt   = buildScheduledDatetime(businessDate, endHHmm, tz);

    const existing = await prisma.shift.findFirst({
      where:  { staffScheduleId: schedule.id, businessDate },
      select: { id: true, status: true, endedAt: true },
    });

    if (existing?.status === 'OPEN' && existing.endedAt === null) {
      autoShiftLog('decision: keep — shift already OPEN for current period schedule');
      return { opened: 0 };
    }

    await this.closeBlockingOpenShiftsBeforeOpen(
      now,
      schedule.staffMemberId,
      ownerId,
      closeCtx,
    );

    if (!ownerId) {
      autoShiftLog('decision: skip — no active OWNER or ADMIN user for openedByUserId');
      logger.error('[auto-shift] No active OWNER/ADMIN user found — cannot auto-open shift');
      return { opened: 0, skipReason: 'no owner/admin user' };
    }

    const effectiveStartedAt = resolveAutoShiftStartedAt(scheduledStartAt, now);

    if (existing?.status === 'CLOSED') {
      const reopened = await shiftService.reopenScheduledShift(existing.id, {
        ownerId,
        scheduledStartAt,
        scheduledEndAt,
        businessDate,
      });
      if (reopened) {
        autoShiftLog(`decision: re-opened CLOSED shift ${existing.id} for ${schedule.staffMember.name}`);
        logger.info(
          `[auto-shift] Re-opened shift ${existing.id} for ${schedule.staffMember.name} ` +
          `(${startHHmm}–${endHHmm}, ${businessDate})`,
        );
        return { opened: 1 };
      }
      autoShiftLog(`decision: skip — reopenScheduledShift failed for ${existing.id}`);
      return { opened: 0, skipReason: 'reopen failed' };
    }

    await prisma.shift.create({
      data: {
        staffMemberId:       schedule.staffMemberId,
        shiftTypeId:         schedule.shiftTypeId ?? activeType.id,
        staffScheduleId:     schedule.id,
        businessDate,
        startedAt:           effectiveStartedAt,
        scheduledStartAt,
        scheduledEndAt,
        status:              'OPEN',
        openedByUserId:      ownerId,
        openedAutomatically: true,
        notes:               'Auto-ouvert depuis le planning hebdomadaire',
        cashAccountId:       schedule.cashAccountId ?? null,
      },
    });

    autoShiftLog(
      `decision: opened ${activeType.name} for ${schedule.staffMember.name} ` +
      `(${startHHmm}–${endHHmm})`,
    );
    logger.info(
      `[auto-shift] Opened shift for ${schedule.staffMember.name} ` +
      `(${startHHmm}–${endHHmm}, ${businessDate})`,
    );
    return { opened: 1 };
  }

  /**
   * Central idempotent auto-shift check. Safe every 15 minutes or on demand.
   */
  async runAutoShiftCheck(now: Date = new Date()): Promise<AutoShiftCheckResult> {
    const checkedAt    = now.toISOString();
    const tz           = getTimezone();
    const businessDate = getBusinessDate(tz);

    autoShiftLog(`CurrentTime: ${checkedAt}`);
    autoShiftLog(`Timezone: ${tz}`);
    autoShiftLog(`BusinessDate: ${businessDate}`);

    const ownerId = await this.resolveOwnerUserId();
    autoShiftLog(`OwnerUserId: ${ownerId ?? 'none'}`);

    const shiftTypes = await prisma.shiftType.findMany({
      where:   { isActive: true, archivedAt: null },
      select:  { id: true, name: true, startTime: true, endTime: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    const activeShiftType = findActiveShiftTypeAtTime(
      shiftTypes.map((st) => ({
        id:        st.id,
        name:      st.name,
        startTime: st.startTime,
        endTime:   st.endTime,
        sortOrder: st.sortOrder,
      })),
      now,
      businessDate,
      tz,
    );
    autoShiftLog(
      `activeShiftType: ${activeShiftType ? `${activeShiftType.name} (${activeShiftType.startTime}–${activeShiftType.endTime})` : 'none'}`,
    );

    const closeResult = await this.closeEligibleOpenShifts(now, {
      ownerId,
      activeShiftTypeId: activeShiftType?.id ?? null,
    });
    autoShiftLog(
      `CloseScan: openFound=${closeResult.openFound} closed=${closeResult.closed} ` +
      `closedIds=[${closeResult.closedIds.join(', ')}]`,
    );

    const openResult = await this.openDueShifts(now, ownerId, activeShiftType?.id ?? null);
    const openedCount = openResult.opened;

    const active = await shiftService.getOpenShift();
    const parts: string[] = [];
    if (openedCount > 0) parts.push(`opened=${openedCount}`);
    if (closeResult.closed > 0) parts.push(`closed=${closeResult.closed}`);
    if (openResult.skipReason) parts.push(`skip=${openResult.skipReason}`);
    if (closeResult.openFound > 0 && closeResult.closed === 0 && openedCount === 0) {
      parts.push(`openFound=${closeResult.openFound}`);
    }
    const message = parts.length > 0 ? parts.join(', ') : 'no changes';

    autoShiftLog(
      `decision: opened=${openedCount > 0} openedCount=${openedCount} ` +
      `activeShiftId=${active?.id ?? 'none'} message=${message}`,
    );

    if (openedCount > 0 || closeResult.closed > 0) {
      logger.info(`[auto-shift] Check: ${message}`);
    } else {
      logger.info(
        `[auto-shift] Check: no changes (openFound=${closeResult.openFound}, ` +
        `active=${active?.id ?? 'none'})`,
      );
    }

    return {
      opened:        openedCount > 0,
      closed:        closeResult.closed > 0,
      closedIds:     closeResult.closedIds,
      openFound:     closeResult.openFound > 0,
      activeShiftId: active?.id ?? null,
      message,
      checkedAt,
      openedCount,
      closedCount:   closeResult.closed,
    };
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
