import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../../middleware/auth.middleware';
import { requireOwner, requireOwnerAdmin } from '../../middleware/auth.middleware';
import { cashService } from './cash.service';
import { adminCreditBodySchema } from './cash.credit-http';
import { normalizeReason } from './cash.logic';

const router = Router();

router.use(requireOwnerAdmin);

function handleError(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const status = err instanceof Error ? (err as { status?: number }).status : undefined;
  if (status === 404 || msg.toLowerCase().includes('introuvable')) {
    res.status(404).json({ ok: false, error: msg });
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

/**
 * Admin manual credit only.
 * System types and session references are never accepted from HTTP.
 */
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

// GET /api/cash/accounts — list physical tills with today stats + storeTotal
router.get('/accounts', (_req, res) => {
  cashService
    .listAccountsWithDayStats()
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => handleError(res, err));
});

// GET /api/cash/movements?cashAccountId=&staffMemberId=&page=&pageSize=&type=&date=
// Cross-till staff filter (optional cashAccountId).
router.get('/movements', (req, res) => {
  const q = parseMovementQuery(req.query);
  cashService
    .listMovements({
      cashAccountId: q.cashAccountId,
      staffMemberId: q.staffMemberId,
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
      date: q.date,
    })
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => handleError(res, err));
});

// GET /api/cash/accounts/:cashAccountId/day-stats?date=&staffMemberId=
router.get('/accounts/:cashAccountId/day-stats', (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  const staffMemberId =
    typeof req.query.staffMemberId === 'string' ? req.query.staffMemberId : undefined;
  cashService
    .getDayStats(req.params.cashAccountId, date, staffMemberId)
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => handleError(res, err));
});

// GET /api/cash/accounts/:cashAccountId/movements?page=&pageSize=&type=&date=&staffMemberId=
router.get('/accounts/:cashAccountId/movements', (req, res) => {
  const q = parseMovementQuery(req.query);
  cashService
    .listMovements({
      cashAccountId: req.params.cashAccountId,
      staffMemberId: q.staffMemberId,
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
      date: q.date,
    })
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => handleError(res, err));
});

// GET /api/cash/accounts/:cashAccountId
router.get('/accounts/:cashAccountId', (req, res) => {
  cashService
    .getAccountDetail(req.params.cashAccountId)
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => handleError(res, err));
});

// PATCH /api/cash/accounts/:cashAccountId/assignment — current staff on till
router.patch('/accounts/:cashAccountId/assignment', (req: AuthRequest, res) => {
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
});

// POST /api/cash/accounts/:cashAccountId/credit — MANUAL_INCOME only
router.post('/accounts/:cashAccountId/credit', (req: AuthRequest, res) => {
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

/**
 * POST /api/cash/accounts/:cashAccountId/initial-balance
 * Production cutover only — OWNER role (not daily ASSISTANT/ADMIN habit).
 */
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

// POST /api/cash/accounts/:cashAccountId/withdraw
router.post('/accounts/:cashAccountId/withdraw', (req: AuthRequest, res) => {
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

// POST /api/cash/accounts/:cashAccountId/adjust
router.post('/accounts/:cashAccountId/adjust', (req: AuthRequest, res) => {
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

// POST /api/cash/movements/:movementId/reverse
router.post('/movements/:movementId/reverse', (req: AuthRequest, res) => {
  const reason =
    typeof req.body?.reason === 'string' ? req.body.reason : undefined;
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
