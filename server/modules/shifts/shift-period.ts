/**
 * Shift period rules — only Matin (MORNING) and Soir (EVENING) are valid.
 * Journée / DAY / FULL_DAY are forbidden.
 */

export const FORBIDDEN_SHIFT_TYPE_NAMES = new Set([
  'JOURNEE',
  'JOURNÉE',
  'DAY',
  'FULL_DAY',
  'FULLDAY',
]);

const MORNING_ALIASES = new Set(['MATIN', 'MORNING']);
const EVENING_ALIASES = new Set(['SOIR', 'EVENING', 'APRES-MIDI', 'APRÈS-MIDI', 'APRES_MIDI']);

export type ShiftPeriod = 'MORNING' | 'EVENING';

export function normalizeShiftTypeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .trim();
}

export function isForbiddenShiftTypeName(name: string): boolean {
  return FORBIDDEN_SHIFT_TYPE_NAMES.has(normalizeShiftTypeName(name));
}

export function isAllowedShiftTypeName(name: string): boolean {
  const n = normalizeShiftTypeName(name);
  return MORNING_ALIASES.has(n) || EVENING_ALIASES.has(n);
}

export function resolveShiftPeriod(name: string | null | undefined): ShiftPeriod | null {
  if (!name) return null;
  const n = normalizeShiftTypeName(name);
  if (MORNING_ALIASES.has(n)) return 'MORNING';
  if (EVENING_ALIASES.has(n)) return 'EVENING';
  return null;
}

/** Sort key: MORNING (0) before EVENING (1); rest/off last. */
export function periodSortOrder(name: string | null | undefined, isOff = false): number {
  if (isOff) return 99;
  const period = resolveShiftPeriod(name);
  if (period === 'MORNING') return 0;
  if (period === 'EVENING') return 1;
  return 50;
}

export function periodLabelFr(period: ShiftPeriod): string {
  return period === 'MORNING' ? 'Matin' : 'Soir';
}

export function duplicateScheduleMessage(period: ShiftPeriod): string {
  return `Cette personne est déjà affectée au shift ${periodLabelFr(period)} ce jour.`;
}

export const FORBIDDEN_SHIFT_TYPE_MESSAGE =
  'Seuls les shifts Matin et Soir sont autorisés. Le type Journée n\'est plus supporté.';

/** Default period windows when shift type config is missing (Africa/Casablanca business day). */
export const DEFAULT_PERIOD_WINDOWS: Record<ShiftPeriod, { start: string; end: string }> = {
  MORNING: { start: '08:00', end: '15:00' },
  EVENING: { start: '15:00', end: '23:45' },
};
