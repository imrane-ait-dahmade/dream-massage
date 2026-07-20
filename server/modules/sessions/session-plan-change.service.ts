import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import type { AuthUser } from '../auth/auth.service';
import { dashboardService } from '../dashboard/dashboard.service';
import { homeDashboardService } from '../dashboard/home-dashboard.service';
import {
  assertNoPendingRequest,
  assertPlanEligibleForAssignment,
  assertPlanIsDifferent,
  assertRequestNotStale,
  assertRequestStillPending,
  assertSessionEligibleForPlanChange,
  buildPlanChangeSessionUpdate,
  computeFinalAmount,
  computeRemainingAmount,
  validateOptionalReviewNote,
  validateReason,
  type PlanChangePlanSnapshot,
  type PlanChangeSessionSnapshot,
} from './session-plan-change.logic';

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function mapSessionSnapshot(s: {
  id: string;
  status: string;
  archivedAt: Date | null;
  matchedPlanId: string | null;
  expectedAmount: Prisma.Decimal | number | null;
  correctedAmount: Prisma.Decimal | number | null;
  durationSeconds: number | null;
  updatedAt: Date;
  startedAt: Date;
  endedAt: Date | null;
  minPowerWatts: number | null;
  maxPowerWatts: number | null;
  avgPowerWatts: number | null;
  chairId: string;
  shiftId: string | null;
}): PlanChangeSessionSnapshot {
  return {
    id: s.id,
    status: s.status,
    archivedAt: s.archivedAt,
    matchedPlanId: s.matchedPlanId,
    expectedAmount: toNum(s.expectedAmount),
    correctedAmount: toNum(s.correctedAmount),
    durationSeconds: s.durationSeconds,
    updatedAt: s.updatedAt,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    minPowerWatts: s.minPowerWatts,
    maxPowerWatts: s.maxPowerWatts,
    avgPowerWatts: s.avgPowerWatts,
    chairId: s.chairId,
    shiftId: s.shiftId,
  };
}

function mapPlanSnapshot(p: {
  id: string;
  name: string;
  durationSeconds: number;
  priceAmount: Prisma.Decimal | number;
  isActive: boolean;
  archivedAt: Date | null;
}): PlanChangePlanSnapshot {
  return {
    id: p.id,
    name: p.name,
    durationSeconds: p.durationSeconds,
    priceAmount: Number(p.priceAmount),
    isActive: p.isActive,
    archivedAt: p.archivedAt,
  };
}

const SESSION_DETAIL_INCLUDE = {
  chair: { select: { name: true, displayName: true } },
  matchedPlan: { select: { id: true, name: true, durationSeconds: true, priceAmount: true } },
  shift: {
    select: {
      id: true,
      status: true,
      staffMemberId: true,
      staffMember: { select: { id: true, name: true } },
    },
  },
} as const;

type FetchedSession = Prisma.ChairSessionGetPayload<{ include: typeof SESSION_DETAIL_INCLUDE }>;

function mapSessionResponse(s: FetchedSession) {
  const expectedAmount = toNum(s.expectedAmount);
  const correctedAmount = toNum(s.correctedAmount);
  return {
    id: s.id,
    chairId: s.chairId,
    chairName: s.chair.name,
    chairDisplayName: s.chair.displayName,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    durationSeconds: s.durationSeconds,
    matchedPlanId: s.matchedPlanId,
    matchedPlanName: s.matchedPlan?.name ?? null,
    expectedAmount,
    correctedAmount,
    finalAmount: computeFinalAmount(expectedAmount, correctedAmount),
    /** No Payment model: when correctedAmount is set it is treated as recorded collection. */
    remainingAmount: computeRemainingAmount(expectedAmount, correctedAmount),
    billingStatus: s.billingStatus,
    anomalyType: s.anomalyType,
    correctionReason: s.correctionReason,
    correctedAt: s.correctedAt?.toISOString() ?? null,
    notes: s.notes,
    shiftId: s.shiftId,
    minPowerWatts: s.minPowerWatts,
    maxPowerWatts: s.maxPowerWatts,
    avgPowerWatts: s.avgPowerWatts,
  };
}

