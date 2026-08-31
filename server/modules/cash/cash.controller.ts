import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../../middleware/auth.middleware';
import {
  isAssistant,
  isOwnerOrAdmin,
  requireOwner,
  requireOwnerAdmin,
} from '../../middleware/auth.middleware';
import type { AuthUser } from '../auth/auth.service';
import { getBusinessDate, getTimezone } from '../../utils/time';
import { cashService } from './cash.service';
import { adminCreditBodySchema } from './cash.credit-http';
import { normalizeReason } from './cash.logic';
import { authenticatedStaffMemberId } from './cash-access';
import {
  assertUserCanAccessCashAccount,
  resolveStaffReadableCashAccountId,
} from './cash-access.service';

const router = Router();

function handleError(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const status = err instanceof Error ? (err as { status?: number }).status : undefined;
  if (status === 404 || msg.toLowerCase().includes('introuvable')) {
    res.status(404).json({ ok: false, error: msg });
    return;
  }
  if (status === 403) {
    res.status(403).json({ ok: false, error: msg });
    return;
  }
  if (status === 409) {
    res.status(409).json({ ok: false, error: msg });
    return;
  }
  if (status === 422) {
    res.status(422).json({ ok: false, error: msg });
    return;
  }
  if (status === 400) {
    res.status(400).json({ ok: false, error: msg });
    return;
  }
  res.status(500).json({ ok: false, error: 'Internal server error', detail: msg });
}

const withdrawSchema = z
  .object({
    amount: z.number().finite().positive(),
    reason: z.string().max(500).optional(),
    staffMemberId: z.string().min(1).optional(),
  })
  .strict();

const adjustSchema = z
  .object({
    desiredBalance: z.number().finite(),
    reason: z.string().max(500).optional().nullable(),
    staffMemberId: z.string().min(1).optional(),
  })
  .strict();

export const creditSchema = adminCreditBodySchema;

const initialBalanceSchema = z
  .object({
    countedAmount: z.number().finite().nonnegative(),
    reason: z.string().max(500).optional(),
  })
  .strict();

const assignmentSchema = z
  .object({
    staffMemberId: z.union([z.string().min(1), z.null()]),
  })
  .strict();

const MOVEMENT_TYPES = [
  'INITIAL_BALANCE',
  'SESSION_PAYMENT',
  'MANUAL_INCOME',
  'WITHDRAWAL',
  'ADMIN_ADJUSTMENT',
  'CORRECTION',
  'REVERSAL',
] as const;

function parseMovementQuery(query: AuthRequest['query']) {
  const page = query.page ? Number(query.page) : 1;
  const pageSize = query.pageSize ? Number(query.pageSize) : 25;
  const rawType = typeof query.type === 'string' ? query.type : '';
  const type = (MOVEMENT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as (typeof MOVEMENT_TYPES)[number])
    : null;
  const date = typeof query.date === 'string' ? query.date : null;
  const staffMemberId =
    typeof query.staffMemberId === 'string' && query.staffMemberId.trim()
      ? query.staffMemberId.trim()
      : null;
  const cashAccountId =
    typeof query.cashAccountId === 'string' && query.cashAccountId.trim()
      ? query.cashAccountId.trim()
      : null;
  return {
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    type,
    date,
    staffMemberId,
    cashAccountId,
  };
}

async function enforceStaffTillScope(
  user: AuthUser | undefined,
  requestedCashAccountId: string | null | undefined,
): Promise<string | null> {
  if (!user || isOwnerOrAdmin(user)) return requestedCashAccountId ?? null;

  const tillId = await resolveStaffReadableCashAccountId(user);
  if (!tillId) return null;

  if (requestedCashAccountId && requestedCashAccountId !== tillId) {
    throw Object.assign(new Error('Accès refusé à cette caisse.'), { status: 403 });
  }
  return tillId;
}

