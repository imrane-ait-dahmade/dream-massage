/**
 * Pure business rules for session plan-change requests (no database).
 * Run: npm run test:session-plan-change
 */

export const PLAN_CHANGE_REASON_MAX_LENGTH = 500;
export const PLAN_CHANGE_REVIEW_NOTE_MAX_LENGTH = 500;

export type PlanChangeSessionSnapshot = {
  id: string;
  status: string;
  archivedAt: Date | null;
  matchedPlanId: string | null;
  expectedAmount: number | null;
  correctedAmount: number | null;
  /** Measured duration — never overwritten by a plan change. */
  durationSeconds: number | null;
  updatedAt: Date;
  startedAt: Date;
  endedAt: Date | null;
  minPowerWatts: number | null;
  maxPowerWatts: number | null;
  avgPowerWatts: number | null;
  chairId: string;
  shiftId: string | null;
};

export type PlanChangePlanSnapshot = {
  id: string;
  name: string;
  durationSeconds: number;
  priceAmount: number;
  isActive: boolean;
  archivedAt: Date | null;
};

export type PendingRequestCheck = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
};

export type HttpBusinessError = {
  status: 400 | 403 | 404 | 409;
  message: string;
};

export function normalizeReason(raw: string | undefined | null): string {
  return (raw ?? '').trim();
}

export function validateReason(
  raw: string | undefined | null,
  fieldName = 'reason',
): { ok: true; value: string } | { ok: false; error: HttpBusinessError } {
  const value = normalizeReason(raw);
  if (!value) {
    return {
      ok: false,
      error: { status: 400, message: `${fieldName} est obligatoire.` },
    };
  }
  if (value.length > PLAN_CHANGE_REASON_MAX_LENGTH) {
    return {
      ok: false,
      error: {
        status: 400,
        message: `${fieldName} ne peut pas dépasser ${PLAN_CHANGE_REASON_MAX_LENGTH} caractères.`,
      },
    };
  }
  return { ok: true, value };
}

export function validateOptionalReviewNote(
  raw: string | undefined | null,
): { ok: true; value: string | null } | { ok: false; error: HttpBusinessError } {
  if (raw == null) return { ok: true, value: null };
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > PLAN_CHANGE_REVIEW_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      error: {
        status: 400,
        message: `reviewNote ne peut pas dépasser ${PLAN_CHANGE_REVIEW_NOTE_MAX_LENGTH} caractères.`,
      },
    };
  }
  return { ok: true, value };
}

export function assertSessionEligibleForPlanChange(
  session: PlanChangeSessionSnapshot | null,
): HttpBusinessError | null {
  if (!session) {
    return { status: 404, message: 'Session introuvable' };
  }
  if (session.archivedAt) {
    return { status: 409, message: 'Cette session est archivée et ne peut plus être modifiée.' };
  }
  if (session.status !== 'COMPLETED') {
    return {
      status: 409,
      message: 'Seules les sessions terminées (COMPLETED) peuvent changer de plan.',
    };
  }
  return null;
}

export function assertPlanEligibleForAssignment(
  plan: PlanChangePlanSnapshot | null,
): HttpBusinessError | null {
  if (!plan) {
    return { status: 404, message: 'Plan tarifaire introuvable' };
  }
  if (!plan.isActive || plan.archivedAt) {
    return { status: 409, message: 'Le plan demandé n’est pas actif.' };
  }
  return null;
}

export function assertPlanIsDifferent(
  currentPlanId: string | null,
  requestedPlanId: string,
): HttpBusinessError | null {
  if (currentPlanId && currentPlanId === requestedPlanId) {
    return {
      status: 409,
      message: 'Le plan demandé est identique au plan actuel de la session.',
    };
  }
  return null;
}

export function assertNoPendingRequest(
  existing: PendingRequestCheck | null,
): HttpBusinessError | null {
  if (existing && existing.status === 'PENDING') {
    return {
      status: 409,
      message: 'Une demande de modification de plan est déjà en attente pour cette session.',
    };
  }
  return null;
}

/**
 * Remaining amount relative to a recorded payment override.
 * There is no Payment model: correctedAmount is left untouched by plan changes
 * and is treated as the recorded amount already collected when present.
 * remaining = max(0, expectedAmount - recordedPaidAmount)
 * where recordedPaidAmount = correctedAmount if set, else expectedAmount (fully "covered" by expected).
 *
 * Spec example: expected 30, paid 20 → remaining 10.
 * When no correctedAmount exists, remaining is 0 (nothing separately recorded as paid).
 */
export function computeRemainingAmount(
  expectedAmount: number | null,
  correctedAmount: number | null,
): number {
  const expected = expectedAmount ?? 0;
  if (correctedAmount == null) return 0;
  return Math.max(0, expected - correctedAmount);
}

