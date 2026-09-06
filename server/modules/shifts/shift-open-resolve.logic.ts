/**
 * Pure rules for resolving which OPEN shift a new ChairSession should attach to.
 * Shop-wide: at most one OPEN shift when self-start / mono-shift mode is active.
 */

export type OpenShiftResolveResult = {
  shiftId: string | null;
  anomalyType: string | null;
};

export function resolveOpenShiftForSession(
  openShiftIds: string[],
): OpenShiftResolveResult {
  if (openShiftIds.length === 0) {
    return { shiftId: null, anomalyType: 'NO_OPEN_SHIFT' };
  }
  if (openShiftIds.length === 1) {
    return { shiftId: openShiftIds[0]!, anomalyType: null };
  }
  return { shiftId: null, anomalyType: 'MULTIPLE_OPEN_SHIFTS' };
}

export function buildShiftAlreadyOpenMessage(staffName: string, shiftTypeLabel: string): string {
  return `Un shift est déjà actif : ${staffName} — ${shiftTypeLabel}.`;
}

/** When self-start is enabled, refuse financial ChairSession without exactly one OPEN shift. */
export function shouldBlockFinancialSessionCreation(
  selfStartEnabled: boolean,
  resolved: OpenShiftResolveResult,
): boolean {
  if (!selfStartEnabled) return false;
  return resolved.shiftId == null || resolved.anomalyType != null;
}
