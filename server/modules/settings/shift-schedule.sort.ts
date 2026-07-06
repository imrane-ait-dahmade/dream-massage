import {
  periodSortOrder,
} from '../shifts/shift-period';

export type ScheduleSortItem = {
  id: string;
  staffMemberName: string;
  shiftTypeName: string | null;
  startTime: string | null;
  endTime: string | null;
  isOff: boolean;
  createdAt: string;
};

function timeToMinutes(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return -1;
  return parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10);
}

function effectiveStartMinutes(item: Pick<ScheduleSortItem, 'isOff' | 'startTime'>): number {
  if (item.isOff) return 100_000;
  if (!item.startTime) return 99_999;
  const m = timeToMinutes(item.startTime);
  return m >= 0 ? m : 99_999;
}

function effectiveEndMinutes(item: Pick<ScheduleSortItem, 'isOff' | 'endTime'>): number {
  if (item.isOff) return 100_000;
  if (!item.endTime) return 99_999;
  const m = timeToMinutes(item.endTime);
  return m >= 0 ? m : 99_999;
}

/** Stable sort: period (Matin before Soir), start, end, name, createdAt, id. */
export function compareScheduleItems(a: ScheduleSortItem, b: ScheduleSortItem): number {
  if (a.isOff !== b.isOff) return a.isOff ? 1 : -1;
  const periodDiff =
    periodSortOrder(a.shiftTypeName, a.isOff) - periodSortOrder(b.shiftTypeName, b.isOff);
  if (periodDiff !== 0) return periodDiff;
  const startDiff = effectiveStartMinutes(a) - effectiveStartMinutes(b);
  if (startDiff !== 0) return startDiff;
  const endDiff = effectiveEndMinutes(a) - effectiveEndMinutes(b);
  if (endDiff !== 0) return endDiff;
  const byName = a.staffMemberName.localeCompare(b.staffMemberName, 'fr');
  if (byName !== 0) return byName;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function sortScheduleItems<T extends ScheduleSortItem>(items: T[]): T[] {
  return [...items].sort(compareScheduleItems);
}