export function computeFinalAmount(
  expectedAmount: number | null,
  correctedAmount: number | null,
): number {
  return correctedAmount ?? expectedAmount ?? 0;
}

export type PlanChangeApplyInput = {
  session: PlanChangeSessionSnapshot;
  newPlan: PlanChangePlanSnapshot;
  previousPricingSnapshot: Record<string, unknown> | null;
  actorUserId: string | null;
  reason: string | null;
  source: 'OWNER_DIRECT' | 'REQUEST_APPROVED';
  requestId?: string | null;
};

export type PlanChangeSessionUpdate = {
  matchedPlanId: string;
  expectedAmount: number;
  pricingSnapshot: Record<string, unknown>;
  // Explicitly preserved — never written as changed technical fields.
  // Callers must NOT include startedAt/endedAt/duration/power/chair/shift.
};

/**
 * Builds the session update payload for a plan change.
 * Only plan-dependent business fields are returned.
 */
export function buildPlanChangeSessionUpdate(
  input: PlanChangeApplyInput,
): PlanChangeSessionUpdate {
  const { session, newPlan, previousPricingSnapshot, actorUserId, reason, source, requestId } =
    input;

  const previous = previousPricingSnapshot ?? {};

  return {
    matchedPlanId: newPlan.id,
    expectedAmount: newPlan.priceAmount,
    pricingSnapshot: {
      ...previous,
      reason: 'MANUAL_PLAN_CHANGE',
      source,
      requestId: requestId ?? null,
      actorUserId,
      changeReason: reason,
      durationSeconds: previous.durationSeconds ?? session.durationSeconds,
      previousMatchedPlanId: session.matchedPlanId,
      previousExpectedAmount: session.expectedAmount,
      matchedPlanId: newPlan.id,
      matchedPlanName: newPlan.name,
      matchedPlanDurationSeconds: newPlan.durationSeconds,
      matchedPlanPrice: newPlan.priceAmount,
      changedAt: new Date().toISOString(),
    },
  };
}

export type StaleRequestCheckInput = {
  requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  sessionMatchedPlanIdAtRequest: string | null;
  sessionUpdatedAtAtRequest: Date | null;
  currentMatchedPlanId: string | null;
  currentUpdatedAt: Date;
  requestedPlanId: string | null;
};

export function assertRequestStillPending(
  status: 'PENDING' | 'APPROVED' | 'REJECTED',
): HttpBusinessError | null {
  if (status !== 'PENDING') {
    return {
      status: 409,
      message: 'Cette demande a déjà été traitée.',
    };
  }
  return null;
}

/**
 * A request is stale when the session's matched plan (or update stamp) diverged
 * from the values captured when the request was created — typically because an
 * Owner already changed the plan directly.
 */
export function assertRequestNotStale(input: StaleRequestCheckInput): HttpBusinessError | null {
  const pendingErr = assertRequestStillPending(input.requestStatus);
  if (pendingErr) return pendingErr;

  if (
    input.sessionMatchedPlanIdAtRequest != null &&
    input.currentMatchedPlanId !== input.sessionMatchedPlanIdAtRequest
  ) {
    return {
      status: 409,
      message:
        'Cette demande est obsolète : le plan de la session a changé depuis sa création.',
    };
  }

  if (
    input.sessionUpdatedAtAtRequest != null &&
    input.currentUpdatedAt.getTime() !== input.sessionUpdatedAtAtRequest.getTime()
  ) {
    // Only treat as stale if the plan itself also no longer matches the requested target
    // OR matched plan id changed. If only non-plan fields changed (e.g. notes), allow.
    // Stricter production default: any session update after request creation is stale.
    return {
      status: 409,
      message:
        'Cette demande est obsolète : la session a été modifiée depuis sa création.',
    };
  }

  return null;
}

/**
 * Simulates conditional claim of a PENDING request (for unit tests of concurrency).
 * Returns the claimed request id, or null if already claimed.
 */
export function claimPendingRequest(
  requests: Array<{ id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' }>,
  requestId: string,
): { claimed: true; id: string } | { claimed: false } {
  const target = requests.find((r) => r.id === requestId);
  if (!target || target.status !== 'PENDING') {
    return { claimed: false };
  }
  target.status = 'APPROVED';
  return { claimed: true, id: target.id };
}

export function technicalFieldsUnchanged(
  before: PlanChangeSessionSnapshot,
  after: PlanChangeSessionSnapshot,
): boolean {
  return (
    before.startedAt.getTime() === after.startedAt.getTime() &&
    (before.endedAt?.getTime() ?? null) === (after.endedAt?.getTime() ?? null) &&
    before.durationSeconds === after.durationSeconds &&
    before.minPowerWatts === after.minPowerWatts &&
    before.maxPowerWatts === after.maxPowerWatts &&
    before.avgPowerWatts === after.avgPowerWatts &&
    before.chairId === after.chairId &&
    before.shiftId === after.shiftId
  );
}
