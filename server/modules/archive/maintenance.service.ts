import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import { archiveService } from './archive.service';
import type { BulkMaintenanceInput } from './archive.types';

class MaintenanceService {
  getBackupInstructions() {
    return {
      recommendedBefore: ['hard delete', 'bulk cleanup', 'production data reset'],
      pgDump: 'pg_dump "$DIRECT_URL" -Fc -f backup-YYYY-MM-DD.dump',
      neon:   'Create a Neon branch/snapshot before destructive cleanup.',
      note:   'Never expose database credentials in the frontend. Run backups from a secure shell.',
    };
  }

  async bulkArchiveInactiveStaff(userId: string, input: BulkMaintenanceInput) {
    if (input.confirmation !== 'ARCHIVE') {
      throw Object.assign(
        new Error('Confirmation invalide. Tapez ARCHIVE pour confirmer.'),
        { status: 400 },
      );
    }

    const candidates = await prisma.staffMember.findMany({
      where: {
        archivedAt: null,
        isActive:   false,
        shifts:     { none: {} },
      },
      select: { id: true, name: true },
    });

    let archived = 0;
    for (const staff of candidates) {
      try {
        await archiveService.archiveStaffMember(staff.id, userId, { reason: input.reason ?? 'Bulk archive inactive staff' });
        archived++;
      } catch (err) {
        logger.warn(`[maintenance] Skip staff ${staff.id}:`, String(err));
      }
    }

    await prisma.settingsAuditLog.create({
      data: {
        userId,
        entityType: 'Maintenance',
        action:     'BULK_ARCHIVE_INACTIVE_STAFF',
        newValue:   { archived, candidateCount: candidates.length },
        reason:     input.reason,
      },
    });

    return { archived, candidateCount: candidates.length };
  }

  async bulkArchiveOrphanSchedules(userId: string, input: BulkMaintenanceInput) {
    if (input.confirmation !== 'ARCHIVE') {
      throw Object.assign(
        new Error('Confirmation invalide. Tapez ARCHIVE pour confirmer.'),
        { status: 400 },
      );
    }

    const candidates = await prisma.staffSchedule.findMany({
      where: {
        isActive:   true,
        archivedAt: null,
        shifts:     { none: {} },
        staffMember: { archivedAt: { not: null } },
      },
      select: { id: true },
    });

    let archived = 0;
    for (const row of candidates) {
      await archiveService.archiveStaffSchedule(row.id, userId, {
        reason: input.reason ?? 'Bulk archive — staff archived',
      });
      archived++;
    }

    await prisma.settingsAuditLog.create({
      data: {
        userId,
        entityType: 'Maintenance',
        action:     'BULK_ARCHIVE_ORPHAN_SCHEDULES',
        newValue:   { archived, candidateCount: candidates.length },
        reason:     input.reason,
      },
    });

    return { archived, candidateCount: candidates.length };
  }
}

export const maintenanceService = new MaintenanceService();
