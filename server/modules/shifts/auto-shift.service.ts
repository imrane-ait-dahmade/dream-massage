import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { shiftService } from './shift.service';

// ── Timezone helpers ───────────────────────────────────────────────────────────

function getBusinessDate(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).formatToParts(new Date());
  const y  = parts.find((p) => p.type === 'year')?.value  ?? '2000';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d  = parts.find((p) => p.type === 'day')?.value   ?? '01';
  return `${y}-${mo}-${d}`;
}

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

// Converts a local HH:mm time on a given YYYY-MM-DD to a UTC Date.
// DST-safe: probes the actual UTC offset for the specific date.
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
   * Opens shifts that are due now according to the weekly schedule.
   * Only creates a shift if:
   *   1. now >= scheduledStartAt AND now < scheduledEndAt
   *   2. No existing Shift for (staffScheduleId, businessDate)
   *   3. ALLOW_MULTIPLE_OPEN_SHIFTS=false → no other OPEN shift exists
   */
  async openDueShifts(now: Date): Promise<number> {
    const tz           = env.APP_TIMEZONE;
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

      // Only open if we are within the scheduled window
      if (now < scheduledStartAt || now >= scheduledEndAt) continue;

      // Guard: duplicate check for same schedule + business date
      const duplicate = await prisma.shift.findFirst({
        where:  { staffScheduleId: schedule.id, businessDate },
        select: { id: true },
      });
      if (duplicate) continue;

      // Guard: only one OPEN shift allowed
      if (!env.ALLOW_MULTIPLE_OPEN_SHIFTS) {
        const openShift = await prisma.shift.findFirst({
          where:  { status: 'OPEN' },
          select: { id: true, staffMember: { select: { name: true } } },
        });
        if (openShift) {
          logger.warn(
            `[auto-shift] Cannot auto-open for ${schedule.staffMember.name} ` +
            `(${businessDate}): another shift is already OPEN ` +
            `(${openShift.staffMember.name}). ` +
            `Set ALLOW_MULTIPLE_OPEN_SHIFTS=true to allow parallel shifts.`,
          );
          continue;
        }
      }

      const ownerId = await this.resolveOwnerUserId();
      if (!ownerId) {
        logger.error('[auto-shift] No active OWNER user found — cannot auto-open shift');
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
   * Closes OPEN shifts whose scheduledEndAt has passed.
   * Recalculates prime summary before closing.
   * declaredCash is intentionally left null — requires Owner review.
   */
  async closeExpiredShifts(now: Date): Promise<number> {
    const expired = await prisma.shift.findMany({
      where: { status: 'OPEN', scheduledEndAt: { lte: now } },
      select: { id: true, scheduledEndAt: true },
    });

    let closed = 0;

    for (const shift of expired) {
      // Recalculate and persist prime snapshot before closing
      try {
        await shiftService.recalculateAndSaveShiftPrimeSummary(shift.id);
      } catch (err) {
        logger.warn(
          `[auto-shift] Prime recalc failed for shift ${shift.id}: ${String(err)} — closing anyway`,
        );
      }

      const ownerId = await this.resolveOwnerUserId();

      await prisma.shift.update({
        where: { id: shift.id },
        data: {
          status:              'CLOSED',
          endedAt:             shift.scheduledEndAt ?? now,
          closedByUserId:      ownerId,
          closedAutomatically: true,
          autoCloseReason:     'SCHEDULE_END',
          // declaredCash intentionally null — Owner must review and enter cash later
        },
      });

      logger.info(`[auto-shift] Auto-closed shift ${shift.id} (SCHEDULE_END)`);
      closed++;
    }

    return closed;
  }

  /**
   * Full sync: close expired shifts first, then open due shifts.
   * Closing first ensures a just-expired shift does not block a new one from opening.
   */
  async runAutoShiftSync(): Promise<{ opened: number; closed: number }> {
    const now    = new Date();
    const closed = await this.closeExpiredShifts(now);
    const opened = await this.openDueShifts(now);
    if (opened > 0 || closed > 0) {
      logger.info(`[auto-shift] Sync: opened=${opened} closed=${closed}`);
    }
    return { opened, closed };
  }
}

export const autoShiftService = new AutoShiftService();
