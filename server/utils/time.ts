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
