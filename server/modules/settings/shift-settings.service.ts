import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import type { ScheduleCreateInput, ScheduleUpdateInput } from './shift-settings.types';

// ── Constants ──────────────────────────────────────────────────────────────────

const DAY_LABELS: Record<number, string> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeToMinutes(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return -1;
  return parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10);
}

function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const sa = timeToMinutes(startA);
  const ea = timeToMinutes(endA);
  const sb = timeToMinutes(startB);
  const eb = timeToMinutes(endB);
  if (sa < 0 || ea < 0 || sb < 0 || eb < 0) return false;
  return sa < eb && sb < ea;
}

// Returns ISO 8601 day-of-week (1=Monday … 7=Sunday) in the app timezone.
function todayDayOfWeek(tz: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const short = formatter.formatToParts(new Date()).find((p) => p.type === 'weekday')?.value ?? '';
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[short] ?? 1;
}

// ── Payload type ───────────────────────────────────────────────────────────────

type ScheduleRow = Prisma.StaffScheduleGetPayload<{
  include: {
    staffMember: { select: { id: true; name: true } };
    shiftType: {
      select: { id: true; name: true; label: true; startTime: true; endTime: true };
    };
  };
}>;

type ScheduleItem = {
  id: string;
  staffMemberId: string;
  staffMemberName: string;
  shiftTypeId: string | null;
  shiftTypeLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  isOff: boolean;
  isActive: boolean;
  notes: string | null;
};

function mapRow(s: ScheduleRow): ScheduleItem {
  return {
    id:              s.id,
    staffMemberId:   s.staffMemberId,
    staffMemberName: s.staffMember.name,
    shiftTypeId:     s.shiftTypeId ?? null,
    shiftTypeLabel:  s.shiftType?.label ?? s.shiftType?.name ?? null,
    // Prefer the per-row override, then fall back to the ShiftType default times.
    startTime:       s.startTime ?? s.shiftType?.startTime ?? null,
    endTime:         s.endTime   ?? s.shiftType?.endTime   ?? null,
    isOff:           s.isOff,
    isActive:        s.isActive,
    notes:           s.notes ?? null,
  };
}

const SCHEDULE_INCLUDE = {
  staffMember: { select: { id: true, name: true } },
  shiftType:   { select: { id: true, name: true, label: true, startTime: true, endTime: true } },
} as const;

// ── Service ────────────────────────────────────────────────────────────────────

