import { env } from '../config/env';

export function nowISO(): string {
  return new Date().toISOString();
}

export function elapsedSeconds(since: Date): number {
  return Math.floor((Date.now() - since.getTime()) / 1000);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function getTimezone(): string {
  return env.APP_TIMEZONE;
}

/** YYYY-MM-DD in the configured business timezone. */
export function getBusinessDate(tz: string = env.APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2000';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${mo}-${d}`;
}

/** UTC bounds for a business calendar day (start inclusive, end exclusive). */
export function getDayBoundsUtc(
  businessDate: string,
  tz: string = env.APP_TIMEZONE,
): { start: Date; end: Date } {
  const probeUTC = new Date(`${businessDate}T00:00:00Z`);
  const local = new Date(probeUTC.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = local.getTime() - probeUTC.getTime();
  const start = new Date(probeUTC.getTime() - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Local HH:mm on a business calendar day → UTC Date. */
export function buildScheduledDatetime(businessDate: string, hhmm: string, tz: string): Date {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr ?? '0', 10);
  const m = parseInt(mStr ?? '0', 10);
  const probeUTC = new Date(`${businessDate}T00:00:00Z`);
  const local = new Date(probeUTC.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = local.getTime() - probeUTC.getTime();
  const midnightUTC = new Date(probeUTC.getTime() - offsetMs);
  return new Date(midnightUTC.getTime() + (h * 60 + m) * 60_000);
}

/** Seconds since local midnight in the given timezone. */
export function getLocalSecondsSinceMidnight(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const s = parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10);
  return h * 3600 + m * 60 + s;
}

/** Milliseconds until the next :00, :15, :30, or :45 boundary in APP_TIMEZONE. */
export function msUntilNextQuarterHour(now: Date = new Date(), tz: string = env.APP_TIMEZONE): number {
  const sec = getLocalSecondsSinceMidnight(now, tz);
  const interval = 15 * 60;
  const nextSlot = (Math.floor(sec / interval) + 1) * interval;
  const waitSec = nextSlot >= 24 * 3600 ? interval : nextSlot - sec;
  return Math.max(1_000, waitSec * 1000);
}
