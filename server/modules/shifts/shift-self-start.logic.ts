/**
 * Pure helpers for assistant self-start shift creation (no database).
 */

import { buildScheduledDatetime } from '../../utils/time';
import { isAllowedShiftTypeName } from './shift-period';

export type SelfStartShiftTypeInput = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

export type SelfStartShiftSchedule = {
  businessDate: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
};

export function assertSelfStartShiftTypeAllowed(
  shiftType: SelfStartShiftTypeInput | null | undefined,
): void {
  if (!shiftType) {
    throw Object.assign(new Error('Type de shift introuvable'), { status: 404 });
  }
  if (!shiftType.isActive || !isAllowedShiftTypeName(shiftType.name)) {
    throw Object.assign(
      new Error('Seuls les shifts Matin et Soir sont autorisés.'),
      { status: 400 },
    );
  }
}

export function buildSelfStartSchedule(
  shiftType: Pick<SelfStartShiftTypeInput, 'startTime' | 'endTime'>,
  businessDate: string,
  tz: string,
): SelfStartShiftSchedule {
  return {
    businessDate,
    scheduledStartAt: buildScheduledDatetime(businessDate, shiftType.startTime, tz),
    scheduledEndAt:   buildScheduledDatetime(businessDate, shiftType.endTime, tz),
  };
}
