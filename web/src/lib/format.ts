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

/** Format an ISO date string to HH:mm */
export function formatTimeHHMM(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
  return new Date(isoString).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
