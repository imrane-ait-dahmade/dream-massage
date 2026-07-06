/**
 * Client mirror of server shift period rules — Matin and Soir only.
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

export function periodSortOrder(name: string | null | undefined, isOff = false): number {
  if (isOff) return 99;
  const period = resolveShiftPeriod(name);
  if (period === 'MORNING') return 0;
  if (period === 'EVENING') return 1;
  return 50;
}

export function filterAllowedShiftTypes<T extends { name: string; isActive: boolean }>(
  types: T[],
): T[] {
  return types.filter((st) => st.isActive && isAllowedShiftTypeName(st.name) && !isForbiddenShiftTypeName(st.name));
}
