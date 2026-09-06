/**
 * CashService — sole engine for physical cash register balances (Caisse 1 / 2).
 * Controllers must never mutate current_balance directly.
 *
 * Balance is owned by CashAccount (cashAccountId). staffMemberId on movements
 * is attribution / audit only.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { getBusinessDate, getDayBoundsUtc, getTimezone } from '../../utils/time';
import {
  applySignedAmount,
  assertPositiveAmount,
  assertSessionCashCreditContext,
  assertWithdrawAmount,
  computeDayStats,
  movementLabel,
  netPrimeDeductedFromMovements,
  NO_CASH_FOR_STAFF_MSG,
  planAdjustment,
  planInitialBalance,
  planReversal,
  planSessionPaidSync,
  planShiftPrimeSync,
  planStaffAssignment,
  resolveSessionPaidTarget,
  shouldAllowSessionCashCredit,
  shouldAllowShiftPrimeDeduction,
  assertNewSessionCashCreditAllowed,
  normalizeReason,
  round2,
  SESSION_REF_TYPE,
  SHIFT_PRIME_REF_TYPE,
  type CashMovementType,
} from './cash.logic';
import { primeCalculationService } from '../prime/prime-calculation.service';
import { resolveHistoricalSessionCashTarget } from '../sessions/cross-shift-session.logic';

export const PHYSICAL_CASH_CODES = ['CASH_1', 'CASH_2'] as const;
export type PhysicalCashCode = (typeof PHYSICAL_CASH_CODES)[number];

const PHYSICAL_SEED: Array<{ code: PhysicalCashCode; name: string }> = [
  { code: 'CASH_1', name: 'Caisse 1' },
  { code: 'CASH_2', name: 'Caisse 2' },
];

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** Quantize Prisma Decimal / number / string to 2dp via Decimal arithmetic. */
function money(v: Prisma.Decimal | number | string): Prisma.Decimal {
  return new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function toNum(v: Prisma.Decimal | number | string): number {
  return Number(money(v).toFixed(2));
}

async function lockAccount(tx: Prisma.TransactionClient, accountId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM cash_accounts WHERE id = ${accountId} FOR UPDATE
  `;
}

async function requireCashAccount(
  tx: Prisma.TransactionClient,
  cashAccountId: string,
): Promise<{
  id: string;
  code: string;
  name: string;
  currentBalance: Prisma.Decimal;
  isActive: boolean;
  staffMemberId: string | null;
}> {
  if (!cashAccountId?.trim()) throw httpError(400, 'cashAccountId est obligatoire.');
  const account = await tx.cashAccount.findUnique({ where: { id: cashAccountId } });
  if (!account) throw httpError(404, 'Caisse introuvable');
  return account;
}

async function findActiveTillForStaff(
  tx: Prisma.TransactionClient,
  staffMemberId: string,
): Promise<{ id: string; code: string; name: string } | null> {
  return tx.cashAccount.findFirst({
    where: {
      staffMemberId,
      isActive: true,
      code: { in: [...PHYSICAL_CASH_CODES] },
    },
    select: { id: true, code: true, name: true },
  });
}

async function getGlobalCashTrackingStartedAt(
  tx: Prisma.TransactionClient,
): Promise<Date | null> {
  const rows = await tx.cashAccount.findMany({
    where: { code: { in: [...PHYSICAL_CASH_CODES] }, cashTrackingStartedAt: { not: null } },
    select: { cashTrackingStartedAt: true },
    orderBy: { cashTrackingStartedAt: 'asc' },
    take: 1,
  });
  return rows[0]?.cashTrackingStartedAt ?? null;
}

async function optionalStaff(tx: Prisma.TransactionClient, staffMemberId: string | null | undefined) {
  if (!staffMemberId?.trim()) return null;
  const staff = await tx.staffMember.findUnique({
    where: { id: staffMemberId },
    select: { id: true },
  });
  if (!staff) throw httpError(404, 'Staff introuvable');
  return staff.id;
}

async function postMovementInTx(
  tx: Prisma.TransactionClient,
  input: {
    cashAccountId: string;
    staffMemberId?: string | null;
    type: CashMovementType;
    amount: Prisma.Decimal | number | string;
    referenceType?: string | null;
    referenceId?: string | null;
    reason?: string | null;
    createdById?: string | null;
  },
) {
  await requireCashAccount(tx, input.cashAccountId);
  await lockAccount(tx, input.cashAccountId);

  const fresh = await tx.cashAccount.findUniqueOrThrow({ where: { id: input.cashAccountId } });
  const amount = money(input.amount);
  const before = money(fresh.currentBalance);
  const after = money(before.add(amount));

  if (input.type === 'WITHDRAWAL') {
    assertWithdrawAmount(toNum(before), Math.abs(toNum(amount)));
  }

  const movement = await tx.cashMovement.create({
    data: {
      cashAccountId: input.cashAccountId,
      staffMemberId: input.staffMemberId ?? null,
      type: input.type,
      amount,
      balanceBefore: before,
      balanceAfter: after,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      reason: input.reason ?? null,
      createdById: input.createdById ?? null,
    },
  });

  await tx.cashAccount.update({
    where: { id: input.cashAccountId },
    data: { currentBalance: after },
  });

  return {
    movement,
    balanceBefore: toNum(before),
    balanceAfter: toNum(after),
    amount: toNum(amount),
  };
}

function mapMovement(m: {
  id: string;
  cashAccountId: string;
  staffMemberId: string | null;
  type: CashMovementType;
  amount: Prisma.Decimal | number;
  balanceBefore: Prisma.Decimal | number;
  balanceAfter: Prisma.Decimal | number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
  createdBy?: { id: string; name: string } | null;
  staffMember?: { id: string; name: string } | null;
}) {
  const type = m.type as CashMovementType;
  return {
    id: m.id,
    cashAccountId: m.cashAccountId,
    staffMemberId: m.staffMemberId,
    staffMemberName: m.staffMember?.name ?? null,
    type,
    label: movementLabel(type),
    amount: toNum(m.amount),
    balanceBefore: toNum(m.balanceBefore),
    balanceAfter: toNum(m.balanceAfter),
    referenceType: m.referenceType,
    referenceId: m.referenceId,
    reason: m.reason,
    createdById: m.createdById,
    createdByName: m.createdBy?.name ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export type CreditInput = {
  cashAccountId: string;
  staffMemberId?: string | null;
  amount: number;
  type?: Extract<
    CashMovementType,
    'SESSION_PAYMENT' | 'MANUAL_INCOME' | 'INITIAL_BALANCE'
  >;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  createdById?: string | null;
};

/** Admin HTTP credit — always MANUAL_INCOME, never system refs. */
export type ManualIncomeInput = {
  cashAccountId: string;
  staffMemberId?: string | null;
  amount: number;
  reason?: string | null;
  createdById: string;
};

export const cashService = {
  /** Idempotent seed of physical tills CASH_1 / CASH_2. Does not create per-staff accounts. */
  async ensurePhysicalAccounts() {
    for (const seed of PHYSICAL_SEED) {
      await prisma.cashAccount.upsert({
        where: { code: seed.code },
        create: {
          code: seed.code,
          name: seed.name,
          currentBalance: new Prisma.Decimal(0),
          isActive: true,
        },
        update: {
          name: seed.name,
          isActive: true,
        },
      });
    }
    return prisma.cashAccount.findMany({
      where: { code: { in: [...PHYSICAL_CASH_CODES] } },
      orderBy: { code: 'asc' },
    });
  },

  async getAccountByCode(code: PhysicalCashCode | string) {
    if (!code?.trim()) throw httpError(400, 'code est obligatoire.');
    const account = await prisma.cashAccount.findUnique({ where: { code: code.trim() } });
    if (!account) throw httpError(404, 'Caisse introuvable');
    return account;
  },

  async getBalance(cashAccountId: string): Promise<number> {
    if (!cashAccountId?.trim()) throw httpError(400, 'cashAccountId est obligatoire.');
    const account = await prisma.cashAccount.findUnique({ where: { id: cashAccountId } });
    return account ? toNum(account.currentBalance) : 0;
  },

  /**
   * Production cutover: set opening balance from physical count.
   * - One INITIAL_BALANCE per account (DB + app)
   * - Account must have zero balance and zero movements
   * - staffMemberId is null (till-level cutover, not staff attribution)
   * - Never backfills historical sessions
   */
  async setInitialBalance(input: {
    cashAccountId: string;
    countedAmount: number;
    reason?: string | null;
    createdById: string;
  }) {
    if (!input.createdById?.trim()) {
      throw httpError(401, 'Utilisateur authentifié requis.');
    }

    return prisma.$transaction(async (tx) => {
      const account = await requireCashAccount(tx, input.cashAccountId);
      await lockAccount(tx, account.id);

      const fresh = await tx.cashAccount.findUniqueOrThrow({ where: { id: account.id } });
      const [movementCount, initialRow] = await Promise.all([
        tx.cashMovement.count({ where: { cashAccountId: account.id } }),
        tx.cashMovement.findFirst({
          where: { cashAccountId: account.id, type: 'INITIAL_BALANCE' },
          select: { id: true },
        }),
      ]);

      const plan = planInitialBalance({
        countedAmount: input.countedAmount,
        currentBalance: toNum(fresh.currentBalance),
        movementCount,
        hasInitialBalance: !!initialRow,
      });

      const reason = input.reason?.trim() || 'Cutover caisse production';

      let movement;
      try {
        movement = await tx.cashMovement.create({
          data: {
            cashAccountId: account.id,
            staffMemberId: null,
            type: plan.type,
            amount: money(plan.amount),
            balanceBefore: money(plan.balanceBefore),
            balanceAfter: money(plan.balanceAfter),
            referenceType: null,
            referenceId: null,
            reason,
            createdById: input.createdById,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw httpError(409, 'Cette caisse a déjà un solde initial (INITIAL_BALANCE).');
        }
        throw err;
      }

      await tx.cashAccount.update({
        where: { id: account.id },
        data: {
          currentBalance: money(plan.balanceAfter),
          cashTrackingStartedAt: movement.createdAt,
        },
      });

      await tx.settingsAuditLog.create({
        data: {
          userId: input.createdById,
          entityType: 'CashAccount',
          entityId: account.id,
          action: 'INITIAL_BALANCE',
          newValue: {
            cashAccountId: account.id,
            code: account.code,
            amount: plan.amount,
            reason,
            movementId: movement.id,
          },
        },
      });

      return {
        movement,
        balanceBefore: plan.balanceBefore,
        balanceAfter: plan.balanceAfter,
        amount: plan.amount,
      };
    });
  },

  /**
   * Administrative manual income only (HTTP /credit).
   * Hard-coded type MANUAL_INCOME — no session refs, no system types.
   */
  async creditManualIncome(input: ManualIncomeInput) {
    if (!input.createdById?.trim()) {
      throw httpError(401, 'Utilisateur authentifié requis.');
    }
    const amount = assertPositiveAmount(input.amount);

    return prisma.$transaction(async (tx) => {
      const staffMemberId = await optionalStaff(tx, input.staffMemberId);
      return postMovementInTx(tx, {
        cashAccountId: input.cashAccountId,
        staffMemberId,
        type: 'MANUAL_INCOME',
        amount,
        referenceType: null,
        referenceId: null,
        reason: normalizeReason(input.reason),
        createdById: input.createdById,
      });
    });
  },

  /**
   * @deprecated Prefer creditManualIncome for admin, syncSessionPaidAmount for sessions.
   * Kept for internal/tests; rejects SESSION_PAYMENT / INITIAL_BALANCE / refs.
   */
  async credit(input: CreditInput, externalTx?: Prisma.TransactionClient) {
    if (input.type && input.type !== 'MANUAL_INCOME') {
      throw httpError(
        400,
        'Seuls les crédits MANUAL_INCOME sont autorisés via credit(). Les paiements session passent par syncSessionPaidAmount.',
      );
    }
    if (input.referenceType || input.referenceId) {
      throw httpError(400, 'Les références système ne sont pas autorisées sur credit().');
    }

    const amount = assertPositiveAmount(input.amount);

    const run = async (tx: Prisma.TransactionClient) => {
      const staffMemberId = await optionalStaff(tx, input.staffMemberId);
      const result = await postMovementInTx(tx, {
        cashAccountId: input.cashAccountId,
        staffMemberId,
        type: 'MANUAL_INCOME',
        amount,
        referenceType: null,
        referenceId: null,
        reason: normalizeReason(input.reason),
        createdById: input.createdById ?? null,
      });
      return { ...result, idempotent: false as const };
    };

    if (externalTx) return run(externalTx);
    return prisma.$transaction(run);
  },

  /**
   * Sync ChairSession.correctedAmount (paid) into the physical till ledger.
   * Call only from paid-amount write paths (same DB transaction).
   *
   * - Missing till assignment on first credit → error 422 (rolls back caller TX)
   * - If session already has ledger rows → reuse that cashAccountId (never migrate till)
   * - Idempotent when target already equals ledger net
   * - Legacy paid rows without ledger history are never backfilled
   * - Not exposed over HTTP
   *
   * Write paths that MUST call this (same TX as session update):
   * - chair-state.service session completion (expectedAmount)
   * - sessionService.correctSession (set / clearCorrection)
   * - session-plan-change applyPaidAmountChangeInTx / applySessionPlanChangeInTx
   */
  async syncSessionPaidAmount(
    opts: {
      sessionId: string;
      cashAccountId: string | null | undefined;
      staffMemberId: string | null | undefined;
      previousTargetPaid: number;
      targetPaid: number;
      sessionFinancialAt?: Date | null;
      reason?: string | null;
      createdById?: string | null;
    },
    externalTx?: Prisma.TransactionClient,
  ) {
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.cashMovement.findMany({
        where: {
          referenceType: SESSION_REF_TYPE,
          referenceId: opts.sessionId,
        },
        select: { type: true, amount: true, cashAccountId: true },
      });

      // Sticky till: reassignment of staff on account must not move historical session credits.
      const stickyTill = existing.length > 0 ? existing[0]!.cashAccountId : null;
      const staffMemberId = opts.staffMemberId ?? null;
      let cashTrackingStartedAt: Date | null = null;
      let prospectiveTill = stickyTill;
      if (!prospectiveTill && staffMemberId) {
        const till = await findActiveTillForStaff(tx, staffMemberId);
        prospectiveTill = till?.id ?? null;
      }
      if (!prospectiveTill) {
        prospectiveTill = opts.cashAccountId ?? null;
      }
      if (prospectiveTill) {
        const tillRow = await tx.cashAccount.findUnique({
          where: { id: prospectiveTill },
          select: { cashTrackingStartedAt: true },
        });
        cashTrackingStartedAt = tillRow?.cashTrackingStartedAt ?? null;
      }

      const globalTrackingStartedAt = await getGlobalCashTrackingStartedAt(tx);

      assertNewSessionCashCreditAllowed({
        targetPaid: opts.targetPaid,
        hasLedgerHistory: existing.length > 0,
        sessionFinancialAt: opts.sessionFinancialAt ?? null,
        globalTrackingStartedAt,
        staffMemberId,
        cashAccountId: prospectiveTill,
      });

      let cashAccountId = stickyTill;
      if (!cashAccountId && staffMemberId) {
        const till = await findActiveTillForStaff(tx, staffMemberId);
        cashAccountId = till?.id ?? null;
      }
      if (!cashAccountId) {
        cashAccountId = opts.cashAccountId ?? null;
      }

      const netCredited = round2(existing.reduce((s, m) => s + toNum(m.amount), 0));
      const allowFirstCredit = shouldAllowSessionCashCredit({
        sessionFinancialAt: opts.sessionFinancialAt ?? null,
        cashTrackingStartedAt,
        hasLedgerHistory: existing.length > 0,
      });
      const plan = planSessionPaidSync({
        netCredited,
        hasLedgerHistory: existing.length > 0,
        hasSessionPayment: existing.some((m) => m.type === 'SESSION_PAYMENT'),
        previousTargetPaid: opts.previousTargetPaid,
        targetPaid: opts.targetPaid,
        allowFirstCredit,
      });

      if (allowFirstCredit || existing.length > 0) {
        assertSessionCashCreditContext({
          plan,
          staffMemberId,
          cashAccountId,
        });
      }
      if (!plan) return null;
      if (!cashAccountId) {
        // Satisfies TS; assertSessionCashCreditContext already throws when plan + missing till.
        return null;
      }

      return postMovementInTx(tx, {
        cashAccountId,
        staffMemberId,
        type: plan.type,
        amount: plan.amount,
        referenceType: SESSION_REF_TYPE,
        referenceId: opts.sessionId,
        reason: opts.reason ?? null,
        createdById: opts.createdById ?? null,
      });
    };

    if (externalTx) return run(externalTx);
    return prisma.$transaction(run);
  },

  /**
   * Idempotent sync: bring PRIME_DEDUCTION net for shift to PrimeCalculationService totalPrime.
   * System-only — never exposed over HTTP.
   *
   * Cutover: no first deduction before cashTrackingStartedAt unless shift sessions
   * already have ledger history or prime was previously synced.
   */
  async syncShiftPrimeDeduction(shiftId: string, externalTx?: Prisma.TransactionClient) {
    const run = async (tx: Prisma.TransactionClient) => {
      const shift = await tx.shift.findUnique({
        where: { id: shiftId },
        select: { id: true, staffMemberId: true, startedAt: true },
      });
      if (!shift?.staffMemberId) return null;

      const summary = await primeCalculationService.calculateShiftPrimeSummary(shiftId);
      const desiredPrime = summary.totals.totalPrime;

      const existingForTill = await tx.cashMovement.findMany({
        where: {
          referenceType: SHIFT_PRIME_REF_TYPE,
          referenceId: shiftId,
        },
        select: { type: true, amount: true, cashAccountId: true },
      });

      const primeForTill = existingForTill.filter((m) => m.type === 'PRIME_DEDUCTION');
      const stickyTill = primeForTill.length > 0 ? primeForTill[0]!.cashAccountId : null;

      let cashAccountId = stickyTill;
      if (!cashAccountId) {
        const till = await findActiveTillForStaff(tx, shift.staffMemberId);
        cashAccountId = till?.id ?? null;
      }

      if (!cashAccountId) {
        if (desiredPrime > 0) {
          throw httpError(422, NO_CASH_FOR_STAFF_MSG);
        }
        return null;
      }

      await lockAccount(tx, cashAccountId);

      const existing = await tx.cashMovement.findMany({
        where: {
          referenceType: SHIFT_PRIME_REF_TYPE,
          referenceId: shiftId,
        },
        select: { type: true, amount: true, cashAccountId: true },
      });

      const primeMovements = existing.filter((m) => m.type === 'PRIME_DEDUCTION');

      const tillRow = await tx.cashAccount.findUnique({
        where: { id: cashAccountId },
        select: { cashTrackingStartedAt: true },
      });
      const cashTrackingStartedAt = tillRow?.cashTrackingStartedAt ?? null;

      const sessions = await tx.chairSession.findMany({
        where: { shiftId },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      let hasSessionPaymentsInLedger = false;
      if (sessionIds.length > 0) {
        const sessionMovement = await tx.cashMovement.findFirst({
          where: {
            referenceType: SESSION_REF_TYPE,
            referenceId: { in: sessionIds },
          },
          select: { id: true },
        });
        hasSessionPaymentsInLedger = !!sessionMovement;
      }

      const alreadyDeductedPrime = netPrimeDeductedFromMovements(
        primeMovements.map((m) => toNum(m.amount)),
      );

      const allowFirstDeduction = shouldAllowShiftPrimeDeduction({
        hasPrimeLedgerHistory: primeMovements.length > 0,
        shiftStartedAt: shift.startedAt,
        cashTrackingStartedAt,
        hasSessionPaymentsInLedger,
      });

      const plan = planShiftPrimeSync({
        desiredPrime,
        alreadyDeductedPrime,
        allowFirstDeduction,
        hasPrimeLedgerHistory: primeMovements.length > 0,
      });

      if (!plan) return null;

      const staffName = summary.shift.staffMemberName;
      const shiftLabel = summary.shift.shiftTypeName ?? 'shift';

      return postMovementInTx(tx, {
        cashAccountId,
        staffMemberId: shift.staffMemberId,
        type: plan.type,
        amount: plan.amount,
        referenceType: SHIFT_PRIME_REF_TYPE,
        referenceId: shiftId,
        reason: `Prime ${staffName} — ${shiftLabel}`,
      });
    };

    if (externalTx) return run(externalTx);
    return prisma.$transaction(run);
  },

  async withdraw(input: {
    cashAccountId: string;
    amount: number;
    reason?: string | null;
    createdById?: string | null;
    staffMemberId?: string | null;
  }) {
    const amount = assertPositiveAmount(input.amount, 'montant du retrait');

    return prisma.$transaction(async (tx) => {
      const account = await requireCashAccount(tx, input.cashAccountId);
      const staffMemberId =
        input.staffMemberId != null && input.staffMemberId !== ''
          ? await optionalStaff(tx, input.staffMemberId)
          : account.staffMemberId;
      return postMovementInTx(tx, {
        cashAccountId: input.cashAccountId,
        staffMemberId,
        type: 'WITHDRAWAL',
        amount: money(amount).negated(),
        reason: normalizeReason(input.reason),
        createdById: input.createdById ?? null,
      });
    });
  },

  /**
   * Set desired balance via ADMIN_ADJUSTMENT delta (never silent overwrite).
   * Example: 1300 → 1250 creates ADMIN_ADJUSTMENT -50.
   */
  async adjust(input: {
    cashAccountId: string;
    desiredBalance: number;
    reason?: string | null;
    createdById?: string | null;
    staffMemberId?: string | null;
  }) {
    const reason = normalizeReason(input.reason);

    return prisma.$transaction(async (tx) => {
      const account = await requireCashAccount(tx, input.cashAccountId);
      const staffMemberId =
        input.staffMemberId != null && input.staffMemberId !== ''
          ? await optionalStaff(tx, input.staffMemberId)
          : account.staffMemberId;
      await lockAccount(tx, account.id);
      const fresh = await tx.cashAccount.findUniqueOrThrow({ where: { id: account.id } });
      const plan = planAdjustment(toNum(fresh.currentBalance), input.desiredBalance);

      const movement = await tx.cashMovement.create({
        data: {
          cashAccountId: account.id,
          staffMemberId,
          type: plan.type,
          amount: money(plan.amount),
          balanceBefore: money(plan.balanceBefore),
          balanceAfter: money(plan.balanceAfter),
          reason,
          createdById: input.createdById ?? null,
        },
      });

      await tx.cashAccount.update({
        where: { id: account.id },
        data: { currentBalance: money(plan.balanceAfter) },
      });

      return { movement, ...plan };
    });
  },

  /** Post opposite REVERSAL for an existing movement (idempotent per original id). */
  async reverse(input: {
    movementId: string;
    reason?: string | null;
    createdById?: string | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const original = await tx.cashMovement.findUnique({ where: { id: input.movementId } });
      if (!original) throw httpError(404, 'Mouvement introuvable');
      if (original.type === 'REVERSAL') {
        throw httpError(400, 'Impossible d’annuler une annulation.');
      }

      const already = await tx.cashMovement.findFirst({
        where: {
          type: 'REVERSAL',
          referenceType: 'CashMovement',
          referenceId: original.id,
        },
      });
      if (already) throw httpError(409, 'Ce mouvement a déjà été annulé.');

      const plan = planReversal(toNum(original.amount));
      return postMovementInTx(tx, {
        cashAccountId: original.cashAccountId,
        staffMemberId: original.staffMemberId,
        type: plan.type,
        amount: plan.amount,
        referenceType: 'CashMovement',
        referenceId: original.id,
        reason: input.reason ?? `Annulation du mouvement ${original.id}`,
        createdById: input.createdById ?? null,
      });
    });
  },

  /**
   * Day stats for one physical till + business date (YYYY-MM-DD).
   * physicalBalance always from the account; optional staffMemberId filters movement stats only.
   */
  async getDayStats(
    cashAccountId: string,
    businessDate?: string,
    staffMemberId?: string | null,
  ) {
    if (!cashAccountId?.trim()) throw httpError(400, 'cashAccountId est obligatoire.');

    const tz = getTimezone();
    const date = businessDate?.trim() || getBusinessDate(tz);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw httpError(400, 'Date invalide (attendu YYYY-MM-DD).');
    }
    const { start, end } = getDayBoundsUtc(date, tz);

    const account = await prisma.cashAccount.findUnique({
      where: { id: cashAccountId },
      select: {
        id: true,
        code: true,
        name: true,
        currentBalance: true,
        movements: {
          where: {
            createdAt: { gte: start, lt: end },
            ...(staffMemberId?.trim() ? { staffMemberId: staffMemberId.trim() } : {}),
          },
          select: { type: true, amount: true },
        },
      },
    });
    if (!account) throw httpError(404, 'Caisse introuvable');

    const physicalBalance = toNum(account.currentBalance);
    const today = account.movements.map((m) => ({
      type: m.type as CashMovementType,
      amount: toNum(m.amount),
    }));
    const stats = computeDayStats({
      currentBalance: physicalBalance,
      todayMovements: today,
    });

    return {
      cashAccountId: account.id,
      code: account.code,
      name: account.name,
      businessDate: date,
      staffMemberId: staffMemberId?.trim() || null,
      physicalBalance,
      openingBalance: stats.openingBalance,
      sessionIncome: stats.sessionIncome,
      primeDeductions: stats.primeDeductions,
      dailyIncome: stats.dailyIncome,
      withdrawals: stats.withdrawals,
      adjustments: stats.adjustments,
      closingBalance: stats.closingBalance,
    };
  },

  async listAccountsWithDayStats(opts?: { restrictToStaffMemberId?: string | null }) {
    await this.ensurePhysicalAccounts();

    const tz = getTimezone();
    const businessDate = getBusinessDate(tz);
    const { start, end } = getDayBoundsUtc(businessDate, tz);

    const accounts = await prisma.cashAccount.findMany({
      where: {
        code: { in: [...PHYSICAL_CASH_CODES] },
        ...(opts?.restrictToStaffMemberId?.trim()
          ? { staffMemberId: opts.restrictToStaffMemberId.trim() }
          : {}),
      },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        currentBalance: true,
        staffMemberId: true,
        staffMember: { select: { id: true, name: true } },
        movements: {
          where: { createdAt: { gte: start, lt: end } },
          select: { type: true, amount: true },
        },
      },
    });

    let storeTotal = 0;
    const rows = accounts.map((a) => {
      const balance = toNum(a.currentBalance);
      storeTotal = round2(storeTotal + balance);
      const today = a.movements.map((m) => ({
        type: m.type as CashMovementType,
        amount: toNum(m.amount),
      }));
      const stats = computeDayStats({ currentBalance: balance, todayMovements: today });
      return {
        cashAccountId: a.id,
        code: a.code,
        name: a.name,
        isActive: a.isActive,
        staffMemberId: a.staffMemberId,
        staffMemberName: a.staffMember?.name ?? null,
        openingBalance: stats.openingBalance,
        sessionIncome: stats.sessionIncome,
        primeDeductions: stats.primeDeductions,
        incomes: stats.dailyIncome,
        dailyIncome: stats.dailyIncome,
        withdrawals: stats.withdrawals,
        adjustments: stats.adjustments,
        currentBalance: stats.closingBalance,
        closingBalance: stats.closingBalance,
        physicalBalance: balance,
      };
    });

    return {
      businessDate,
      storeTotal,
      accounts: rows,
    };
  },

  async getAccountDetail(cashAccountId: string) {
    if (!cashAccountId?.trim()) throw httpError(400, 'cashAccountId est obligatoire.');

    const account = await prisma.cashAccount.findUnique({
      where: { id: cashAccountId },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        currentBalance: true,
        staffMemberId: true,
        staffMember: { select: { id: true, name: true } },
      },
    });
    if (!account) throw httpError(404, 'Caisse introuvable');

    const day = await this.getDayStats(cashAccountId);

    return {
      cashAccountId: account.id,
      code: account.code,
      name: account.name,
      isActive: account.isActive,
      staffMemberId: account.staffMemberId,
      staffMemberName: account.staffMember?.name ?? null,
      businessDate: day.businessDate,
      physicalBalance: day.physicalBalance,
      today: {
        openingBalance: day.openingBalance,
        sessionIncome: day.sessionIncome,
        primeDeductions: day.primeDeductions,
        incomes: day.dailyIncome,
        withdrawals: day.withdrawals,
        adjustments: day.adjustments,
        currentBalance: day.closingBalance,
      },
      currentBalance: day.closingBalance,
    };
  },

  async listMovements(input: {
    cashAccountId?: string | null;
    staffMemberId?: string | null;
    page?: number;
    pageSize?: number;
    /** Filter by CashMovementType */
    type?: CashMovementType | null;
    /** Business date YYYY-MM-DD (APP_TIMEZONE day bounds) */
    date?: string | null;
  }) {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.CashMovementWhereInput = {};

    if (input.cashAccountId?.trim()) {
      where.cashAccountId = input.cashAccountId.trim();
    }
    if (input.staffMemberId?.trim()) {
      where.staffMemberId = input.staffMemberId.trim();
    }
    if (input.type) {
      where.type = input.type;
    }
    if (input.date?.trim()) {
      const date = input.date.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw httpError(400, 'Date invalide (attendu YYYY-MM-DD).');
      }
      const { start, end } = getDayBoundsUtc(date, getTimezone());
      where.createdAt = { gte: start, lt: end };
    }

    const [total, rows] = await Promise.all([
      prisma.cashMovement.count({ where }),
      prisma.cashMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          createdBy: { select: { id: true, name: true } },
          staffMember: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      items: rows.map(mapMovement),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
    };
  },

  /**
   * Assign or clear the current staff member on a physical till.
   * Does not modify cash_movements (historical staff attribution is immutable).
   */
  async setCashAccountAssignment(input: {
    cashAccountId: string;
    staffMemberId: string | null;
    updatedById: string;
  }) {
    if (!input.updatedById?.trim()) {
      throw httpError(401, 'Utilisateur authentifié requis.');
    }

    return prisma.$transaction(async (tx) => {
      const account = await requireCashAccount(tx, input.cashAccountId);
      await lockAccount(tx, account.id);

      const targetStaffId = input.staffMemberId?.trim() || null;
      let staffName: string | null = null;

      if (targetStaffId) {
        const staff = await tx.staffMember.findUnique({
          where: { id: targetStaffId },
          select: { id: true, name: true, isActive: true },
        });
        const other = await tx.cashAccount.findFirst({
          where: {
            staffMemberId: targetStaffId,
            isActive: true,
            id: { not: account.id },
            code: { in: [...PHYSICAL_CASH_CODES] },
          },
          select: { name: true, code: true },
        });
        planStaffAssignment({
          staffMemberId: targetStaffId,
          staffExists: !!staff,
          staffActive: staff?.isActive ?? false,
          staffAlreadyOnOtherTill: other ? `${other.name} (${other.code})` : null,
        });
        staffName = staff!.name;
      }

      let updated;
      try {
        updated = await tx.cashAccount.update({
          where: { id: account.id },
          data: { staffMemberId: targetStaffId },
          select: {
            id: true,
            code: true,
            name: true,
            staffMemberId: true,
            staffMember: { select: { id: true, name: true } },
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw httpError(
            409,
            'Cette fille est déjà affectée à une autre caisse active.',
          );
        }
        throw err;
      }

      await tx.settingsAuditLog.create({
        data: {
          userId: input.updatedById,
          entityType: 'CashAccount',
          entityId: account.id,
          action: 'STAFF_ASSIGNMENT',
          newValue: {
            cashAccountId: account.id,
            code: account.code,
            staffMemberId: targetStaffId,
            staffMemberName: staffName,
          },
        },
      });

      return {
        cashAccountId: updated.id,
        code: updated.code,
        name: updated.name,
        staffMemberId: updated.staffMemberId,
        staffMemberName: updated.staffMember?.name ?? null,
      };
    });
  },
};

// Re-export helpers used by tests / session wiring
export {
  applySignedAmount,
  resolveSessionPaidTarget,
  round2,
  SESSION_REF_TYPE,
};

/** Resolve session staff + till from historical shift snapshot (fallback: current staff till). */
export async function resolveSessionCashContext(
  sessionId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ staffMemberId: string | null; cashAccountId: string | null }> {
  const session = await db.chairSession.findUnique({
    where: { id: sessionId },
    select: {
      shift: { select: { staffMemberId: true, cashAccountId: true } },
    },
  });
  const shiftStaffMemberId = session?.shift?.staffMemberId ?? null;
  const shiftCashAccountId = session?.shift?.cashAccountId ?? null;

  if (!shiftStaffMemberId) {
    return { staffMemberId: null, cashAccountId: null };
  }

  if (shiftCashAccountId) {
    return resolveHistoricalSessionCashTarget({
      shiftStaffMemberId,
      shiftCashAccountId,
      legacyStaffTillId: null,
    });
  }

  const till = await db.cashAccount.findFirst({
    where: {
      staffMemberId: shiftStaffMemberId,
      isActive: true,
      code: { in: [...PHYSICAL_CASH_CODES] },
    },
    select: { id: true },
  });

  return resolveHistoricalSessionCashTarget({
    shiftStaffMemberId,
    shiftCashAccountId: null,
    legacyStaffTillId: till?.id ?? null,
  });
}
