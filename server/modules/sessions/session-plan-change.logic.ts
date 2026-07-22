/**
 * Pure business rules for session modification requests (plan and/or paid amount).
 * paidAmount is stored as ChairSession.correctedAmount.
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
      message: 'Seules les sessions terminées (COMPLETED) peuvent être modifiées.',
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
      message: 'Une demande de modification est déjà en attente pour cette session.',
    };
  }
  return null;
}

/**
 * Remaining amount relative to a recorded payment override (paidAmount).
 * There is no Payment model: correctedAmount stores paidAmount.
 * Plan changes leave correctedAmount untouched unless a paid change is also requested.
 * remaining = max(0, expectedAmount - paidAmount) when paid is set; else 0.
 *
 * Spec example: expected 30, paid 20 → remaining 10.
 * paidAmount = 0 is valid (séance offerte / impayé enregistré).
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

export type ModificationRequestInput = {
  requestedPlanId?: string | null;
  /** Use !== undefined to detect presence; 0 is a valid paid amount. */
  requestedPaidAmount?: number | null;
};

/**
 * At least one modification must be present.
 * Plan change: requestedPlanId is a non-empty string.
 * Paid change: requestedPaidAmount is a finite number >= 0 (including 0).
 * Never use truthiness checks on paid amounts (0 must remain valid).
 */
export function validateModificationRequestInput(
  input: ModificationRequestInput,
):
  | {
      ok: true;
      hasPlanChange: boolean;
      hasPaidChange: boolean;
      requestedPlanId: string | null;
      requestedPaidAmount: number | null;
    }
  | { ok: false; error: HttpBusinessError } {
  const planId =
    typeof input.requestedPlanId === 'string' && input.requestedPlanId.trim()
      ? input.requestedPlanId.trim()
      : null;
  const hasPlanChange = planId != null;

  const paidProvided = input.requestedPaidAmount !== undefined;
  let requestedPaidAmount: number | null = null;
  let hasPaidChange = false;

  if (paidProvided) {
    if (input.requestedPaidAmount === null) {
      return {
        ok: false,
        error: {
          status: 400,
          message: 'requestedPaidAmount ne peut pas être null ; omettez le champ pour ne pas le modifier.',
        },
      };
    }
    const n = Number(input.requestedPaidAmount);
    if (!Number.isFinite(n)) {
      return {
        ok: false,
        error: { status: 400, message: 'requestedPaidAmount doit être un nombre valide.' },
      };
    }
    if (n < 0) {
      return {
        ok: false,
        error: { status: 400, message: 'requestedPaidAmount doit être >= 0.' },
      };
    }
    requestedPaidAmount = n;
    hasPaidChange = true;
  }

  if (!hasPlanChange && !hasPaidChange) {
    return {
      ok: false,
      error: {
        status: 400,
        message:
          'Au moins une modification est requise : nouveau plan et/ou nouveau montant payé.',
      },
    };
  }

  return {
    ok: true,
    hasPlanChange,
    hasPaidChange,
    requestedPlanId: planId,
    requestedPaidAmount,
  };
}

export function assertPaidAmountIsDifferent(
  currentPaidAmount: number | null,
  requestedPaidAmount: number,
): HttpBusinessError | null {
  if (currentPaidAmount === requestedPaidAmount) {
    return {
      status: 409,
      message: 'Le montant payé demandé est identique au montant payé actuel.',
    };
  }
  return null;
}

export type PaidAmountSessionUpdate = {
  correctedAmount: number;
  billingStatus: 'CORRECTED';
  correctedAt: Date;
  correctedByUserId: string | null;
  correctionReason: string;
};

/**
 * Builds the session update for a paid-amount change.
 * Never touches expectedAmount or matchedPlanId.
 */
export function buildPaidAmountSessionUpdate(input: {
  requestedPaidAmount: number;
  actorUserId: string | null;
  reason: string;
  correctedAt?: Date;
}): PaidAmountSessionUpdate {
  return {
    correctedAmount: input.requestedPaidAmount,
    billingStatus: 'CORRECTED',
    correctedAt: input.correctedAt ?? new Date(),
    correctedByUserId: input.actorUserId,
    correctionReason: input.reason,
  };
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
  /** Manual assignment always yields a calculated billable session. */
  billingStatus: 'CALCULATED';
  /** Clears pricing anomalies (e.g. TOO_SHORT) when a plan is explicitly assigned. */
  anomalyType: null;
};

/**
 * Builds the session update payload for a plan change.
 * Only plan-dependent business fields are returned.
 * Sessions without a prior plan (TOO_SHORT / PENDING) are supported.
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
    billingStatus: 'CALCULATED',
    anomalyType: null,
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
      hadNoPlan: session.matchedPlanId == null,
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
