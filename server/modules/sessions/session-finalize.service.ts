/**
 * Shared session completion — pricing, cash sync, chair reset.
 * Used by state machine end + stale recovery.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import { pricingService } from '../pricing/pricing.service';
import { syncSessionCashLedgerInTx } from '../cash/session-cash-sync';
import { syncShiftPrimeForSessionAfterCommit } from '../cash/shift-cash-sync';

function mergeAnomalyTypes(existing: string | null, added: string | null): string | null {
  if (!existing && !added) return null;
  if (!existing) return added;
  if (!added) return existing;
  const parts = existing.split(',');
  for (const part of added.split(',')) {
    if (!parts.includes(part)) parts.push(part);
  }
  return parts.join(',');
}

export type FinalizeSessionInput = {
  sessionId: string;
  chairId: string;
  chairName?: string;
  startedAt: Date;
  endedAt: Date;
  confirmedEndAt?: Date;
  lowPowerDetectedAt?: Date | null;
  endPowerWatts: number;
  minPowerWatts?: number | null;
  maxPowerWatts?: number | null;
  avgPowerWatts?: number | null;
  existingAnomalyType?: string | null;
  recoveryReason?: string | null;
  skipCashSync?: boolean;
};

export type FinalizeSessionResult = {
  durationSeconds: number;
  expectedAmount: number | null;
  billingStatus: string;
  anomalyType: string | null;
};

export async function finalizeActiveSession(
  input: FinalizeSessionInput,
): Promise<FinalizeSessionResult> {
  const endedAt = input.endedAt;
  const confirmedEndAt = input.confirmedEndAt ?? endedAt;
  const lowPowerAt = input.lowPowerDetectedAt ?? endedAt;

  const durationSeconds = Math.max(
    0,
    Math.floor((endedAt.getTime() - input.startedAt.getTime()) / 1000),
  );

  const pricing = await pricingService.calculateSessionPrice(durationSeconds);
  let mergedAnomaly = mergeAnomalyTypes(input.existingAnomalyType ?? null, pricing.anomalyType);
  if (input.recoveryReason) {
    mergedAnomaly = mergeAnomalyTypes(mergedAnomaly, 'STALE_RECOVERY');
  }

  const avg =
    input.avgPowerWatts ??
    (input.minPowerWatts != null && input.maxPowerWatts != null
      ? Math.round(((input.minPowerWatts + input.maxPowerWatts) / 2) * 100) / 100
      : input.endPowerWatts);

  await prisma.$transaction(async (tx) => {
    await tx.chairSession.update({
      where: { id: input.sessionId },
      data: {
        status: 'COMPLETED',
        billingStatus: pricing.billingStatus,
        anomalyType: mergedAnomaly,
        lowPowerDetectedAt: lowPowerAt,
        confirmedEndAt,
        endedAt,
        durationSeconds,
        endPowerWatts: input.endPowerWatts,
        minPowerWatts: input.minPowerWatts,
        maxPowerWatts: input.maxPowerWatts,
        avgPowerWatts: avg,
        matchedPlanId: pricing.matchedPlanId,
        expectedAmount: pricing.expectedAmount,
        pricingSnapshot: pricing.pricingSnapshot as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.chair.update({
      where: { id: input.chairId },
      data: {
        status: 'IDLE',
        currentSessionId: null,
        maybeFinishedSince: null,
        maybeActiveSince: null,
        stateChangedAt: confirmedEndAt,
        currentPowerWatts: input.endPowerWatts,
        isOnline: true,
        lastSyncedAt: confirmedEndAt,
      },
      select: { id: true },
    });
    await tx.chairEvent.create({
      data: {
        chairId: input.chairId,
        sessionId: input.sessionId,
        eventType: 'END_CONFIRMED',
        fromStatus: 'MAYBE_FINISHED',
        toStatus: 'IDLE',
        powerWatts: input.endPowerWatts,
        message: input.recoveryReason ?? null,
        createdAt: confirmedEndAt,
      },
      select: { id: true },
    });
    await tx.chairEvent.create({
      data: {
        chairId: input.chairId,
        sessionId: input.sessionId,
        eventType: 'SESSION_FINISHED',
        toStatus: 'IDLE',
        message:
          `${durationSeconds}s → ${pricing.expectedAmount} MAD` +
          (mergedAnomaly ? ` [${mergedAnomaly}]` : '') +
          (input.recoveryReason ? ` (${input.recoveryReason})` : ''),
        createdAt: confirmedEndAt,
      },
      select: { id: true },
    });

    if (!input.skipCashSync && pricing.expectedAmount != null) {
      await syncSessionCashLedgerInTx(tx, {
        sessionId: input.sessionId,
        previousCorrectedAmount: null,
        previousExpectedAmount: null,
        newCorrectedAmount: null,
        newExpectedAmount: pricing.expectedAmount,
        sessionFinancialAt: endedAt,
        reason: input.recoveryReason ?? null,
      });
    }
  });

  if (!input.skipCashSync) {
    await syncShiftPrimeForSessionAfterCommit(input.sessionId);
  }

  const label = input.chairName ?? input.chairId.slice(-8);
  logger.info(
    `[session-finalize] ${label}: session ${input.sessionId.slice(-8)} FINISHED ` +
      `(${durationSeconds}s, ${pricing.expectedAmount} MAD, recovery=${input.recoveryReason ?? 'normal'})`,
  );

  return {
    durationSeconds,
    expectedAmount: pricing.expectedAmount,
    billingStatus: pricing.billingStatus,
    anomalyType: mergedAnomaly,
  };
}

/** Mark session for manual review — no pricing/cash side effects. */
export async function markSessionNeedsReview(
  sessionId: string,
  chairId: string,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await tx.chairSession.findUnique({
      where: { id: sessionId },
      select: { anomalyType: true },
    });
    const anomaly = mergeAnomalyTypes(session?.anomalyType ?? null, 'STALE_NEEDS_REVIEW');
    await tx.chairSession.update({
      where: { id: sessionId },
      data: {
        status: 'UNCERTAIN',
        billingStatus: 'DISPUTED',
        anomalyType: anomaly,
        notes: reason,
      },
      select: { id: true },
    });
    await tx.chair.update({
      where: { id: chairId },
      data: {
        status: 'IDLE',
        currentSessionId: null,
        maybeFinishedSince: null,
        maybeActiveSince: null,
      },
      select: { id: true },
    });
  });
  logger.warn(`[session-finalize] session ${sessionId.slice(-8)} marked UNCERTAIN: ${reason}`);
}
