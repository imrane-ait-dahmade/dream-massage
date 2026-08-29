import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import type { ScheduleCreateInput, ScheduleUpdateInput } from './shift-settings.types';
import {
  duplicateScheduleMessage,
  FORBIDDEN_SHIFT_TYPE_MESSAGE,
  isAllowedShiftTypeName,
  isForbiddenShiftTypeName,
  resolveShiftPeriod,
  type ShiftPeriod,
} from '../shifts/shift-period';
import { compareScheduleItems, sortScheduleItems } from './shift-schedule.sort';
import { archiveService } from '../archive/archive.service';
import {
  mapArchiveFields,
  scheduleListWhere,
  SCHEDULE_OPERATIONAL_WHERE,
  STAFF_VISIBLE_WHERE,
  type VisibilityFilter,
} from '../archive/archive-filters';
import type { ArchiveReasonInput } from '../archive/archive.types';

export { compareScheduleItems, sortScheduleItems } from './shift-schedule.sort';

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

import {
  parseTimeToMinutes,
  rangesOverlap,
} from './shift-time-ranges';

// Returns ISO 8601 day-of-week (1=Monday … 7=Sunday) in the app timezone.
function todayDayOfWeek(tz: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const short = formatter.formatToParts(new Date()).find((p) => p.type === 'weekday')?.value ?? '';
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[short] ?? 1;
}

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

export type TodayShiftStatus = 'upcoming' | 'active' | 'completed' | 'rest';

function resolveTodayShiftStatus(
  row: ScheduleRow,
  now: Date,
  businessDate: string,
  tz: string,
  shiftByScheduleId: Map<string, { id: string; status: string }>,
): TodayShiftStatus {
  if (row.isOff) return 'rest';

  const startHHmm = row.shiftType?.startTime;
  const endHHmm   = row.shiftType?.endTime;
  if (!startHHmm || !endHHmm) return 'upcoming';

  const scheduledStartAt = buildScheduledDatetime(businessDate, startHHmm, tz);
  const scheduledEndAt   = buildScheduledDatetime(businessDate, endHHmm, tz);

  if (now < scheduledStartAt) return 'upcoming';
  if (now >= scheduledEndAt) return 'completed';

  const shift = shiftByScheduleId.get(row.id);
  if (shift?.status === 'OPEN') return 'active';
  if (shift) return 'completed';

  return 'upcoming';
}

// ── Payload type ───────────────────────────────────────────────────────────────

type ScheduleRow = Prisma.StaffScheduleGetPayload<{
  include: {
    staffMember: { select: { id: true; name: true } };
    shiftType: {
      select: { id: true; name: true; label: true; startTime: true; endTime: true };
    };
    cashAccount: { select: { id: true; code: true; name: true } };
  };
}>;

type ScheduleItem = {
  id: string;
  staffMemberId: string;
  staffMemberName: string;
  shiftTypeId: string | null;
  shiftTypeName: string | null;
  shiftTypeLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  isOff: boolean;
  isActive: boolean;
  notes: string | null;
  cashAccountId: string | null;
  cashAccountCode: string | null;
  cashAccountName: string | null;
  createdAt: string;
  archivedAt: string | null;
  archiveReason: string | null;
  isArchived: boolean;
  canHardDelete: boolean;
  hardDeleteBlockers: string[];
};

