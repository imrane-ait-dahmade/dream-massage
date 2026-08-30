/**
 * Central hook: sync physical till after session financial target changes.
 * paidTarget = correctedAmount ?? expectedAmount
 */
import type { Prisma } from '@prisma/client';
import { cashService, resolveSessionCashContext, resolveSessionPaidTarget } from './cash.service';

export type SessionCashFinancialSnapshot = {
  sessionId: string;
  previousCorrectedAmount: number | null;
  previousExpectedAmount: number | null;
  newCorrectedAmount: number | null;
  newExpectedAmount: number | null;
  sessionFinancialAt: Date | null;
  reason?: string | null;
  createdById?: string | null;
};

export async function syncSessionCashLedgerInTx(
  tx: Prisma.TransactionClient,
  snap: SessionCashFinancialSnapshot,
): Promise<void> {
  const previousTargetPaid = resolveSessionPaidTarget(
    snap.previousCorrectedAmount,
    snap.previousExpectedAmount,
  );
  const targetPaid = resolveSessionPaidTarget(
    snap.newCorrectedAmount,
    snap.newExpectedAmount,
  );

  // No cash impact when target is zero and was zero.
  if (targetPaid === 0 && previousTargetPaid === 0) return;

  const { staffMemberId, cashAccountId } = await resolveSessionCashContext(snap.sessionId, tx);

  await cashService.syncSessionPaidAmount(
    {
      sessionId: snap.sessionId,
      staffMemberId,
      cashAccountId,
      previousTargetPaid,
      targetPaid,
      sessionFinancialAt: snap.sessionFinancialAt,
      reason: snap.reason ?? null,
      createdById: snap.createdById ?? null,
    },
    tx,
  );
}
