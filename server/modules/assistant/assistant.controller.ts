import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { assistantService } from './assistant.service';
import type { AuthRequest } from '../../middleware/auth.middleware';
import type { AuthUser } from '../auth/auth.service';
import {
  requireAssistant,
  requireAssistantRouteAccess,
} from '../../middleware/auth.middleware';

const router = Router();

const startShiftSchema = z.object({
  shiftTypeId: z.string().min(1),
}).strict();

const closeShiftSchema = z.object({
  declaredCash: z.number().finite().nonnegative().optional(),
}).strict();

function handleError(res: Response, err: unknown): void {
  const e = err as Error & { status?: number; currentShift?: unknown };
  const status = e.status ?? 500;
  const body: Record<string, unknown> = {
    ok: false,
    error: status === 500 ? 'Internal server error' : e.message,
  };
  if (status === 409 && e.currentShift) {
    body.currentShift = e.currentShift;
  }
  res.status(status).json(body);
}

function queryStr(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' ? v : undefined;
}

/** Assistants cannot pass staffMemberId — always scoped server-side. */
function scopedAssistantParams(
  req: Request,
  user: AuthUser,
): { date?: string; shiftId?: string; staffMemberId?: string } {
  return {
    date: queryStr(req, 'date'),
    shiftId: queryStr(req, 'shiftId'),
    staffMemberId: user.role === 'ASSISTANT' ? undefined : queryStr(req, 'staffMemberId'),
  };
}

// GET /api/assistant/shift-types — MATIN/SOIR options for self-start UI
router.get('/shift-types', requireAssistant, (_req: Request, res: Response) => {
  assistantService
    .listSelfStartShiftTypes()
    .then((items) => res.json({ ok: true, items }))
    .catch((err: unknown) => handleError(res, err));
});

// POST /api/assistant/shift/start
router.post('/shift/start', requireAssistant, (req: Request, res: Response) => {
  const parsed = startShiftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'shiftTypeId est requis' });
    return;
  }
  const user = (req as AuthRequest).user!;
  assistantService
    .startShift(user, parsed.data.shiftTypeId)
    .then((data) => res.status(201).json(data))
    .catch((err: unknown) => handleError(res, err));
});

// POST /api/assistant/shift/close
router.post('/shift/close', requireAssistant, (req: Request, res: Response) => {
  const parsed = closeShiftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Corps de requête invalide' });
    return;
  }
  const user = (req as AuthRequest).user!;
  assistantService
    .closeShift(user, parsed.data.declaredCash)
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err));
});

// GET /api/assistant/me — ASSISTANT only
router.get('/me', requireAssistant, (req: Request, res: Response) => {
  const user = (req as AuthRequest).user!;

  assistantService
    .getMe(user)
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err));
});

// GET /api/assistant/today — ASSISTANT (own data) or OWNER/ADMIN (preview)
router.get('/today', requireAssistantRouteAccess, (req: Request, res: Response) => {
  const user = (req as AuthRequest).user!;

  assistantService
    .getTodayDashboard(user, scopedAssistantParams(req, user))
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err));
});

// GET /api/assistant/sessions — ASSISTANT (own data) or OWNER/ADMIN (preview)
router.get('/sessions', requireAssistantRouteAccess, (req: Request, res: Response) => {
  const user = (req as AuthRequest).user!;
  const pageRaw = queryStr(req, 'page');
  const limitRaw = queryStr(req, 'limit');

  assistantService
    .listSessions(user, {
      ...scopedAssistantParams(req, user),
      status: queryStr(req, 'status'),
      page: pageRaw ? parseInt(pageRaw, 10) : undefined,
      limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
    })
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err));
});

// GET /api/assistant/pricing-plans — active plans for ASSISTANT plan-change UI
router.get('/pricing-plans', requireAssistant, (_req: Request, res: Response) => {
  assistantService
    .listActivePricingPlans()
    .then((items) => res.json({ ok: true, items }))
    .catch((err: unknown) => handleError(res, err));
});

// GET /api/assistant/plan-change-requests — ASSISTANT sees only own requests
router.get('/plan-change-requests', requireAssistant, (req: Request, res: Response) => {
  const user = (req as AuthRequest).user!;
  const statusRaw = queryStr(req, 'status');
  const status =
    statusRaw === 'PENDING' || statusRaw === 'APPROVED' || statusRaw === 'REJECTED'
      ? statusRaw
      : undefined;

  assistantService
    .listMyPlanChangeRequests(user, { status })
    .then((requests) => res.json({ ok: true, requests }))
    .catch((err: unknown) => handleError(res, err));
});

export default router;
