/**
 * Central hook: sync shift prime deductions to physical till after prime-affecting writes.
 * Prime source of truth: PrimeCalculationService.calculateShiftPrimeSummary.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import { cashService } from './cash.service';

export async function syncShiftPrimeToCash(shiftId: string | null | undefined): Promise<void> {
  if (!shiftId?.trim()) return;
  try {
    await cashService.syncShiftPrimeDeduction(shiftId);
  } catch (err) {
    const status = err instanceof Error ? (err as { status?: number }).status : undefined;
    if (status === 422) throw err;
    logger.warn(`[cash] syncShiftPrimeToCash failed for shift ${shiftId}: ${String(err)}`);
  }
}

export async function syncShiftPrimeToCashInTx(
  tx: Prisma.TransactionClient,
  shiftId: string | null | undefined,
): Promise<void> {
  if (!shiftId?.trim()) return;
  await cashService.syncShiftPrimeDeduction(shiftId, tx);
}

export async function syncShiftPrimeForSessionAfterCommit(sessionId: string): Promise<void> {
  const session = await prisma.chairSession.findUnique({
    where: { id: sessionId },
    select: { shiftId: true },
  });
  await syncShiftPrimeToCash(session?.shiftId);
}
