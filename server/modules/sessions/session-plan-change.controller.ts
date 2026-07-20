import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sessionPlanChangeService } from './session-plan-change.service';
import type { AuthRequest } from '../../middleware/auth.middleware';
import { requireOwnerAdmin } from '../../middleware/auth.middleware';

const router = Router();

const uuidSchema = z.string().uuid('Identifiant UUID invalide');

function handleError(res: Response, err: unknown): void {
  const e = err as Error & { status?: number };
  const status = e.status ?? 500;
  res.status(status).json({
    ok: false,
    error: status === 500 ? 'Internal server error' : e.message,
  });
}

const statusFilterSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional();

const reviewSchema = z
  .object({
    reviewNote: z.string().max(500).optional(),
  })
  .strict();

// GET /api/session-plan-change-requests
router.get('/', requireOwnerAdmin, (req: Request, res: Response) => {
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
  const sessionIdRaw = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  const limitRaw = typeof req.query.limit === 'string' ? req.query.limit : undefined;

  const statusParsed = statusFilterSchema.safeParse(statusRaw);
  if (!statusParsed.success) {
    res.status(400).json({ ok: false, error: 'status invalide (PENDING|APPROVED|REJECTED)' });
    return;
  }
  if (sessionIdRaw) {
    const idParsed = uuidSchema.safeParse(sessionIdRaw);
    if (!idParsed.success) {
      res.status(400).json({ ok: false, error: 'sessionId UUID invalide' });
      return;
    }
  }

  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit as number) < 1)) {
    res.status(400).json({ ok: false, error: 'limit invalide' });
    return;
  }

  sessionPlanChangeService
    .listRequests({
      status: statusParsed.data,
      sessionId: sessionIdRaw,
      limit,
    })
    .then((requests) => res.json({ ok: true, requests }))
    .catch((err: unknown) => handleError(res, err));
});

// GET /api/session-plan-change-requests/:requestId
router.get('/:requestId', requireOwnerAdmin, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.requestId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'requestId UUID invalide' });
    return;
  }

  sessionPlanChangeService
    .getRequestById(idParsed.data)
    .then((request) => {
      if (!request) {
        res.status(404).json({ ok: false, error: 'Demande introuvable' });
        return;
      }
      res.json({ ok: true, request });
    })
    .catch((err: unknown) => handleError(res, err));
});

// POST /api/session-plan-change-requests/:requestId/approve
router.post('/:requestId/approve', requireOwnerAdmin, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.requestId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'requestId UUID invalide' });
    return;
  }

  const parsed = reviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    res.status(400).json({ ok: false, error: msg });
    return;
  }

  const actor = (req as AuthRequest).user;
  if (!actor) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  sessionPlanChangeService
    .approveRequest(idParsed.data, parsed.data, actor)
    .then((result) => res.json({ ok: true, ...result }))
    .catch((err: unknown) => handleError(res, err));
});

// POST /api/session-plan-change-requests/:requestId/reject
router.post('/:requestId/reject', requireOwnerAdmin, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.requestId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'requestId UUID invalide' });
    return;
  }

  const parsed = reviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    res.status(400).json({ ok: false, error: msg });
    return;
  }

  const actor = (req as AuthRequest).user;
  if (!actor) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  sessionPlanChangeService
    .rejectRequest(idParsed.data, parsed.data, actor)
    .then((request) => res.json({ ok: true, request }))
    .catch((err: unknown) => handleError(res, err));
});

export default router;
