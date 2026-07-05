import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { getBusinessDate, getDayBoundsUtc, getTimezone } from '../../utils/time';
import { shiftService } from './shift.service';
import {
  evaluateShiftClose,
  shouldCloseBeforeHandoff,
  type ShiftCloseCandidate,
} from './shift-close.logic';

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

function buildScheduledDatetime(businessDate: string, hhmm: string, tz: string): Date {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr ?? '0', 10);
  const m = parseInt(mStr ?? '0', 10);
  const probeUTC    = new Date(`${businessDate}T00:00:00Z`);
  const local       = new Date(probeUTC.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs    = local.getTime() - probeUTC.getTime();
  const midnightUTC = new Date(probeUTC.getTime() - offsetMs);
  return new Date(midnightUTC.getTime() + (h * 60 + m) * 60_000);
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

export type AutoShiftSyncResult = {
  opened: number;
  closed: number;
  closedIds: string[];
  openFound: number;
};

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
    const tz                 = getTimezone();
    const todayBusinessDate  = getBusinessDate(tz);
    const { start: todayStartUtc } = getDayBoundsUtc(todayBusinessDate, tz);
    const ownerId            = opts?.ownerId ?? await this.resolveOwnerUserId();

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
        todayBusinessDate,
        todayStartUtc,
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
    todayBusinessDate: string,
    todayStartUtc: Date,
  ): Promise<number> {
    const openShifts = await shiftService.listOpenShifts();
    if (openShifts.length === 0) return 0;

    const toClose = env.ALLOW_MULTIPLE_OPEN_SHIFTS
      ? openShifts.filter(
          (s) =>
            s.staffMemberId === staffMemberId &&
            shouldCloseBeforeHandoff(toCloseCandidate(s), now, todayBusinessDate, todayStartUtc),
        )
      : openShifts.filter((s) =>
          shouldCloseBeforeHandoff(toCloseCandidate(s), now, todayBusinessDate, todayStartUtc),
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
   */
  async openDueShifts(now: Date, ownerId: string | null): Promise<number> {
    const tz           = getTimezone();
    const businessDate = getBusinessDate(tz);
    const dow          = todayDayOfWeek(tz);

    const schedules = await prisma.staffSchedule.findMany({
      where: { dayOfWeek: dow, isActive: true, isOff: false },
      include: {
        staffMember: { select: { id: true, name: true } },
        shiftType:   { select: { id: true, startTime: true, endTime: true } },
      },
    });

    let opened = 0;

    for (const schedule of schedules) {
      const startHHmm = schedule.startTime ?? schedule.shiftType?.startTime;
      const endHHmm   = schedule.endTime   ?? schedule.shiftType?.endTime;

      if (!startHHmm || !endHHmm) {
        logger.warn(
          `[auto-shift] Schedule ${schedule.id} (${schedule.staffMember.name}) ` +
          `has no start/end time — skipping`,
        );
        continue;
      }

      const scheduledStartAt = buildScheduledDatetime(businessDate, startHHmm, tz);
      const scheduledEndAt   = buildScheduledDatetime(businessDate, endHHmm, tz);

      if (now < scheduledStartAt || now >= scheduledEndAt) continue;

      const existing = await prisma.shift.findFirst({
        where:  { staffScheduleId: schedule.id, businessDate },
        select: { id: true, status: true, endedAt: true },
      });

      if (existing?.status === 'OPEN' && existing.endedAt === null) {
        continue;
      }

      const { start: todayStartUtc } = getDayBoundsUtc(businessDate, tz);
      await this.closeBlockingOpenShiftsBeforeOpen(
        now,
        schedule.staffMemberId,
        ownerId,
        businessDate,
        todayStartUtc,
      );

      if (!ownerId) {
        logger.error('[auto-shift] No active OWNER user found — cannot auto-open shift');
        continue;
      }

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
          startedAt:           scheduledStartAt,
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
   * Full sync: close all eligible OPEN shifts (any date), then open due shifts.
   * Idempotent — safe to run on every cron tick or after server restart.
   */
  async runAutoShiftSync(): Promise<AutoShiftSyncResult> {
    const now     = new Date();
    const ownerId = await this.resolveOwnerUserId();

    const closeResult = await this.closeEligibleOpenShifts(now, { ownerId });
    const opened      = await this.openDueShifts(now, ownerId);

    if (opened > 0 || closeResult.closed > 0) {
      logger.info(
        `[auto-shift] Sync: openFound=${closeResult.openFound} ` +
        `closed=${closeResult.closed} opened=${opened}`,
      );
    }

    return {
      opened,
      closed:    closeResult.closed,
      closedIds: closeResult.closedIds,
      openFound: closeResult.openFound,
    };
  }
}

export const autoShiftService = new AutoShiftService();
