import type { Prisma } from '@prisma/client';

export type VisibilityFilter = 'active' | 'archived' | 'all';

export function parseVisibilityFilter(raw?: string | null): VisibilityFilter {
  if (raw === 'archived' || raw === 'all') return raw;
  return 'active';
}

/** Normal app usage — visible staff for dropdowns and new assignments. */
export const STAFF_VISIBLE_WHERE: Prisma.StaffMemberWhereInput = {
  archivedAt: null,
  isActive:   true,
};

export function staffListWhere(filter: VisibilityFilter): Prisma.StaffMemberWhereInput {
  if (filter === 'archived') return { archivedAt: { not: null } };
  if (filter === 'all') return {};
  return { archivedAt: null };
}

export function scheduleListWhere(filter: VisibilityFilter): Prisma.StaffScheduleWhereInput {
  if (filter === 'archived') {
    return { OR: [{ archivedAt: { not: null } }, { isActive: false }] };
  }
  if (filter === 'all') return {};
  return { isActive: true, archivedAt: null };
}

/** Auto-shift and today suggestions — never use archived planning. */
export const SCHEDULE_OPERATIONAL_WHERE: Prisma.StaffScheduleWhereInput = {
  isActive:   true,
  archivedAt: null,
  isOff:      false,
};

export function shiftTypeListWhere(filter: VisibilityFilter): Prisma.ShiftTypeWhereInput {
  if (filter === 'archived') return { archivedAt: { not: null } };
  if (filter === 'all') return {};
  return { archivedAt: null, isActive: true };
}

export function mapArchiveFields(row: {
  archivedAt: Date | null;
  archiveReason: string | null;
}) {
  return {
    archivedAt:    row.archivedAt?.toISOString() ?? null,
    archiveReason: row.archiveReason ?? null,
    isArchived:    row.archivedAt != null,
  };
}
