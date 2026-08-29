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
  assertWithdrawAmount,
  computeDayStats,
  movementLabel,
  planAdjustment,
  planInitialBalance,
  planReversal,
  planSessionPaidSync,
  round2,
  SESSION_REF_TYPE,
  type CashMovementType,
} from './cash.logic';

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
): Promise<{ id: string; code: string; name: string; currentBalance: Prisma.Decimal; isActive: boolean }> {
  if (!cashAccountId?.trim()) throw httpError(400, 'cashAccountId est obligatoire.');
  const account = await tx.cashAccount.findUnique({ where: { id: cashAccountId } });
  if (!account) throw httpError(404, 'Caisse introuvable');
  return account;
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
        data: { currentBalance: money(plan.balanceAfter) },
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
        reason: input.reason ?? null,
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
        reason: input.reason ?? null,
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
   * - Missing cashAccountId or staffMemberId on first credit → no-op
   * - If session already has ledger rows → reuse that cashAccountId (never migrate till)
   * - Idempotent when target already equals ledger net
   * - Legacy paid rows without ledger history are never backfilled
   * - Not exposed over HTTP
   *
   * Write paths that MUST call this (same TX as session update):
   * - sessionService.correctSession (set / clearCorrection)
   * - session-plan-change applyPaidAmountChangeInTx
   */
  async syncSessionPaidAmount(
    opts: {
      sessionId: string;
      cashAccountId: string | null | undefined;
      staffMemberId: string | null | undefined;
      previousPaidAmount: number | null;
      targetPaid: number | null;
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

      // Sticky till: later shift reassignment must not move historical session credits.
      const cashAccountId =
        existing.length > 0 ? existing[0]!.cashAccountId : opts.cashAccountId ?? null;
      const staffMemberId = opts.staffMemberId ?? null;

      if (!cashAccountId || !staffMemberId) return null;

      const netCredited = round2(existing.reduce((s, m) => s + toNum(m.amount), 0));
      const plan = planSessionPaidSync({
        netCredited,
        hasLedgerHistory: existing.length > 0,
        hasSessionPayment: existing.some((m) => m.type === 'SESSION_PAYMENT'),
        previousPaidAmount: opts.previousPaidAmount,
        targetPaid: opts.targetPaid,
      });
      if (!plan) return null;

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

  async withdraw(input: {
    cashAccountId: string;
    amount: number;
    reason?: string | null;
    createdById?: string | null;
    staffMemberId?: string | null;
  }) {
    const amount = assertPositiveAmount(input.amount, 'montant du retrait');

    return prisma.$transaction(async (tx) => {
      const staffMemberId = await optionalStaff(tx, input.staffMemberId);
      return postMovementInTx(tx, {
        cashAccountId: input.cashAccountId,
        staffMemberId,
        type: 'WITHDRAWAL',
        amount: money(amount).negated(),
        reason: input.reason ?? null,
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
    reason: string;
    createdById?: string | null;
    staffMemberId?: string | null;
  }) {
    if (!input.reason?.trim()) {
      throw httpError(400, 'La raison de correction est obligatoire.');
    }

    return prisma.$transaction(async (tx) => {
      const account = await requireCashAccount(tx, input.cashAccountId);
      const staffMemberId = await optionalStaff(tx, input.staffMemberId);
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
          reason: input.reason.trim(),
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
      dailyIncome: stats.dailyIncome,
      withdrawals: stats.withdrawals,
      adjustments: stats.adjustments,
      closingBalance: stats.closingBalance,
    };
  },

  async listAccountsWithDayStats() {
    await this.ensurePhysicalAccounts();

    const tz = getTimezone();
    const businessDate = getBusinessDate(tz);
    const { start, end } = getDayBoundsUtc(businessDate, tz);

    const accounts = await prisma.cashAccount.findMany({
      where: { code: { in: [...PHYSICAL_CASH_CODES] } },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        currentBalance: true,
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
        openingBalance: stats.openingBalance,
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
      select: { id: true, code: true, name: true, isActive: true, currentBalance: true },
    });
    if (!account) throw httpError(404, 'Caisse introuvable');

    const day = await this.getDayStats(cashAccountId);

    return {
      cashAccountId: account.id,
      code: account.code,
      name: account.name,
      isActive: account.isActive,
      businessDate: day.businessDate,
      physicalBalance: day.physicalBalance,
      today: {
        openingBalance: day.openingBalance,
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
};

// Re-export helpers used by tests / session wiring
export { applySignedAmount, round2, SESSION_REF_TYPE };

/** Resolve staff + physical till for a session via its shift (nulls if unassigned). */
export async function resolveSessionCashContext(
  sessionId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ staffMemberId: string | null; cashAccountId: string | null }> {
  const session = await db.chairSession.findUnique({
    where: { id: sessionId },
    select: {
      shiftId: true,
      shift: { select: { staffMemberId: true, cashAccountId: true } },
    },
  });
  return {
    staffMemberId: session?.shift?.staffMemberId ?? null,
    cashAccountId: session?.shift?.cashAccountId ?? null,
  };
}