function mapRow(s: ScheduleRow, hardDelete?: { allowed: boolean; blockers: string[] }): ScheduleItem {
  // StaffSchedule.startTime/endTime are deprecated — ShiftType hours are the source of truth.
  return {
    id:              s.id,
    staffMemberId:   s.staffMemberId,
    staffMemberName: s.staffMember.name,
    shiftTypeId:     s.shiftTypeId ?? null,
    shiftTypeName:   s.shiftType?.name ?? null,
    shiftTypeLabel:  s.shiftType?.label ?? s.shiftType?.name ?? null,
    startTime:       s.isOff ? null : (s.shiftType?.startTime ?? null),
    endTime:         s.isOff ? null : (s.shiftType?.endTime ?? null),
    isOff:           s.isOff,
    isActive:        s.isActive,
    notes:           s.notes ?? null,
    cashAccountId:   s.cashAccountId ?? null,
    cashAccountCode: s.cashAccount?.code ?? null,
    cashAccountName: s.cashAccount?.name ?? null,
    createdAt:       s.createdAt.toISOString(),
    ...mapArchiveFields(s),
    canHardDelete:   hardDelete?.allowed ?? false,
    hardDeleteBlockers: hardDelete?.blockers ?? [],
  };
}

const SCHEDULE_INCLUDE = {
  staffMember: { select: { id: true, name: true } },
  shiftType:   { select: { id: true, name: true, label: true, startTime: true, endTime: true } },
  cashAccount: { select: { id: true, code: true, name: true } },
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

  private async assertAllowedShiftType(shiftTypeId: string): Promise<{
    id: string;
    name: string;
    startTime: string;
    endTime: string;
  }> {
    const st = await prisma.shiftType.findUnique({
      where:  { id: shiftTypeId },
      select: { id: true, name: true, startTime: true, endTime: true, isActive: true },
    });
    if (!st) {
      throw Object.assign(
        new Error(`Type de shift introuvable : ${shiftTypeId}`),
        { status: 404 },
      );
    }
    if (!st.isActive || isForbiddenShiftTypeName(st.name) || !isAllowedShiftTypeName(st.name)) {
      throw Object.assign(new Error(FORBIDDEN_SHIFT_TYPE_MESSAGE), { status: 400 });
    }
    return st;
  }

  private async assertNoDuplicatePeriod(
    staffMemberId: string,
    dayOfWeek: number,
    shiftTypeId: string,
    excludeId?: string,
  ): Promise<void> {
    const st = await this.assertAllowedShiftType(shiftTypeId);
    const period = resolveShiftPeriod(st.name);
    if (!period) {
      throw Object.assign(new Error(FORBIDDEN_SHIFT_TYPE_MESSAGE), { status: 400 });
    }

    const dup = await prisma.staffSchedule.findFirst({
      where: {
        id:            excludeId ? { not: excludeId } : undefined,
        staffMemberId,
        dayOfWeek,
        shiftTypeId,
        isActive:      true,
        isOff:         false,
      },
      select: { id: true },
    });
    if (dup) {
      throw Object.assign(new Error(duplicateScheduleMessage(period)), { status: 409 });
    }
  }

  // ── A. Staff Schedule ──────────────────────────────────────────────────────────

  /**
   * Returns the weekly schedule grouped by day (all 7 days, empty items for
   * days with no active schedule). Pass staffMemberId to filter by one person.
   */
  async getSchedule(
    staffMemberId?: string,
    visibility: VisibilityFilter = 'active',
  ): Promise<{
    days: Array<{ dayOfWeek: number; label: string; items: ScheduleItem[] }>;
  }> {
    const where: Prisma.StaffScheduleWhereInput = {
      ...scheduleListWhere(visibility),
      ...(staffMemberId ? { staffMemberId } : {}),
    };

    const rows = await prisma.staffSchedule.findMany({
      where,
      include: SCHEDULE_INCLUDE,
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' },
        { endTime: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const grouped: Record<number, ScheduleItem[]> = {};
    for (const row of rows) {
      const d = row.dayOfWeek;
      if (!grouped[d]) grouped[d] = [];
      const hardDelete = await archiveService.canHardDeleteStaffSchedule(row.id);
      grouped[d].push(mapRow(row, hardDelete));
    }

    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      dayOfWeek: d,
      label:     DAY_LABELS[d]!,
      items:     sortScheduleItems(grouped[d] ?? []),
    }));

    return { days };
  }

  /**
   * Creates a schedule entry for one staff member on one day and period (Matin/Soir).
   * Same staff may have both Matin and Soir on the same day; duplicate period is rejected.
   */
  async createScheduleEntry(
    input: ScheduleCreateInput,
    userId?: string,
  ): Promise<ScheduleItem> {
    // Validate staff member
    const staff = await prisma.staffMember.findUnique({
      where:  { id: input.staffMemberId },
      select: { id: true, name: true, isActive: true, archivedAt: true },
    });
    if (!staff) {
      throw Object.assign(
        new Error(`Membre du staff introuvable : ${input.staffMemberId}`),
        { status: 404 },
      );
    }
    if (staff.archivedAt) {
      throw Object.assign(
        new Error('Cette assistante est archivée — restaurez-la avant d\'ajouter du planning.'),
        { status: 409 },
      );
    }

    // Validate shift type if provided
    let resolvedShiftType: { startTime: string; endTime: string } | null = null;
    if (!input.isOff && input.shiftTypeId) {
      const st = await this.assertAllowedShiftType(input.shiftTypeId);
      resolvedShiftType = st;
      await this.assertNoDuplicatePeriod(
        input.staffMemberId,
        input.dayOfWeek,
        input.shiftTypeId,
      );
    } else if (!input.isOff && !input.shiftTypeId) {
      throw Object.assign(
        new Error('shiftTypeId est requis lorsque isOff est false'),
        { status: 400 },
      );
    }

    // Hours come from ShiftType only — no per-schedule overrides.
    if (!input.isOff) {
      const effectiveStart = resolvedShiftType?.startTime;
      const effectiveEnd   = resolvedShiftType?.endTime;

      if (effectiveStart && effectiveEnd) {
        const startMins = parseTimeToMinutes(effectiveStart);
        const endMins   = parseTimeToMinutes(effectiveEnd);
        if (startMins == null || endMins == null || endMins <= startMins) {
          throw Object.assign(
            new Error('Les horaires du type de shift sont invalides'),
            { status: 400 },
          );
        }

        if (!env.ALLOW_MULTIPLE_OPEN_SHIFTS) {
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
            const otherStart = other.shiftType?.startTime ?? '';
            const otherEnd   = other.shiftType?.endTime ?? '';
            if (rangesOverlap(effectiveStart, effectiveEnd, otherStart, otherEnd)) {
              throw Object.assign(
                new Error('Un autre membre du staff a déjà un shift qui se chevauche ce jour-là.'),
                { status: 409 },
              );
            }
          }
        }
      }
    }

    // Deactivate only the same slot (staff + day + period, or staff + day off)
    if (input.isOff) {
      const previousOff = await prisma.staffSchedule.findMany({
        where: {
          staffMemberId: input.staffMemberId,
          dayOfWeek:     input.dayOfWeek,
          isActive:      true,
          isOff:         true,
        },
        select: { id: true },
      });
      if (previousOff.length > 0) {
        await prisma.staffSchedule.updateMany({
          where: { id: { in: previousOff.map((r) => r.id) } },
          data:  { isActive: false },
        });
      }
    } else if (input.shiftTypeId) {
      const previousSamePeriod = await prisma.staffSchedule.findMany({
        where: {
          staffMemberId: input.staffMemberId,
          dayOfWeek:     input.dayOfWeek,
          shiftTypeId:   input.shiftTypeId,
          isActive:      true,
          isOff:         false,
        },
        select: { id: true },
      });
      if (previousSamePeriod.length > 0) {
        await prisma.staffSchedule.updateMany({
          where: { id: { in: previousSamePeriod.map((r) => r.id) } },
          data:  { isActive: false },
        });
        logger.info(
          `[shift-settings] Replaced ${previousSamePeriod.length} schedule(s) for ` +
          `${staff.name} day ${input.dayOfWeek} period ${input.shiftTypeId}`,
        );
      }
    }

    const created = await prisma.staffSchedule.create({
      data: {
        staffMemberId: input.staffMemberId,
        shiftTypeId:   input.shiftTypeId ?? null,
        dayOfWeek:     input.dayOfWeek,
        startTime:     null,
        endTime:       null,
        isOff:         input.isOff,
        isActive:      true,
        notes:         input.notes ?? null,
        cashAccountId: input.cashAccountId ?? null,
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

    return mapRow(created, await archiveService.canHardDeleteStaffSchedule(created.id));
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
    let updatedShiftType: { startTime: string; endTime: string; name: string } | null = null;
    const mergedIsOff = 'isOff' in input ? (input.isOff ?? existing.isOff) : existing.isOff;
    const mergedShiftTypeId =
      'shiftTypeId' in input ? (input.shiftTypeId ?? null) : existing.shiftTypeId;

    if (!mergedIsOff) {
      if (!mergedShiftTypeId) {
        throw Object.assign(
          new Error('shiftTypeId est requis lorsque isOff est false'),
          { status: 400 },
        );
      }
      const st = await this.assertAllowedShiftType(mergedShiftTypeId);
      updatedShiftType = st;
      await this.assertNoDuplicatePeriod(
        existing.staffMemberId,
        existing.dayOfWeek,
        mergedShiftTypeId,
        id,
      );
    } else if (input.shiftTypeId != null) {
      const st = await prisma.shiftType.findUnique({
        where:  { id: input.shiftTypeId },
        select: { id: true, name: true, startTime: true, endTime: true, isActive: true },
      });
      if (!st) {
        throw Object.assign(
          new Error(`Type de shift introuvable : ${input.shiftTypeId}`),
          { status: 404 },
        );
      }
      if (isForbiddenShiftTypeName(st.name)) {
        throw Object.assign(new Error(FORBIDDEN_SHIFT_TYPE_MESSAGE), { status: 400 });
      }
    }

    if (!mergedIsOff) {
      const mergedShiftType = updatedShiftType ?? existing.shiftType;
      const effectiveStart  = mergedShiftType?.startTime;
      const effectiveEnd    = mergedShiftType?.endTime;

      if (effectiveStart && effectiveEnd) {
        const startMins = parseTimeToMinutes(effectiveStart);
        const endMins   = parseTimeToMinutes(effectiveEnd);
        if (startMins == null || endMins == null || endMins <= startMins) {
          throw Object.assign(
            new Error('Les horaires du type de shift sont invalides'),
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
            const otherStart = other.shiftType?.startTime ?? '';
            const otherEnd   = other.shiftType?.endTime ?? '';
            if (rangesOverlap(effectiveStart, effectiveEnd, otherStart, otherEnd)) {
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
    if ('isOff'       in input) data.isOff       = input.isOff;
    if ('isActive'    in input) data.isActive    = input.isActive;
    if ('notes'       in input) data.notes       = input.notes;
    if ('cashAccountId' in input) data.cashAccountId = input.cashAccountId;
    // Clear deprecated per-schedule hour overrides — ShiftType is the source of truth.
    if (!mergedIsOff) {
      data.startTime = null;
      data.endTime   = null;
    }

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

    return mapRow(updated, await archiveService.canHardDeleteStaffSchedule(updated.id));
  }

  async archiveScheduleEntry(id: string, userId?: string, input?: ArchiveReasonInput) {
    const updated = await archiveService.archiveStaffSchedule(id, userId, input);
    if (!updated) return null;
    const row = await prisma.staffSchedule.findUnique({
      where:   { id },
      include: SCHEDULE_INCLUDE,
    });
    if (!row) return null;
    return mapRow(row, await archiveService.canHardDeleteStaffSchedule(id));
  }

  async restoreScheduleEntry(id: string, userId?: string, input?: ArchiveReasonInput) {
    const updated = await archiveService.restoreStaffSchedule(id, userId, input);
    if (!updated) return null;
    const row = await prisma.staffSchedule.findUnique({
      where:   { id },
      include: SCHEDULE_INCLUDE,
    });
    if (!row) return null;
    return mapRow(row, await archiveService.canHardDeleteStaffSchedule(id));
  }

  /**
   * Soft-deletes or hard-deletes a schedule entry.
   * Hard delete only when no linked shifts exist.
   */
  async deleteScheduleEntry(id: string, userId?: string, forceHard = false): Promise<boolean> {
    const check = await archiveService.canHardDeleteStaffSchedule(id);
    if (forceHard && check.allowed) {
      return archiveService.hardDeleteStaffSchedule(id, userId);
    }
    if (forceHard && !check.allowed) {
      throw Object.assign(
        new Error(`Suppression impossible : ${check.blockers.join(', ')}. Archivez plutôt.`),
        { status: 409, blockers: check.blockers },
      );
    }

    const archived = await archiveService.archiveStaffSchedule(id, userId, {
      reason: 'Archivé via suppression',
    });
    return archived != null;
  }

  // ── B. Today suggestions ────────────────────────────────────────────────────

  /**
   * Returns today's schedule entries (including rest days) with live status.
   * Status is derived from the planned window and any Shift row auto-created
   * for (staffScheduleId, businessDate). Day-of-week uses APP_TIMEZONE.
   */
  async getTodaySuggestions(): Promise<{
    dayOfWeek: number;
    label: string;
    autoShiftEnabled: boolean;
    suggestions: Array<{
      scheduleId: string;
      staffMemberId: string;
      staffMemberName: string;
      shiftTypeId: string | null;
      shiftTypeLabel: string | null;
      startTime: string | null;
      endTime: string | null;
      status: TodayShiftStatus;
      shiftId: string | null;
    }>;
  }> {
    const tz           = env.APP_TIMEZONE;
    const dow          = todayDayOfWeek(tz);
    const businessDate = getBusinessDate(tz);
    const now          = new Date();

    const [rows, todayShifts] = await Promise.all([
      prisma.staffSchedule.findMany({
        where: {
          dayOfWeek: dow,
          ...SCHEDULE_OPERATIONAL_WHERE,
          staffMember: STAFF_VISIBLE_WHERE,
        },
        include: SCHEDULE_INCLUDE,
        orderBy: [
          { isOff: 'asc' },
          { startTime: 'asc' },
          { endTime: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
      prisma.shift.findMany({
        where:  { businessDate },
        select: { id: true, staffScheduleId: true, status: true },
      }),
    ]);

    const shiftByScheduleId = new Map<string, { id: string; status: string }>();
    for (const sh of todayShifts) {
      if (sh.staffScheduleId) {
        shiftByScheduleId.set(sh.staffScheduleId, { id: sh.id, status: sh.status });
      }
    }

    const sortedRows = [...rows].sort((a, b) => compareScheduleItems(mapRow(a), mapRow(b)));

    return {
      dayOfWeek: dow,
      label:     DAY_LABELS[dow] ?? `Jour ${dow}`,
      autoShiftEnabled: env.AUTO_SHIFT_ENABLED,
      suggestions: sortedRows.map((s) => {
        const shift = shiftByScheduleId.get(s.id);
        return {
          scheduleId:      s.id,
          staffMemberId:   s.staffMemberId,
          staffMemberName: s.staffMember.name,
          shiftTypeId:     s.shiftTypeId ?? null,
          shiftTypeLabel:  s.isOff
            ? 'Repos'
            : (s.shiftType?.label ?? s.shiftType?.name ?? null),
          startTime: s.isOff ? null : (s.shiftType?.startTime ?? null),
          endTime:   s.isOff ? null : (s.shiftType?.endTime   ?? null),
          status:    resolveTodayShiftStatus(s, now, businessDate, tz, shiftByScheduleId),
          shiftId:   shift?.id ?? null,
        };
      }),
    };
  }
}

export const shiftSettingsService = new ShiftSettingsService();
