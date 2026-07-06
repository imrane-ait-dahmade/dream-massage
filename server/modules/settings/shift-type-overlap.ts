import { prisma } from '../../prisma';
import { isAllowedShiftTypeName, isForbiddenShiftTypeName } from '../shifts/shift-period';
import {
  findShiftTypeOverlapError,
  type ShiftTypeTimeCandidate,
  SHIFT_TYPE_OVERLAP_MESSAGE,
} from './shift-time-ranges';

export { SHIFT_TYPE_OVERLAP_MESSAGE };

export async function assertNoOverlapWithActiveTypes(
  candidate: ShiftTypeTimeCandidate,
): Promise<void> {
  const others = await prisma.shiftType.findMany({
    where: { isActive: true, archivedAt: null },
    select: { id: true, name: true, startTime: true, endTime: true, isActive: true },
  });
  const filtered = others.filter(
    (st) => isAllowedShiftTypeName(st.name) && !isForbiddenShiftTypeName(st.name),
  );
  const err = findShiftTypeOverlapError(candidate, filtered);
  if (err) {
    throw Object.assign(new Error(err), { status: 409 });
  }
}