const REQUEST_INCLUDE = {
  requestedBy: { select: { id: true, name: true, email: true, role: true } },
  reviewedBy: { select: { id: true, name: true, email: true, role: true } },
  session: {
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      matchedPlanId: true,
      expectedAmount: true,
      correctedAmount: true,
      chairId: true,
      chair: { select: { name: true, displayName: true } },
      shift: {
        select: {
          id: true,
          staffMemberId: true,
          staffMember: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

type FetchedRequest = Prisma.SessionPlanChangeRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

function mapRequestResponse(r: FetchedRequest) {
  const expected = toNum(r.session.expectedAmount);
  const corrected = toNum(r.session.correctedAmount);
  return {
    id: r.id,
    status: r.status,
    reason: r.reason,
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    originalPlanId: r.originalPlanId,
    originalPlanName: r.originalPlanName,
    originalDurationSeconds: r.originalDurationSeconds,
    originalDurationMinutes:
      r.originalDurationSeconds != null ? Math.round(r.originalDurationSeconds / 60) : null,
    originalExpectedAmount: toNum(r.originalExpectedAmount),
    requestedPlanId: r.requestedPlanId,
    requestedPlanName: r.requestedPlanName,
    requestedDurationSeconds: r.requestedDurationSeconds,
    requestedDurationMinutes: Math.round(r.requestedDurationSeconds / 60),
    requestedExpectedAmount: toNum(r.requestedExpectedAmount),
    requestedBy: r.requestedBy
      ? {
          id: r.requestedBy.id,
          name: r.requestedBy.name,
          email: r.requestedBy.email,
          role: r.requestedBy.role,
        }
      : null,
    reviewedBy: r.reviewedBy
      ? {
          id: r.reviewedBy.id,
          name: r.reviewedBy.name,
          email: r.reviewedBy.email,
          role: r.reviewedBy.role,
        }
      : null,
    session: {
      id: r.session.id,
      status: r.session.status,
      startedAt: r.session.startedAt.toISOString(),
      endedAt: r.session.endedAt?.toISOString() ?? null,
      durationSeconds: r.session.durationSeconds,
      matchedPlanId: r.session.matchedPlanId,
      expectedAmount: expected,
      correctedAmount: corrected,
      finalAmount: computeFinalAmount(expected, corrected),
      remainingAmount: computeRemainingAmount(expected, corrected),
      chairId: r.session.chairId,
      chairName: r.session.chair.name,
      chairDisplayName: r.session.chair.displayName,
      staffMember: r.session.shift?.staffMember
        ? { id: r.session.shift.staffMember.id, name: r.session.shift.staffMember.name }
        : null,
    },
  };
}

function invalidateDashboards(): void {
  try {
    dashboardService.invalidateCache();
    homeDashboardService.invalidateCache();
  } catch (err) {
    logger.warn('[session-plan-change] cache invalidation failed:', String(err));
  }
}

type TxClient = Prisma.TransactionClient;

async function loadActivePlan(tx: TxClient | typeof prisma, planId: string) {
  return tx.pricingPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      name: true,
      durationSeconds: true,
      priceAmount: true,
      isActive: true,
      archivedAt: true,
    },
  });
}

/**
 * Centralized application of a plan change onto a ChairSession.
 * Updates only plan-dependent business fields. Never touches technical measurements.
 */
async function applySessionPlanChangeInTx(
  tx: TxClient,
  params: {
    sessionId: string;
    newPlanId: string;
    actorUserId: string | null;
    reason: string | null;
    source: 'OWNER_DIRECT' | 'REQUEST_APPROVED';
    requestId?: string | null;
  },
): Promise<FetchedSession> {
  const session = await tx.chairSession.findUnique({ where: { id: params.sessionId } });
  const sessionSnap = session ? mapSessionSnapshot(session) : null;
  const eligibility = assertSessionEligibleForPlanChange(sessionSnap);
  if (eligibility) throw httpError(eligibility.status, eligibility.message);

  const planRow = await loadActivePlan(tx, params.newPlanId);
  const planSnap = planRow ? mapPlanSnapshot(planRow) : null;
  const planErr = assertPlanEligibleForAssignment(planSnap);
  if (planErr) throw httpError(planErr.status, planErr.message);

  const sameErr = assertPlanIsDifferent(sessionSnap!.matchedPlanId, planSnap!.id);
  if (sameErr) throw httpError(sameErr.status, sameErr.message);

  const previousSnapshot =
    session!.pricingSnapshot && typeof session!.pricingSnapshot === 'object'
      ? (session!.pricingSnapshot as Record<string, unknown>)
      : null;

  const update = buildPlanChangeSessionUpdate({
    session: sessionSnap!,
    newPlan: planSnap!,
    previousPricingSnapshot: previousSnapshot,
    actorUserId: params.actorUserId,
    reason: params.reason,
    source: params.source,
    requestId: params.requestId ?? null,
  });

  const updated = await tx.chairSession.update({
    where: { id: params.sessionId },
    data: {
      matchedPlanId: update.matchedPlanId,
      expectedAmount: update.expectedAmount,
      pricingSnapshot: update.pricingSnapshot as Prisma.InputJsonValue,
      // correctedAmount intentionally untouched (recorded collection / correction preserved)
    },
    include: SESSION_DETAIL_INCLUDE,
  });

  await tx.chairEvent.create({
    data: {
      chairId: session!.chairId,
      sessionId: params.sessionId,
      eventType: 'SESSION_PLAN_CHANGED',
      metadata: {
        source: params.source,
        requestId: params.requestId ?? null,
        reason: params.reason,
        userId: params.actorUserId,
        oldMatchedPlanId: sessionSnap!.matchedPlanId,
        newMatchedPlanId: planSnap!.id,
        oldExpectedAmount: sessionSnap!.expectedAmount,
        newExpectedAmount: planSnap!.priceAmount,
        correctedAmountUnchanged: sessionSnap!.correctedAmount,
        remainingAmount: computeRemainingAmount(planSnap!.priceAmount, sessionSnap!.correctedAmount),
        technicalPreserved: {
          startedAt: sessionSnap!.startedAt.toISOString(),
          endedAt: sessionSnap!.endedAt?.toISOString() ?? null,
          durationSeconds: sessionSnap!.durationSeconds,
          minPowerWatts: sessionSnap!.minPowerWatts,
          maxPowerWatts: sessionSnap!.maxPowerWatts,
          avgPowerWatts: sessionSnap!.avgPowerWatts,
          chairId: sessionSnap!.chairId,
          shiftId: sessionSnap!.shiftId,
        },
      },
    },
  });

  return updated;
}

export const sessionPlanChangeService = {
  /**
   * OWNER/ADMIN direct plan change. Records an immediately APPROVED audit request.
   */
  async changePlanDirect(
    sessionId: string,
    input: { requestedPlanId: string; reason?: string },
    actor: AuthUser,
  ) {
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw httpError(403, 'Forbidden');
    }

    const reasonResult = input.reason
      ? validateReason(input.reason, 'reason')
      : { ok: true as const, value: 'Modification directe par le propriétaire' };
    if (!reasonResult.ok) throw httpError(reasonResult.error.status, reasonResult.error.message);

    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.chairSession.findUnique({
        where: { id: sessionId },
        include: { matchedPlan: { select: { id: true, name: true, durationSeconds: true } } },
      });
      const sessionSnap = session ? mapSessionSnapshot(session) : null;
      const eligibility = assertSessionEligibleForPlanChange(sessionSnap);
      if (eligibility) throw httpError(eligibility.status, eligibility.message);

      const pending = await tx.sessionPlanChangeRequest.findFirst({
        where: { sessionId, status: 'PENDING' },
        select: { id: true, status: true },
      });
      const pendingErr = assertNoPendingRequest(pending);
      if (pendingErr) throw httpError(pendingErr.status, pendingErr.message);

      const planRow = await loadActivePlan(tx, input.requestedPlanId);
      const planSnap = planRow ? mapPlanSnapshot(planRow) : null;
      const planErr = assertPlanEligibleForAssignment(planSnap);
      if (planErr) throw httpError(planErr.status, planErr.message);

      const sameErr = assertPlanIsDifferent(sessionSnap!.matchedPlanId, planSnap!.id);
      if (sameErr) throw httpError(sameErr.status, sameErr.message);

      const now = new Date();
      const auditRequest = await tx.sessionPlanChangeRequest.create({
        data: {
          sessionId,
          requestedByUserId: actor.id,
          reviewedByUserId: actor.id,
          originalPlanId: sessionSnap!.matchedPlanId,
          requestedPlanId: planSnap!.id,
          originalPlanName: session?.matchedPlan?.name ?? null,
          requestedPlanName: planSnap!.name,
          originalDurationSeconds: session?.matchedPlan?.durationSeconds ?? null,
          requestedDurationSeconds: planSnap!.durationSeconds,
          originalExpectedAmount: sessionSnap!.expectedAmount,
          requestedExpectedAmount: planSnap!.priceAmount,
          reason: reasonResult.value,
          status: 'APPROVED',
          reviewedAt: now,
          reviewNote: null,
          sessionMatchedPlanIdAtRequest: sessionSnap!.matchedPlanId,
          sessionUpdatedAtAtRequest: sessionSnap!.updatedAt,
        },
      });

      const updatedSession = await applySessionPlanChangeInTx(tx, {
        sessionId,
        newPlanId: planSnap!.id,
        actorUserId: actor.id,
        reason: reasonResult.value,
        source: 'OWNER_DIRECT',
        requestId: auditRequest.id,
      });

      const fullRequest = await tx.sessionPlanChangeRequest.findUniqueOrThrow({
        where: { id: auditRequest.id },
        include: REQUEST_INCLUDE,
      });

      return { session: updatedSession, request: fullRequest };
    });

    invalidateDashboards();
    return {
      session: mapSessionResponse(result.session),
      request: mapRequestResponse(result.request),
    };
  },

  /**
   * ASSISTANT creates a PENDING request. Session is not modified.
   */
  async createRequest(
    sessionId: string,
    input: { requestedPlanId: string; reason: string },
    actor: AuthUser,
  ) {
    if (actor.role !== 'ASSISTANT') {
      throw httpError(403, 'Seuls les assistants peuvent créer une demande de modification de plan.');
    }
    if (!actor.staffMemberId) {
      throw httpError(403, 'Forbidden');
    }

    const reasonResult = validateReason(input.reason, 'reason');
    if (!reasonResult.ok) throw httpError(reasonResult.error.status, reasonResult.error.message);

    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.chairSession.findUnique({
        where: { id: sessionId },
        include: {
          matchedPlan: { select: { id: true, name: true, durationSeconds: true } },
          shift: { select: { staffMemberId: true } },
        },
      });
      const sessionSnap = session ? mapSessionSnapshot(session) : null;
      const eligibility = assertSessionEligibleForPlanChange(sessionSnap);
      if (eligibility) throw httpError(eligibility.status, eligibility.message);

      if (!session!.shift || session!.shift.staffMemberId !== actor.staffMemberId) {
        throw httpError(403, 'Vous ne pouvez demander une modification que pour vos propres sessions.');
      }

      const pending = await tx.sessionPlanChangeRequest.findFirst({
        where: { sessionId, status: 'PENDING' },
        select: { id: true, status: true },
      });
      const pendingErr = assertNoPendingRequest(pending);
      if (pendingErr) throw httpError(pendingErr.status, pendingErr.message);

      const planRow = await loadActivePlan(tx, input.requestedPlanId);
      const planSnap = planRow ? mapPlanSnapshot(planRow) : null;
      const planErr = assertPlanEligibleForAssignment(planSnap);
      if (planErr) throw httpError(planErr.status, planErr.message);

      const sameErr = assertPlanIsDifferent(sessionSnap!.matchedPlanId, planSnap!.id);
      if (sameErr) throw httpError(sameErr.status, sameErr.message);

      try {
        return await tx.sessionPlanChangeRequest.create({
          data: {
            sessionId,
            requestedByUserId: actor.id,
            originalPlanId: sessionSnap!.matchedPlanId,
            requestedPlanId: planSnap!.id,
            originalPlanName: session?.matchedPlan?.name ?? null,
            requestedPlanName: planSnap!.name,
            originalDurationSeconds: session?.matchedPlan?.durationSeconds ?? null,
            requestedDurationSeconds: planSnap!.durationSeconds,
            originalExpectedAmount: sessionSnap!.expectedAmount,
            requestedExpectedAmount: planSnap!.priceAmount,
            reason: reasonResult.value,
            status: 'PENDING',
            sessionMatchedPlanIdAtRequest: sessionSnap!.matchedPlanId,
            sessionUpdatedAtAtRequest: sessionSnap!.updatedAt,
          },
          include: REQUEST_INCLUDE,
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw httpError(
            409,
            'Une demande de modification de plan est déjà en attente pour cette session.',
          );
        }
        throw err;
      }
    });

    return mapRequestResponse(created);
  },

  async listRequests(filters: {
    status?: 'PENDING' | 'APPROVED' | 'REJECTED';
    sessionId?: string;
    requestedByUserId?: string;
    limit?: number;
  }) {
    const take = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const rows = await prisma.sessionPlanChangeRequest.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.sessionId ? { sessionId: filters.sessionId } : {}),
        ...(filters.requestedByUserId ? { requestedByUserId: filters.requestedByUserId } : {}),
      },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map(mapRequestResponse);
  },

  async getRequestById(requestId: string) {
    const row = await prisma.sessionPlanChangeRequest.findUnique({
      where: { id: requestId },
      include: REQUEST_INCLUDE,
    });
    if (!row) return null;
    return mapRequestResponse(row);
  },

  /**
   * OWNER approves a PENDING request atomically with conditional claim.
   */
  async approveRequest(
    requestId: string,
    input: { reviewNote?: string },
    actor: AuthUser,
  ) {
    if (actor.role !== 'OWNER') {
      throw httpError(403, 'Forbidden — OWNER role required');
    }

    const noteResult = validateOptionalReviewNote(input.reviewNote);
    if (!noteResult.ok) throw httpError(noteResult.error.status, noteResult.error.message);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.sessionPlanChangeRequest.findUnique({
        where: { id: requestId },
      });
      if (!existing) throw httpError(404, 'Demande introuvable');

      const pendingErr = assertRequestStillPending(existing.status);
      if (pendingErr) throw httpError(pendingErr.status, pendingErr.message);

      if (!existing.requestedPlanId) {
        throw httpError(409, 'Cette demande ne référence plus de plan valide.');
      }

      const session = await tx.chairSession.findUnique({ where: { id: existing.sessionId } });
      const sessionSnap = session ? mapSessionSnapshot(session) : null;
      const eligibility = assertSessionEligibleForPlanChange(sessionSnap);
      if (eligibility) throw httpError(eligibility.status, eligibility.message);

      const staleErr = assertRequestNotStale({
        requestStatus: existing.status,
        sessionMatchedPlanIdAtRequest: existing.sessionMatchedPlanIdAtRequest,
        sessionUpdatedAtAtRequest: existing.sessionUpdatedAtAtRequest,
        currentMatchedPlanId: sessionSnap!.matchedPlanId,
        currentUpdatedAt: sessionSnap!.updatedAt,
        requestedPlanId: existing.requestedPlanId,
      });
      if (staleErr) throw httpError(staleErr.status, staleErr.message);

      // Conditional claim — prevents double approval under concurrency
      const claimed = await tx.sessionPlanChangeRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          reviewedByUserId: actor.id,
          reviewedAt: new Date(),
          reviewNote: noteResult.value,
        },
      });
      if (claimed.count !== 1) {
        throw httpError(409, 'Cette demande a déjà été traitée.');
      }

      const updatedSession = await applySessionPlanChangeInTx(tx, {
        sessionId: existing.sessionId,
        newPlanId: existing.requestedPlanId,
        actorUserId: actor.id,
        reason: existing.reason,
        source: 'REQUEST_APPROVED',
        requestId,
      });

      const fullRequest = await tx.sessionPlanChangeRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: REQUEST_INCLUDE,
      });

      return { session: updatedSession, request: fullRequest };
    });

    invalidateDashboards();
    return {
      session: mapSessionResponse(result.session),
      request: mapRequestResponse(result.request),
    };
  },

  /**
   * OWNER rejects a PENDING request. Session is not modified.
   */
  async rejectRequest(
    requestId: string,
    input: { reviewNote?: string },
    actor: AuthUser,
  ) {
    if (actor.role !== 'OWNER') {
      throw httpError(403, 'Forbidden — OWNER role required');
    }

    const noteResult = validateOptionalReviewNote(input.reviewNote);
    if (!noteResult.ok) throw httpError(noteResult.error.status, noteResult.error.message);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.sessionPlanChangeRequest.findUnique({
        where: { id: requestId },
        include: REQUEST_INCLUDE,
      });
      if (!existing) throw httpError(404, 'Demande introuvable');

      const pendingErr = assertRequestStillPending(existing.status);
      if (pendingErr) throw httpError(pendingErr.status, pendingErr.message);

      const claimed = await tx.sessionPlanChangeRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          reviewedByUserId: actor.id,
          reviewedAt: new Date(),
          reviewNote: noteResult.value,
        },
      });
      if (claimed.count !== 1) {
        throw httpError(409, 'Cette demande a déjà été traitée.');
      }

      return tx.sessionPlanChangeRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: REQUEST_INCLUDE,
      });
    });

    return mapRequestResponse(result);
  },
};
