import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import type { ArchiveReasonInput, HardDeleteCheck } from './archive.types';

// ── Audit ──────────────────────────────────────────────────────────────────────

async function writeAudit(
  params: {
    entityType: string;
    entityId: string;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  },
  userId?: string,
): Promise<void> {
  try {
    await prisma.settingsAuditLog.create({
      data: {
        userId,
        entityType: params.entityType,
        entityId:   params.entityId,
        action:     params.action,
        oldValue:   params.oldValue != null ? (params.oldValue as Prisma.InputJsonValue) : undefined,
        newValue:   params.newValue != null ? (params.newValue as Prisma.InputJsonValue) : undefined,
        reason:     params.reason,
      },
    });
  } catch (err) {
    logger.warn('[archive] Audit log write failed:', String(err));
  }
}

// ── StaffMember ────────────────────────────────────────────────────────────────

class ArchiveService {
  async canHardDeleteStaffMember(id: string): Promise<HardDeleteCheck> {
    const [shiftCount, scheduleCount, sessionCount, linkedUser] = await Promise.all([
      prisma.shift.count({ where: { staffMemberId: id } }),
      prisma.staffSchedule.count({ where: { staffMemberId: id } }),
      prisma.chairSession.count({
        where: { shift: { staffMemberId: id } },
      }),
      prisma.user.findFirst({ where: { staffMemberId: id }, select: { id: true } }),
    ]);

    const blockers: string[] = [];
    if (shiftCount > 0) blockers.push(`${shiftCount} shift(s)`);
    if (sessionCount > 0) blockers.push(`${sessionCount} session(s)`);
    if (scheduleCount > 0) blockers.push(`${scheduleCount} planning row(s)`);
    if (linkedUser) blockers.push('compte utilisateur lié');

    return { allowed: blockers.length === 0, blockers };
  }

  async archiveStaffMember(id: string, userId?: string, input?: ArchiveReasonInput) {
    const existing = await prisma.staffMember.findUnique({
      where:   { id },
      include: { user: { select: { id: true, isActive: true } } },
    });
    if (!existing) return null;
    if (existing.archivedAt) {
      throw Object.assign(new Error('Cette assistante est déjà archivée.'), { status: 409 });
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const staff = await tx.staffMember.update({
        where: { id },
        data: {
          archivedAt:    now,
          archivedById:  userId ?? null,
          archiveReason: input?.reason ?? null,
          isActive:      false,
        },
      });

      if (existing.user) {
        await tx.user.update({
          where: { id: existing.user.id },
          data:  { isActive: false },
        });
      }

      await tx.staffSchedule.updateMany({
        where: { staffMemberId: id, isActive: true, archivedAt: null },
        data: {
          archivedAt:    now,
          archivedById:  userId ?? null,
          archiveReason: input?.reason ? `Archivé avec le staff: ${input.reason}` : 'Archivé avec le staff',
          isActive:      false,
        },
      });

      return staff;
    });

    await writeAudit({
      entityType: 'StaffMember',
      entityId:   id,
      action:     'ARCHIVE',
      oldValue:   { name: existing.name, isActive: existing.isActive },
      newValue:   { archivedAt: now.toISOString(), isActive: false },
      reason:     input?.reason,
    }, userId);