// GET /api/cash/accounts — list physical tills with today stats + storeTotal
router.get('/accounts', async (req: AuthRequest, res) => {
  try {
    if (isAssistant(req.user)) {
      const staffId = authenticatedStaffMemberId(req.user);
      if (!staffId) {
        res.json({
          ok: true,
          businessDate: getBusinessDate(getTimezone()),
          storeTotal: 0,
          accounts: [],
        });
        return;
      }
      const data = await cashService.listAccountsWithDayStats({
        restrictToStaffMemberId: staffId,
      });
      res.json({ ok: true, ...data });
      return;
    }

    const data = await cashService.listAccountsWithDayStats();
    res.json({ ok: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/cash/movements?cashAccountId=&staffMemberId=&page=&pageSize=&type=&date=
router.get('/movements', async (req: AuthRequest, res) => {
  try {
    const q = parseMovementQuery(req.query);
    const cashAccountId = await enforceStaffTillScope(req.user, q.cashAccountId);

    if (isAssistant(req.user) && !cashAccountId) {
      res.json({ ok: true, items: [], page: 1, pageSize: q.pageSize, total: 0, totalPages: 0 });
      return;
    }

    const data = await cashService.listMovements({
      cashAccountId,
      staffMemberId: isOwnerOrAdmin(req.user) ? q.staffMemberId : null,
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
      date: q.date,
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/cash/accounts/:cashAccountId/day-stats?date=&staffMemberId=
router.get('/accounts/:cashAccountId/day-stats', async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    await assertUserCanAccessCashAccount(req.user, req.params.cashAccountId);

    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const staffMemberId = isOwnerOrAdmin(req.user)
      ? typeof req.query.staffMemberId === 'string'
        ? req.query.staffMemberId
        : undefined
      : undefined;

    const data = await cashService.getDayStats(req.params.cashAccountId, date, staffMemberId);
    res.json({ ok: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/cash/accounts/:cashAccountId/movements
router.get('/accounts/:cashAccountId/movements', async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    await assertUserCanAccessCashAccount(req.user, req.params.cashAccountId);

    const q = parseMovementQuery(req.query);
    const data = await cashService.listMovements({
      cashAccountId: req.params.cashAccountId,
      staffMemberId: isOwnerOrAdmin(req.user) ? q.staffMemberId : null,
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
      date: q.date,
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/cash/accounts/:cashAccountId
router.get('/accounts/:cashAccountId', async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    await assertUserCanAccessCashAccount(req.user, req.params.cashAccountId);

    const data = await cashService.getAccountDetail(req.params.cashAccountId);
    res.json({ ok: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin write routes ────────────────────────────────────────────────────────

router.patch(
  '/accounts/:cashAccountId/assignment',
  requireOwnerAdmin,
  (req: AuthRequest, res) => {
    const parsed = assignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Payload invalide', details: parsed.error.flatten() });
      return;
    }
    if (!req.user?.id) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    cashService
      .setCashAccountAssignment({
        cashAccountId: req.params.cashAccountId,
        staffMemberId: parsed.data.staffMemberId,
        updatedById: req.user.id,
      })
      .then((result) => res.json({ ok: true, ...result }))
      .catch((err) => handleError(res, err));
  },
);

router.post('/accounts/:cashAccountId/credit', requireOwnerAdmin, (req: AuthRequest, res) => {
  const parsed = creditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Payload invalide', details: parsed.error.flatten() });
    return;
  }
  if (!req.user?.id) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  cashService
    .creditManualIncome({
      cashAccountId: req.params.cashAccountId,
      staffMemberId: parsed.data.staffMemberId ?? null,
      amount: parsed.data.amount,
      reason: normalizeReason(parsed.data.reason),
      createdById: req.user.id,
    })
    .then((result) =>
      res.json({
        ok: true,
        type: 'MANUAL_INCOME',
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        amount: result.amount,
        movementId: result.movement.id,
      }),
    )
    .catch((err) => handleError(res, err));
});

router.post(
  '/accounts/:cashAccountId/initial-balance',
  requireOwner,
  (req: AuthRequest, res) => {
    const parsed = initialBalanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Payload invalide', details: parsed.error.flatten() });
      return;
    }
    if (!req.user?.id) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    cashService
      .setInitialBalance({
        cashAccountId: req.params.cashAccountId,
        countedAmount: parsed.data.countedAmount,
        reason: parsed.data.reason ?? 'Cutover caisse production',
        createdById: req.user.id,
      })
      .then((result) =>
        res.json({
          ok: true,
          type: 'INITIAL_BALANCE',
          balanceBefore: result.balanceBefore,
          balanceAfter: result.balanceAfter,
          amount: result.amount,
          movementId: result.movement.id,
        }),
      )
      .catch((err) => handleError(res, err));
  },
);

router.post('/accounts/:cashAccountId/withdraw', requireOwnerAdmin, (req: AuthRequest, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Payload invalide', details: parsed.error.flatten() });
    return;
  }
  cashService
    .withdraw({
      cashAccountId: req.params.cashAccountId,
      amount: parsed.data.amount,
      reason: normalizeReason(parsed.data.reason),
      staffMemberId: parsed.data.staffMemberId ?? null,
      createdById: req.user?.id ?? null,
    })
    .then((result) =>
      res.json({
        ok: true,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        movementId: result.movement.id,
      }),
    )
    .catch((err) => handleError(res, err));
});

router.post('/accounts/:cashAccountId/adjust', requireOwnerAdmin, (req: AuthRequest, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Payload invalide', details: parsed.error.flatten() });
    return;
  }
  cashService
    .adjust({
      cashAccountId: req.params.cashAccountId,
      desiredBalance: parsed.data.desiredBalance,
      reason: normalizeReason(parsed.data.reason),
      staffMemberId: parsed.data.staffMemberId ?? null,
      createdById: req.user?.id ?? null,
    })
    .then((result) =>
      res.json({
        ok: true,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        amount: result.amount,
        movementId: result.movement.id,
      }),
    )
    .catch((err) => handleError(res, err));
});

router.post('/movements/:movementId/reverse', requireOwnerAdmin, (req: AuthRequest, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
  cashService
    .reverse({
      movementId: req.params.movementId,
      reason: reason ?? null,
      createdById: req.user?.id ?? null,
    })
    .then((result) =>
      res.json({
        ok: true,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        movementId: result.movement.id,
      }),
    )
    .catch((err) => handleError(res, err));
});

export default router;
