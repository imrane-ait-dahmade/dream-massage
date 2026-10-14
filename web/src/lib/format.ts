/** Format a dirham amount: "1 380 DH" */
export function formatDH(amount: number): string {
  return `${Math.round(amount).toLocaleString('fr-FR')} DH`;
}

/**
 * Format elapsed seconds as mm:ss or h:mm:ss.
 * Display-only — backend is the source of truth for session duration.
 */
export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

// ── Server clock ───────────────────────────────────────────────────────────────
// Elapsed timers use the server clock: staff phones may have a wrong local time.

let serverClockOffsetMs = 0;

/** Record server time measured by a request sent at requestStartMs and answered at requestEndMs. */
export function setServerClock(serverNowIso: string, requestStartMs: number, requestEndMs: number): void {
  const serverMs = new Date(serverNowIso).getTime();
  if (!Number.isFinite(serverMs)) return;
  serverClockOffsetMs = serverMs - (requestStartMs + requestEndMs) / 2;
}

/** Current epoch ms per the server clock (device clock until the first sync). */
export function serverNowMs(): number {
  return Date.now() + serverClockOffsetMs;
}

// ── Business time (Morocco) ────────────────────────────────────────────────────
// Times are rendered with UTC offsets computed by the server (GET /api/time),
// never with the phone's own timezone rules, which are outdated on some
// devices (pre-2018 Morocco rules → 1h off).

const FALLBACK_TIME_ZONE = 'Africa/Casablanca';
const TRANSITIONS_STORAGE_KEY = 'dm.businessTimeTransitions.v1';

export interface UtcOffsetTransition {
  at: number;
  offsetMinutes: number;
}

function isValidTransitions(value: unknown): value is UtcOffsetTransition[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (t) =>
        t &&
        typeof t === 'object' &&
        Number.isFinite((t as UtcOffsetTransition).at) &&
        Number.isFinite((t as UtcOffsetTransition).offsetMinutes),
    )
  );
}

function loadCachedTransitions(): UtcOffsetTransition[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TRANSITIONS_STORAGE_KEY) ?? 'null');
    return isValidTransitions(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let offsetTransitions: UtcOffsetTransition[] | null = loadCachedTransitions();

export function hasBusinessTimeTransitions(): boolean {
  return !!offsetTransitions?.length;
}

export function setBusinessTimeTransitions(transitions: unknown): void {
  if (!isValidTransitions(transitions)) return;
  offsetTransitions = [...transitions].sort((a, b) => a.at - b.at);
  try {
    window.localStorage.setItem(TRANSITIONS_STORAGE_KEY, JSON.stringify(offsetTransitions));
  } catch {
    // storage unavailable (private mode) — in-memory value still applies
  }
}

function offsetMinutesAt(ms: number): number | null {
  if (!offsetTransitions?.length) return null;
  let offset = offsetTransitions[0]!.offsetMinutes;
  for (const t of offsetTransitions) {
    if (t.at > ms) break;
    offset = t.offsetMinutes;
  }
  return offset;
}

function formatBusiness(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions,
  kind: 'time' | 'datetime',
): string {
  const ms = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(ms)) return '—';

  const offset = offsetMinutesAt(ms);
  const date = offset == null ? new Date(ms) : new Date(ms + offset * 60_000);
  const timeZone = offset == null ? FALLBACK_TIME_ZONE : 'UTC';
  const render = (tz: string | undefined) =>
    kind === 'time'
      ? date.toLocaleTimeString('fr-FR', { ...options, timeZone: tz })
      : date.toLocaleString('fr-FR', { ...options, timeZone: tz });

  try {
    return render(timeZone);
  } catch {
    return render(undefined);
  }
}

/** Format an ISO date string to HH:mm */
export function formatTimeHHMM(isoString: string): string {
  return formatBusiness(isoString, { hour: '2-digit', minute: '2-digit' }, 'time');
}

/** Format seconds as compact duration: "2h05m" or "45m" */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/** Format an ISO string to HH:mm (returns "—" if null) */
export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return formatBusiness(isoString, { hour: '2-digit', minute: '2-digit' }, 'time');
}

/** HH:mm or HH:mm:ss for a Date or ISO string, in business time. */
export function formatClockTime(input: Date | string, withSeconds = false): string {
  return formatBusiness(
    input,
    withSeconds
      ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' },
    'time',
  );
}

/** Format an ISO string to date + time (fr-FR). */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return formatBusiness(
    isoString,
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    'datetime',
  );
}

/** Short date + time without year: "24/09 14:05". */
export function formatDateTimeShort(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return formatBusiness(
    isoString,
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
    'datetime',
  );
}

/** Cash amounts with up to 2 decimals: "1 250,50 DH" */
export function formatCashDH(amount: number): string {
  return `${Number(amount).toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} DH`;
}