class ShiftSettingsService {
  // Audit user: prefer the calling user; fall back to first OWNER for seeded operations.
  // TODO: remove the fallback once all callers pass an authenticated userId.
  private async resolveAuditUserId(userId?: string): Promise<string | null> {
    if (userId) return userId;
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

  private async audit(
    params: {
      entityType: string;
      entityId?: string;
      action: string;
      oldValue?: unknown;
      newValue?: unknown;
      reason?: string;
    },
    userId?: string,
  ): Promise<void> {
    try {
      const resolvedId = await this.resolveAuditUserId(userId);
      await prisma.settingsAuditLog.create({
        data: {
          userId:     resolvedId,
          entityType: params.entityType,
          entityId:   params.entityId,
          action:     params.action,
          oldValue:   params.oldValue != null ? (params.oldValue as Prisma.InputJsonValue) : undefined,
          newValue:   params.newValue != null ? (params.newValue as Prisma.InputJsonValue) : undefined,
          reason:     params.reason,
        },
      });
    } catch (err) {
      logger.warn('[shift-settings] Audit log write failed:', String(err));
    }
  }

  // ── A. Staff Schedule ──────────────────────────────────────────────────────────

  /**
   * Returns the weekly schedule grouped by day (all 7 days, empty items for
   * days with no active schedule). Pass staffMemberId to filter by one person.
   */
  async getSchedule(staffMemberId?: string): Promise<{
    days: Array<{ dayOfWeek: number; label: string; items: ScheduleItem[] }>;
  }> {
    const where: Prisma.StaffScheduleWhereInput = {
      isActive: true,
      ...(staffMemberId ? { staffMemberId } : {}),
    };

    const rows = await prisma.staffSchedule.findMany({
      where,
      include: SCHEDULE_INCLUDE,
      orderBy: [{ dayOfWeek: 'asc' }, { staffMember: { name: 'asc' } }],
    });

    const grouped: Record<number, ScheduleItem[]> = {};
    for (const row of rows) {
      const d = row.dayOfWeek;
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(mapRow(row));
    }

    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      dayOfWeek: d,
      label:     DAY_LABELS[d]!,
      items:     grouped[d] ?? [],
    }));

    return { days };
  }

  /**
   * Creates a schedule entry for one staff member on one day.
   * Any existing active schedule for the same (staffMemberId, dayOfWeek) is
   * deactivated first — only one active row per staff/day is allowed.
   * MVP: direct create; if structural change patterns are needed later,
   * use deactivate+create like CommissionRule.
   */
  async createScheduleEntry(
    input: ScheduleCreateInput,
    userId?: string,
  ): Promise<ScheduleItem> {
    // Validate staff member
    const staff = await prisma.staffMember.findUnique({
      where:  { id: input.staffMemberId },
      select: { id: true, name: true, isActive: true },
    });
    if (!staff) {
      throw Object.assign(
        new Error(`Membre du staff introuvable : ${input.staffMemberId}`),
        { status: 404 },
      );
    }

    // Validate shift type if provided
    let resolvedShiftType: { startTime: string; endTime: string } | null = null;
    if (input.shiftTypeId) {
      const st = await prisma.shiftType.findUnique({
        where:  { id: input.shiftTypeId },
        select: { id: true, startTime: true, endTime: true },
      });
      if (!st) {
        throw Object.assign(
          new Error(`Type de shift introuvable : ${input.shiftTypeId}`),
          { status: 404 },
        );
      }
      resolvedShiftType = st;
    }

    // Validate times and check for overlaps (only for working days)
    if (!input.isOff) {
      const effectiveStart = input.startTime ?? resolvedShiftType?.startTime;
      const effectiveEnd   = input.endTime   ?? resolvedShiftType?.endTime;

      if (effectiveStart && effectiveEnd) {
        const startMins = timeToMinutes(effectiveStart);
        const endMins   = timeToMinutes(effectiveEnd);
        if (startMins >= 0 && endMins >= 0 && endMins <= startMins) {
          throw Object.assign(
            new Error('L\'heure de fin doit être après l\'heure de début'),
            { status: 400 },
          );
        }

        // If only one OPEN shift is allowed at a time, no two staff schedules
        // on the same day can overlap — they would conflict at runtime.
        if (!env.ALLOW_MULTIPLE_OPEN_SHIFTS && effectiveStart && effectiveEnd) {
          const others = await prisma.staffSchedule.findMany({
            where: {
              dayOfWeek:     input.dayOfWeek,
              isActive:      true,
              isOff:         false,
              staffMemberId: { not: input.staffMemberId },
            },
            include: { shiftType: { select: { startTime: true, endTime: true } } },
          });

          for (const other of others) {
            const otherStart = other.startTime ?? other.shiftType?.startTime ?? '';
            const otherEnd   = other.endTime   ?? other.shiftType?.endTime   ?? '';
            if (timesOverlap(effectiveStart, effectiveEnd, otherStart, otherEnd)) {
              throw Object.assign(
                new Error('Un autre membre du staff a déjà un shift qui se chevauche ce jour-là.'),
                { status: 409 },
              );
            }
          }
        }
      }
    }

    // Deactivate any existing active schedule for the same staff/day
    const previousActive = await prisma.staffSchedule.findMany({
      where:  { staffMemberId: input.staffMemberId, dayOfWeek: input.dayOfWeek, isActive: true },
      select: { id: true },
    });
    if (previousActive.length > 0) {
      await prisma.staffSchedule.updateMany({
        where: { id: { in: previousActive.map((r) => r.id) } },
        data:  { isActive: false },
      });
      logger.info(
        `[shift-settings] Deactivated ${previousActive.length} schedule(s) for ` +
        `${staff.name} on day ${input.dayOfWeek} before creating new entry`,
      );
    }

    const created = await prisma.staffSchedule.create({
      data: {
        staffMemberId: input.staffMemberId,
        shiftTypeId:   input.shiftTypeId ?? null,
        dayOfWeek:     input.dayOfWeek,
        startTime:     input.startTime ?? null,
        endTime:       input.endTime   ?? null,
        isOff:         input.isOff,
        isActive:      true,
        notes:         input.notes ?? null,
      },
      include: SCHEDULE_INCLUDE,
    });

    await this.audit(
      {
        entityType: 'StaffSchedule',
        entityId:   created.id,
        action:     'CREATE',
        newValue: {
          staffName:   staff.name,
          dayOfWeek:   input.dayOfWeek,
          isOff:       input.isOff,
          shiftTypeId: input.shiftTypeId ?? null,
        },
      },
      userId,
    );

    return mapRow(created);
  }

  /**
   * Patch update for an existing schedule entry.
   *
   * Design choice (MVP): direct in-place update.
   * Rationale: no shift reports query historical StaffSchedule rows yet. If
   * future payroll/prime reports need schedule history, switch to the
   * deactivate-old / create-new pattern used in CommissionRule.
   */
  async updateScheduleEntry(
    id: string,
    input: ScheduleUpdateInput,
    userId?: string,
  ): Promise<ScheduleItem | null> {
    const existing = await prisma.staffSchedule.findUnique({
      where:   { id },
      include: SCHEDULE_INCLUDE,
    });
    if (!existing) return null;

    // Validate new shiftTypeId if being changed to a non-null value
    let updatedShiftType: { startTime: string; endTime: string } | null = null;
    if (input.shiftTypeId != null) {
      const st = await prisma.shiftType.findUnique({
        where:  { id: input.shiftTypeId },
        select: { id: true, startTime: true, endTime: true },
      });
      if (!st) {
        throw Object.assign(
          new Error(`Type de shift introuvable : ${input.shiftTypeId}`),
          { status: 404 },
        );
      }
      updatedShiftType = st;
    }

    // Resolve the merged state after the update to validate times and overlaps
    const mergedIsOff = 'isOff' in input ? (input.isOff ?? existing.isOff) : existing.isOff;
    if (!mergedIsOff) {
      const mergedShiftType = updatedShiftType ?? existing.shiftType;
      const mergedStartTime = 'startTime' in input ? input.startTime : existing.startTime;
      const mergedEndTime   = 'endTime'   in input ? input.endTime   : existing.endTime;
      const effectiveStart  = mergedStartTime ?? mergedShiftType?.startTime;
      const effectiveEnd    = mergedEndTime   ?? mergedShiftType?.endTime;

      if (effectiveStart && effectiveEnd) {
        const startMins = timeToMinutes(effectiveStart);
        const endMins   = timeToMinutes(effectiveEnd);
        if (startMins >= 0 && endMins >= 0 && endMins <= startMins) {
          throw Object.assign(
            new Error('L\'heure de fin doit être après l\'heure de début'),
            { status: 400 },
          );
        }

        if (!env.ALLOW_MULTIPLE_OPEN_SHIFTS) {
          const others = await prisma.staffSchedule.findMany({
            where: {
              id:        { not: id },
              dayOfWeek: existing.dayOfWeek,
              isActive:  true,
              isOff:     false,
              staffMemberId: { not: existing.staffMemberId },
            },
            include: { shiftType: { select: { startTime: true, endTime: true } } },
          });

          for (const other of others) {
            const otherStart = other.startTime ?? other.shiftType?.startTime ?? '';
            const otherEnd   = other.endTime   ?? other.shiftType?.endTime   ?? '';
            if (timesOverlap(effectiveStart, effectiveEnd, otherStart, otherEnd)) {
              throw Object.assign(
                new Error('Un autre membre du staff a déjà un shift qui se chevauche ce jour-là.'),
                { status: 409 },
              );
            }
          }
        }
      }
    }

    const oldValue = {
      isOff:       existing.isOff,
      shiftTypeId: existing.shiftTypeId,
      startTime:   existing.startTime,
      endTime:     existing.endTime,
      isActive:    existing.isActive,
      notes:       existing.notes,
    };

    // Build partial update data — only include keys explicitly provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    if ('shiftTypeId' in input) data.shiftTypeId = input.shiftTypeId;
    if ('startTime'   in input) data.startTime   = input.startTime;
    if ('endTime'     in input) data.endTime     = input.endTime;
    if ('isOff'       in input) data.isOff       = input.isOff;
    if ('isActive'    in input) data.isActive    = input.isActive;
    if ('notes'       in input) data.notes       = input.notes;

    const updated = await prisma.staffSchedule.update({
      where:   { id },
      data,
      include: SCHEDULE_INCLUDE,
    });

    await this.audit(
      {
        entityType: 'StaffSchedule',
        entityId:   id,
        action:     'UPDATE',
        oldValue,
        newValue: {
          isOff:       updated.isOff,
          shiftTypeId: updated.shiftTypeId,
          startTime:   updated.startTime,
          endTime:     updated.endTime,
          isActive:    updated.isActive,
        },
      },
      userId,
    );

    return mapRow(updated);
  }

  /**
   * Soft-deletes a schedule entry (sets isActive=false).
   * The row is kept for the audit trail.
   */
  async deleteScheduleEntry(id: string, userId?: string): Promise<boolean> {
    const existing = await prisma.staffSchedule.findUnique({
      where:  { id },
      select: { id: true, staffMemberId: true, dayOfWeek: true, isActive: true },
    });
    if (!existing) return false;

    await prisma.staffSchedule.update({
      where: { id },
      data:  { isActive: false },
    });

    await this.audit(
      {
        entityType: 'StaffSchedule',
        entityId:   id,
        action:     'DELETE',
        oldValue:   { staffMemberId: existing.staffMemberId, dayOfWeek: existing.dayOfWeek },
        reason:     'Soft delete via DELETE endpoint',
      },
      userId,
    );

    return true;
  }

  // ── B. Today suggestions ────────────────────────────────────────────────────

  /**
   * Returns the active non-off schedule entries for today's weekday.
   * Day-of-week is resolved from APP_TIMEZONE (env.APP_TIMEZONE).
   * The frontend can use this to show a one-click "Open shift from schedule" UI.
   */
  async getTodaySuggestions(): Promise<{
    dayOfWeek: number;
    label: string;
    suggestions: Array<{
      staffMemberId: string;
      staffMemberName: string;
      shiftTypeId: string | null;
      shiftTypeLabel: string | null;
      startTime: string | null;
      endTime: string | null;
    }>;
  }> {
    const tz  = env.APP_TIMEZONE;
    const dow = todayDayOfWeek(tz);

    const rows = await prisma.staffSchedule.findMany({
      where: { dayOfWeek: dow, isActive: true, isOff: false },
      include: SCHEDULE_INCLUDE,
      orderBy: { staffMember: { name: 'asc' } },
    });

    return {
      dayOfWeek: dow,
      label:     DAY_LABELS[dow] ?? `Jour ${dow}`,
      suggestions: rows.map((s) => ({
        staffMemberId:   s.staffMemberId,
        staffMemberName: s.staffMember.name,
        shiftTypeId:     s.shiftTypeId ?? null,
        shiftTypeLabel:  s.shiftType?.label ?? s.shiftType?.name ?? null,
        startTime:       s.startTime ?? s.shiftType?.startTime ?? null,
        endTime:         s.endTime   ?? s.shiftType?.endTime   ?? null,
      })),
    };
  }
}

export const shiftSettingsService = new ShiftSettingsService();
