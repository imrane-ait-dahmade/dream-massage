import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sessionService } from './session.service';
import { sessionPlanChangeService } from './session-plan-change.service';
import type { AuthRequest } from '../../middleware/auth.middleware';
import { requireAssistant, requireOwnerAdmin } from '../../middleware/auth.middleware';

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

// GET /api/sessions/:sessionId
router.get('/:sessionId', requireOwnerAdmin, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.sessionId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'sessionId UUID invalide' });
    return;
  }

  sessionService
    .getById(idParsed.data)
    .then((session) => {
      if (!session) {
        res.status(404).json({ ok: false, error: 'Session introuvable' });
        return;
      }
      res.json(session);
    })
    .catch((err: unknown) => handleError(res, err));
});

// Accepts either a correction or a clear-correction request
const correctionSchema = z
  .object({
    correctedAmount: z.number().nonnegative().optional(),
    correctionReason: z.string().optional(),
    notes: z.string().optional(),
    clearCorrection: z.boolean().optional(),
  })
  .strict();

// PATCH /api/sessions/:sessionId/correction
router.patch('/:sessionId/correction', requireOwnerAdmin, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.sessionId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'sessionId UUID invalide' });
    return;
  }

  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    res.status(400).json({ ok: false, error: msg });
    return;
  }

  const actor = (req as AuthRequest).user ?? null;

  sessionService
    .correctSession(idParsed.data, parsed.data, actor)
    .then((session) => {
      if (!session) {
        res.status(404).json({ ok: false, error: 'Session introuvable' });
        return;
      }
      res.json({ ok: true, session });
    })
    .catch((err: unknown) => handleError(res, err));
});

const planChangeDirectSchema = z
  .object({
    requestedPlanId: z.string().uuid('requestedPlanId UUID invalide'),
    reason: z.string().max(500).optional(),
  })
  .strict();

// PATCH /api/sessions/:sessionId/plan — OWNER/ADMIN direct plan change
router.patch('/:sessionId/plan', requireOwnerAdmin, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.sessionId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'sessionId UUID invalide' });
    return;
  }

  const parsed = planChangeDirectSchema.safeParse(req.body);
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
    .changePlanDirect(idParsed.data, parsed.data, actor)
    .then((result) => res.json({ ok: true, ...result }))
    .catch((err: unknown) => handleError(res, err));
});

const planChangeRequestSchema = z
  .object({
    requestedPlanId: z.string().uuid('requestedPlanId UUID invalide').optional(),
    // 0 DH is valid (séance offerte) — do not use truthiness checks
    requestedPaidAmount: z.number().nonnegative().optional(),
    reason: z.string().min(1, 'reason est obligatoire').max(500),
  })
  .strict()
  .refine(
    (data) => data.requestedPlanId !== undefined || data.requestedPaidAmount !== undefined,
    {
      message:
        'Au moins une modification est requise : nouveau plan et/ou nouveau montant payé.',
    },
  );

// POST /api/sessions/:sessionId/plan-change-requests — ASSISTANT creates a PENDING request
router.post('/:sessionId/plan-change-requests', requireAssistant, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.sessionId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'sessionId UUID invalide' });
    return;
  }

  const parsed = planChangeRequestSchema.safeParse(req.body);
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
    .createRequest(idParsed.data, parsed.data, actor)
    .then((request) => res.status(201).json({ ok: true, request }))
    .catch((err: unknown) => handleError(res, err));
});

// GET /api/sessions/:sessionId/plan-change-requests — OWNER/ADMIN history for a session
router.get('/:sessionId/plan-change-requests', requireOwnerAdmin, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.sessionId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'sessionId UUID invalide' });
    return;
  }

  sessionPlanChangeService
    .listRequests({ sessionId: idParsed.data })
    .then((requests) => res.json({ ok: true, requests }))
    .catch((err: unknown) => handleError(res, err));
});

const deleteSchema = z.object({ reason: z.string().optional() }).strict();

// DELETE /api/sessions/:sessionId
router.delete('/:sessionId', requireOwnerAdmin, (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.sessionId);
  if (!idParsed.success) {
    res.status(400).json({ ok: false, error: 'sessionId UUID invalide' });
    return;
  }

  const parsed = deleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Corps de requête invalide' });
    return;
  }

  const actor = (req as AuthRequest).user ?? null;

  sessionService
    .deleteSession(idParsed.data, actor, parsed.data.reason)
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Session introuvable' });
        return;
      }
      res.json({ ok: true, ...result });
    })
    .catch((err: unknown) => handleError(res, err));
});

export default router;
