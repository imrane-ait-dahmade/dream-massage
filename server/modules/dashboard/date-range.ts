/**
 * Centralized business-date range helpers for Dream Care dashboard stats.
 *
 * Convention (Africa/Casablanca):
 *   inclusive calendar start → exclusive UTC upper bound (start of day after `to`)
 *
 * Example: 01/07/2026 → 31/08/2026
 *   gte: 2026-07-01 00:00 Casablanca (as UTC instant)
 *   lt:  2026-09-01 00:00 Casablanca (as UTC instant)
 */
import { getTimezone, getDayBoundsUtc, getBusinessDate } from '../../utils/time';

export const DASHBOARD_PRESETS = [
  'today',
  'yesterday',
  'week',
  'month',
  'year',
  'custom',
] as const;

export type DashboardPreset = (typeof DASHBOARD_PRESETS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidBusinessDate(value: string | undefined | null): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Add n calendar days to a YYYY-MM-DD string (Gregorian, timezone-agnostic). */
export function addCalendarDays(yyyyMmDd: string, n: number): string {
  const [y, mo, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Today's calendar date in the business timezone. */
export function todayBusinessDate(tz: string = getTimezone()): string {
  return getBusinessDate(tz);
}

/**
 * Resolve a UI preset to inclusive calendar dates (from/to as YYYY-MM-DD).
 * Week = Monday → Sunday (ISO-style week start Monday).
 */
export function resolvePresetDates(
  preset: string,
  today: string,
): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addCalendarDays(today, -1);
      return { from: y, to: y };
    }
    case 'week': {
      // Monday = start of week
      const probe = new Date(today + 'T12:00:00Z');
      const dow = probe.getUTCDay(); // 0=Sun … 6=Sat
      const mon = addCalendarDays(today, -((dow + 6) % 7));
      return { from: mon, to: addCalendarDays(mon, 6) };
    }
    case 'month': {
      const [y, mo] = today.split('-').map(Number);
      const first = `${y}-${String(mo).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const last = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { from: first, to: last };
    }
    case 'year': {
      const y = today.slice(0, 4);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: today, to: today };
  }
}

export interface DateRangeFilter {
  /** Inclusive lower bound (UTC instant of local midnight on `from`). */
  gte: Date;
  /** Exclusive upper bound (UTC instant of local midnight on day after `to`). */
  lt: Date;
  from: string;
  to: string;
}

/**
 * Build the single date filter used by all dashboard stats / chart / export paths.
 * Never use `lte: end-of-day` — always semi-open `[gte, lt)`.
 */
export function buildDateRangeFilter(
  startDate: string,
  endDate: string,
  tz: string = getTimezone(),
): DateRangeFilter {
  const from = isValidBusinessDate(startDate) ? startDate : todayBusinessDate(tz);
  let to = isValidBusinessDate(endDate) ? endDate : from;
  if (to < from) to = from;

  const gte = getDayBoundsUtc(from, tz).start;
  const lt = getDayBoundsUtc(addCalendarDays(to, 1), tz).start;

  return { gte, lt, from, to };
}

/** Prisma-ready fragment: `startedAt: { gte, lt }`. */
export function startedAtDateFilter(
  startDate: string,
  endDate: string,
  tz: string = getTimezone(),
): { gte: Date; lt: Date } {
  const { gte, lt } = buildDateRangeFilter(startDate, endDate, tz);
  return { gte, lt };
}