    return updated;
  }

  async restoreStaffMember(id: string, userId?: string, input?: ArchiveReasonInput) {
    const existing = await prisma.staffMember.findUnique({
      where:   { id },
      include: { user: { select: { id: true } } },
    });
    if (!existing) return null;
    if (!existing.archivedAt) {
      throw Object.assign(new Error('Cette assistante n\'est pas archivée.'), { status: 409 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const staff = await tx.staffMember.update({
        where: { id },
        data: {
          archivedAt:    null,
          archivedById:  null,
          archiveReason: null,
          isActive:      true,
        },
      });

      if (existing.user && input?.reactivateLinkedUser) {
        await tx.user.update({
          where: { id: existing.user.id },
          data:  { isActive: true },
        });
      }

      return staff;
    });

    await writeAudit({
      entityType: 'StaffMember',
      entityId:   id,
      action:     'RESTORE',
      oldValue:   { archivedAt: existing.archivedAt.toISOString() },
      newValue:   { isActive: true },
      reason:     input?.reason,
    }, userId);

    return updated;
  }

  async hardDeleteStaffMember(id: string, userId?: string) {
    const check = await this.canHardDeleteStaffMember(id);
    if (!check.allowed) {
      throw Object.assign(
        new Error(
          `Suppression impossible : ${check.blockers.join(', ')}. Archivez plutôt cette donnée.`,
        ),
        { status: 409, blockers: check.blockers },
      );
    }

    const existing = await prisma.staffMember.findUnique({ where: { id } });
    if (!existing) return false;

    await prisma.staffMember.delete({ where: { id } });

    await writeAudit({
      entityType: 'StaffMember',
      entityId:   id,
      action:     'HARD_DELETE',
      oldValue:   { name: existing.name },
      reason:     'Hard delete — no dependencies',
    }, userId);

    return true;
  }

  // ── StaffSchedule ────────────────────────────────────────────────────────────

  async canHardDeleteStaffSchedule(id: string): Promise<HardDeleteCheck> {
    const shiftCount = await prisma.shift.count({ where: { staffScheduleId: id } });
    const blockers: string[] = [];
    if (shiftCount > 0) blockers.push(`${shiftCount} shift(s) lié(s)`);
    return { allowed: blockers.length === 0, blockers };
  }

  async archiveStaffSchedule(id: string, userId?: string, input?: ArchiveReasonInput) {
    const existing = await prisma.staffSchedule.findUnique({ where: { id } });
    if (!existing) return null;
    if (existing.archivedAt) {
      throw Object.assign(new Error('Cette entrée de planning est déjà archivée.'), { status: 409 });
    }

    const now = new Date();
    const updated = await prisma.staffSchedule.update({
      where: { id },
      data: {
        archivedAt:    now,
        archivedById:  userId ?? null,
        archiveReason: input?.reason ?? null,
        isActive:      false,
      },
    });

    await writeAudit({
      entityType: 'StaffSchedule',
      entityId:   id,
      action:     'ARCHIVE',
      oldValue:   { staffMemberId: existing.staffMemberId, dayOfWeek: existing.dayOfWeek },
      newValue:   { archivedAt: now.toISOString() },
      reason:     input?.reason,
    }, userId);

    return updated;
  }

  async restoreStaffSchedule(id: string, userId?: string, input?: ArchiveReasonInput) {
    const existing = await prisma.staffSchedule.findUnique({
      where:   { id },
      include: { staffMember: { select: { archivedAt: true, name: true } } },
    });
    if (!existing) return null;
    if (!existing.archivedAt && existing.isActive) {
      throw Object.assign(new Error('Cette entrée n\'est pas archivée.'), { status: 409 });
    }
    if (existing.staffMember.archivedAt) {
      throw Object.assign(
        new Error(`Restauration impossible : ${existing.staffMember.name} est archivée.`),
        { status: 409 },
      );
    }

    const updated = await prisma.staffSchedule.update({
      where: { id },
      data: {
        archivedAt:    null,
        archivedById:  null,
        archiveReason: null,
        isActive:      true,
      },
    });

    await writeAudit({
      entityType: 'StaffSchedule',
      entityId:   id,
      action:     'RESTORE',
      reason:     input?.reason,
    }, userId);

    return updated;
  }

  async hardDeleteStaffSchedule(id: string, userId?: string) {
    const check = await this.canHardDeleteStaffSchedule(id);
    if (!check.allowed) {
      throw Object.assign(
        new Error(
          `Suppression impossible : ${check.blockers.join(', ')}. Archivez plutôt cette entrée.`,
        ),
        { status: 409, blockers: check.blockers },
      );
    }

    const existing = await prisma.staffSchedule.findUnique({ where: { id } });
    if (!existing) return false;

    await prisma.staffSchedule.delete({ where: { id } });

    await writeAudit({
      entityType: 'StaffSchedule',
      entityId:   id,
      action:     'HARD_DELETE',
      oldValue:   { staffMemberId: existing.staffMemberId, dayOfWeek: existing.dayOfWeek },
    }, userId);

    return true;
  }

  // ── ShiftType ──────────────────────────────────────────────────────────────────

  async canHardDeleteShiftType(id: string): Promise<HardDeleteCheck> {
    const [shiftCount, scheduleCount, ruleCount] = await Promise.all([
      prisma.shift.count({ where: { shiftTypeId: id } }),
      prisma.staffSchedule.count({ where: { shiftTypeId: id } }),
      prisma.shiftTargetBonusRule.count({ where: { shiftTypeId: id } }),
    ]);
    const blockers: string[] = [];
    if (shiftCount > 0) blockers.push(`${shiftCount} shift(s)`);
    if (scheduleCount > 0) blockers.push(`${scheduleCount} planning row(s)`);
    if (ruleCount > 0) blockers.push(`${ruleCount} règle(s) de bonus`);
    return { allowed: blockers.length === 0, blockers };
  }

  async archiveShiftType(id: string, userId?: string, input?: ArchiveReasonInput) {
    const existing = await prisma.shiftType.findUnique({ where: { id } });
    if (!existing) return null;
    if (existing.archivedAt) {
      throw Object.assign(new Error('Ce type de shift est déjà archivé.'), { status: 409 });
    }

    const now = new Date();
    const updated = await prisma.shiftType.update({
      where: { id },
      data: {
        archivedAt:    now,
        archivedById:  userId ?? null,
        archiveReason: input?.reason ?? null,
        isActive:      false,
      },
    });

    await writeAudit({
      entityType: 'ShiftType',
      entityId:   id,
      action:     'ARCHIVE',
      oldValue:   { name: existing.name },
      newValue:   { archivedAt: now.toISOString() },
      reason:     input?.reason,
    }, userId);

    return updated;
  }

  async restoreShiftType(id: string, userId?: string, input?: ArchiveReasonInput) {
    const existing = await prisma.shiftType.findUnique({ where: { id } });
    if (!existing) return null;
    if (!existing.archivedAt) {
      throw Object.assign(new Error('Ce type de shift n\'est pas archivé.'), { status: 409 });
    }

    const updated = await prisma.shiftType.update({
      where: { id },
      data: {
        archivedAt:    null,
        archivedById:  null,
        archiveReason: null,
        isActive:      true,
      },
    });

    await writeAudit({
      entityType: 'ShiftType',
      entityId:   id,
      action:     'RESTORE',
      reason:     input?.reason,
    }, userId);

    return updated;
  }

  async hardDeleteShiftType(id: string, userId?: string) {
    const check = await this.canHardDeleteShiftType(id);
    if (!check.allowed) {
      throw Object.assign(
        new Error(
          `Suppression impossible : ${check.blockers.join(', ')}. Archivez plutôt ce type.`,
        ),
        { status: 409, blockers: check.blockers },
      );
    }

    const existing = await prisma.shiftType.findUnique({ where: { id } });
    if (!existing) return false;

    await prisma.shiftType.delete({ where: { id } });

    await writeAudit({
      entityType: 'ShiftType',
      entityId:   id,
      action:     'HARD_DELETE',
      oldValue:   { name: existing.name },
    }, userId);

    return true;
  }
}

export const archiveService = new ArchiveService();
