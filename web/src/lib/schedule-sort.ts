import type { StaffScheduleItem, TodayShiftSuggestion } from './types';
import { periodSortOrder } from './shift-period';

function timeToMinutes(hhmm: string | null): number {
  if (!hhmm) return 99_999;
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return 99_999;
  return parseInt(match[1]!, 10) * 60 + parseInt(match[2]!, 10);
}

function effectiveStart(item: { isOff?: boolean; startTime: string | null }): number {
  if (item.isOff) return 100_000;
  return timeToMinutes(item.startTime);
}

function effectiveEnd(item: { isOff?: boolean; endTime: string | null }): number {
  if (item.isOff) return 100_000;
  return timeToMinutes(item.endTime);
}

function periodName(item: StaffScheduleItem): string | null {
  return item.shiftTypeName ?? item.shiftTypeLabel;
}

export function compareScheduleItems(
  a: StaffScheduleItem,
  b: StaffScheduleItem,
): number {
  if (a.isOff !== b.isOff) return a.isOff ? 1 : -1;
  const periodDiff =
    periodSortOrder(periodName(a), a.isOff) - periodSortOrder(periodName(b), b.isOff);
  if (periodDiff !== 0) return periodDiff;
  const startDiff = effectiveStart(a) - effectiveStart(b);
  if (startDiff !== 0) return startDiff;
  const endDiff = effectiveEnd(a) - effectiveEnd(b);
  if (endDiff !== 0) return endDiff;
  const byName = a.staffMemberName.localeCompare(b.staffMemberName, 'fr');
  if (byName !== 0) return byName;
  const aCreated = a.createdAt ?? '';
  const bCreated = b.createdAt ?? '';
  return aCreated.localeCompare(bCreated) || a.id.localeCompare(b.id);
}

export function sortScheduleDays(
  days: Array<{ dayOfWeek: number; label: string; items: StaffScheduleItem[] }>,
): Array<{ dayOfWeek: number; label: string; items: StaffScheduleItem[] }> {
  return days.map((day) => ({
    ...day,
    items: [...day.items].sort(compareScheduleItems),
  }));
}

export function sortTodaySuggestions(items: TodayShiftSuggestion[]): TodayShiftSuggestion[] {
  return [...items].sort((a, b) => {
    const aOff = a.status === 'rest';
    const bOff = b.status === 'rest';
    if (aOff !== bOff) return aOff ? 1 : -1;
    const startDiff = effectiveStart({ isOff: aOff, startTime: a.startTime }) -
      effectiveStart({ isOff: bOff, startTime: b.startTime });
    if (startDiff !== 0) return startDiff;
    const endDiff = effectiveEnd({ isOff: aOff, endTime: a.endTime }) -
      effectiveEnd({ isOff: bOff, endTime: b.endTime });
    if (endDiff !== 0) return endDiff;
    return a.staffMemberName.localeCompare(b.staffMemberName, 'fr') ||
      a.scheduleId.localeCompare(b.scheduleId);
  });
}
