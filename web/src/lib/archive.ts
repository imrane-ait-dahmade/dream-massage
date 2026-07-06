export type VisibilityFilter = 'active' | 'archived' | 'all';

export const VISIBILITY_TABS: { value: VisibilityFilter; label: string }[] = [
  { value: 'active',   label: 'Actifs' },
  { value: 'archived', label: 'Archivés' },
  { value: 'all',      label: 'Tous' },
];

export interface ArchivableEntity {
  id: string;
  isArchived?: boolean;
  archivedAt?: string | null;
  archiveReason?: string | null;
  canHardDelete?: boolean;
  hardDeleteBlockers?: string[];
}
