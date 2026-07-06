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
  scheduledEndAt: Date | null;
  startedAt: Date;
  staffMemberId: string;
}): ShiftCloseCandidate {
  return {
    id:             row.id,
    status:         row.status,
    businessDate:   row.businessDate,
    scheduledEndAt: row.scheduledEndAt,
    startedAt:      row.startedAt,
    staffMemberId:  row.staffMemberId,
  };
}

function buildCloseContext(tz: string, businessDate: string): ShiftCloseContext {
  const { start: todayStartUtc } = getDayBoundsUtc(businessDate, tz);
  return {
    todayBusinessDate: businessDate,
    todayStartUtc,
    timezone:          tz,
    dailyCloseTime:    env.AUTO_SHIFT_SHOP_CLOSE_TIME,
  };
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
      return owner?.id ?? null;
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
    opts?: { reasonOverride?: string; ownerId?: string | null },
  ): Promise<{ closed: number; closedIds: string[]; openFound: number }> {
    const tz                = getTimezone();
    const todayBusinessDate = getBusinessDate(tz);
    const closeCtx          = buildCloseContext(tz, todayBusinessDate);
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
   * Opens shifts that are due now according to the weekly schedule.
   * Shop opens at AUTO_SHIFT_SHOP_OPEN_TIME (default 08:00) even if the
   * scheduled shift type starts later (e.g. Matin 10:00).
   */
  async openDueShifts(now: Date, ownerId: string | null): Promise<number> {
    const tz           = getTimezone();
    const businessDate = getBusinessDate(tz);
    const dow          = todayDayOfWeek(tz);
    const shopOpenAt   = buildScheduledDatetime(businessDate, env.AUTO_SHIFT_SHOP_OPEN_TIME, tz);
    const closeCtx     = buildCloseContext(tz, businessDate);

    if (now < shopOpenAt) {
      logger.info(
        `[auto-shift] Before shop open (${env.AUTO_SHIFT_SHOP_OPEN_TIME}) — skipping open scan`,
      );
      return 0;
    }

    const schedules = await prisma.staffSchedule.findMany({
      where: {
        dayOfWeek: dow,
        ...SCHEDULE_OPERATIONAL_WHERE,
        staffMember: { archivedAt: null, isActive: true },
      },
      include: {
        staffMember: { select: { id: true, name: true } },
        shiftType:   { select: { id: true, startTime: true, endTime: true } },
      },
    });

    let opened = 0;

    for (const schedule of schedules) {
      const startHHmm = schedule.shiftType?.startTime;
      const endHHmm   = schedule.shiftType?.endTime;

      if (!startHHmm || !endHHmm) {
        logger.warn(
          `[auto-shift] Schedule ${schedule.id} (${schedule.staffMember.name}) ` +
          `has no start/end time — skipping`,
        );
        continue;
      }

      const scheduledStartAt = buildScheduledDatetime(businessDate, startHHmm, tz);
      const scheduledEndAt   = buildScheduledDatetime(businessDate, endHHmm, tz);

      if (now >= scheduledEndAt) continue;

      const existing = await prisma.shift.findFirst({
        where:  { staffScheduleId: schedule.id, businessDate },
        select: { id: true, status: true, endedAt: true },
      });

      if (existing?.status === 'OPEN' && existing.endedAt === null) {
        continue;
      }

      await this.closeBlockingOpenShiftsBeforeOpen(
        now,
        schedule.staffMemberId,
        ownerId,
        closeCtx,
      );

      if (!ownerId) {
        logger.error('[auto-shift] No active OWNER user found — cannot auto-open shift');
        continue;
      }

      const effectiveStartedAt = scheduledStartAt > shopOpenAt ? shopOpenAt : scheduledStartAt;

      if (existing?.status === 'CLOSED') {
        const reopened = await shiftService.reopenScheduledShift(existing.id, {
          ownerId,
          scheduledStartAt,
          scheduledEndAt,
          businessDate,
        });
        if (reopened) {
          logger.info(
            `[auto-shift] Re-opened shift ${existing.id} for ${schedule.staffMember.name} ` +
            `(${startHHmm}–${endHHmm}, ${businessDate})`,
          );
          opened++;
        }
        continue;
      }

      await prisma.shift.create({
        data: {
          staffMemberId:       schedule.staffMemberId,
          shiftTypeId:         schedule.shiftTypeId ?? null,
          staffScheduleId:     schedule.id,
          businessDate,
          startedAt:           effectiveStartedAt,
          scheduledStartAt,
          scheduledEndAt,
          status:              'OPEN',
          openedByUserId:      ownerId,
          openedAutomatically: true,
          notes:               'Auto-ouvert depuis le planning hebdomadaire',
        },
      });

      logger.info(
        `[auto-shift] Opened shift for ${schedule.staffMember.name} ` +
        `(${startHHmm}–${endHHmm}, ${businessDate})`,
      );
      opened++;
    }

    return opened;
  }

  /**
   * Central idempotent auto-shift check. Safe every 15 minutes or on demand.
   */
  async runAutoShiftCheck(now: Date = new Date()): Promise<AutoShiftCheckResult> {
    const checkedAt = now.toISOString();
    const ownerId   = await this.resolveOwnerUserId();

    const closeResult = await this.closeEligibleOpenShifts(now, { ownerId });
    const openedCount = await this.openDueShifts(now, ownerId);

    const active = await shiftService.getOpenShift();
    const parts: string[] = [];
    if (openedCount > 0) parts.push(`opened=${openedCount}`);
    if (closeResult.closed > 0) parts.push(`closed=${closeResult.closed}`);
    if (closeResult.openFound > 0 && closeResult.closed === 0) {
      parts.push(`openFound=${closeResult.openFound}`);
    }
    const message = parts.length > 0 ? parts.join(', ') : 'no changes';

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
