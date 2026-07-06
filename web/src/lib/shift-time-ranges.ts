import { isAllowedShiftTypeName, isForbiddenShiftTypeName } from './shift-period';

export const SHIFT_TYPE_OVERLAP_MESSAGE =
  'Les horaires de Matin et Soir ne doivent pas se chevaucher.';

const HH_MM = /^(\d{2}):(\d{2})$/;

export function parseTimeToMinutes(hhmm: string): number | null {
  const match = HH_MM.exec(hhmm.trim());
  if (!match) return null;
  const h = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const sa = parseTimeToMinutes(startA);
  const ea = parseTimeToMinutes(endA);
  const sb = parseTimeToMinutes(startB);
  const eb = parseTimeToMinutes(endB);
  if (sa == null || ea == null || sb == null || eb == null) return false;
  return sa < eb && sb < ea;
}

export function validateShiftTypeTimeRange(startTime: string, endTime: string): string | null {
  const start = startTime.trim();
  const end = endTime.trim();
  if (!start || !end) return 'Les horaires sont requis (format HH:mm).';
  const startM = parseTimeToMinutes(start);
  const endM = parseTimeToMinutes(end);
  if (startM == null || endM == null) return 'Format horaire invalide (HH:mm).';
  if (endM <= startM) return 'L\'heure de fin doit être après l\'heure de début.';
  return null;
}

export type ShiftTypeTimeCandidate = {
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  isActive?: boolean;
};

export function findShiftTypeOverlapError(
  candidate: ShiftTypeTimeCandidate,
  others: ShiftTypeTimeCandidate[],
): string | null {
  const rangeErr = validateShiftTypeTimeRange(candidate.startTime, candidate.endTime);
  if (rangeErr) return rangeErr;

  for (const other of others) {
    if (other.isActive === false) continue;
    if (candidate.id && other.id === candidate.id) continue;
    if (!isAllowedShiftTypeName(other.name) || isForbiddenShiftTypeName(other.name)) continue;
    if (rangesOverlap(candidate.startTime, candidate.endTime, other.startTime, other.endTime)) {
      return SHIFT_TYPE_OVERLAP_MESSAGE;
    }
  }
  return null;
}
