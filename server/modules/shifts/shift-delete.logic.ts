/**
 * Pure rules for shift hard-delete (no database).
 * Run: npm run test:shift-delete
 */

export type ShiftDeleteInput = {
  sessionCount: number;
};

export type ShiftDeleteAssessment = {
  /** Sessions are never deleted — they are detached from the shift. */
  detachSessions: number;
  canDelete: boolean;
  blockers: string[];
};

export function assessShiftDeletion(input: ShiftDeleteInput): ShiftDeleteAssessment {
  return {
    detachSessions: input.sessionCount,
    canDelete: true,
    blockers: [],
  };
}
