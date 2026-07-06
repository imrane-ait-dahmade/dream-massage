import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanningSlot, SeedDataFile } from './seed-data.types';

export const JOURNEE_SHIFT_TYPE_ID = '00000000-0000-0000-0004-000000000003';
export const MATIN_SHIFT_TYPE_ID = '00000000-0000-0000-0004-000000000001';
export const SOIR_SHIFT_TYPE_ID = '00000000-0000-0000-0004-000000000002';

/**
 * Canonical business hours — normalized on seed (production dump had 10:00–15:00 / 15:00–22:00).
 * Documented in DATA_MAINTENANCE.md and seed output.
 */
export const CANONICAL_SHIFT_HOURS = {
  MATIN: { startTime: '08:00', endTime: '15:00', label: 'Matin' },
  SOIR:  { startTime: '15:00', endTime: '23:45', label: 'Soir' },
} as const;

const DATA_FILE = join(__dirname, '..', 'seed-data', 'dream-massage-seed-data.json');

let cached: SeedDataFile | null = null;

export function loadSeedData(): SeedDataFile {
  if (!cached) {
    cached = JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as SeedDataFile;
  }
  return cached;
}

export function planningSlotKey(slot: PlanningSlot): string {
  return `${slot.staffMemberId}|${slot.dayOfWeek}|${slot.isOff ? 'OFF' : slot.shiftTypeId ?? '?'}`;
}

/**
 * Build planning slots from active staff_schedules in the JSON dump.
 * - Expands JOURNEE → MATIN + SOIR
 * - Drops per-row start/end times (hours come from ShiftType)
 */
export function buildPlanningSlots(
  data: SeedDataFile,
  rosterStaffIds: Set<string>,
): PlanningSlot[] {
  const slots: PlanningSlot[] = [];
  const seen = new Set<string>();

  const active = data.seedData.staffSchedules.filter(
    (s) => s.is_active && rosterStaffIds.has(s.staff_member_id),
  );

  for (const row of active) {
    if (row.is_off) {
      const slot: PlanningSlot = {
        staffMemberId: row.staff_member_id,
        dayOfWeek: row.day_of_week,
        shiftTypeId: null,
        isOff: true,
      };
      const key = planningSlotKey(slot);
      if (!seen.has(key)) {
        seen.add(key);
        slots.push(slot);
      }
      continue;
    }

    if (row.shift_type_id === JOURNEE_SHIFT_TYPE_ID) {
      for (const shiftTypeId of [MATIN_SHIFT_TYPE_ID, SOIR_SHIFT_TYPE_ID]) {
        const slot: PlanningSlot = {
          staffMemberId: row.staff_member_id,
          dayOfWeek: row.day_of_week,
          shiftTypeId,
          isOff: false,
        };
        const key = planningSlotKey(slot);
        if (!seen.has(key)) {
          seen.add(key);
          slots.push(slot);
        }
      }
      continue;
    }

    if (
      row.shift_type_id === MATIN_SHIFT_TYPE_ID ||
      row.shift_type_id === SOIR_SHIFT_TYPE_ID
    ) {
      const slot: PlanningSlot = {
        staffMemberId: row.staff_member_id,
        dayOfWeek: row.day_of_week,
        shiftTypeId: row.shift_type_id,
        isOff: false,
      };
      const key = planningSlotKey(slot);
      if (!seen.has(key)) {
        seen.add(key);
        slots.push(slot);
      }
    }
  }

  return slots.sort((a, b) => {
    if (a.staffMemberId !== b.staffMemberId) return a.staffMemberId.localeCompare(b.staffMemberId);
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return (a.shiftTypeId ?? '').localeCompare(b.shiftTypeId ?? '');
  });
}

export function rosterStaffIds(data: SeedDataFile): Set<string> {
  return new Set(
    data.seedData.staffMembers
      .filter((s) => s.is_active)
      .map((s) => s.id),
  );
}
