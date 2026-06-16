import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sessionService } from './session.service';
import type { AuthRequest } from '../../middleware/auth.middleware';

const router = Router();

function handleError(res: Response, err: unknown): void {
  const e = err as Error & { status?: number };
  res.status(e.status ?? 500).json({ ok: false, error: e.message ?? String(err) });
}

// GET /api/sessions/:sessionId
router.get('/:sessionId', (req: Request, res: Response) => {
  sessionService
    .getById(req.params.sessionId)
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
    correctedAmount:  z.number().nonnegative().optional(),
    correctionReason: z.string().optional(),
    notes:            z.string().optional(),
    clearCorrection:  z.boolean().optional(),
  })
  .strict();

// PATCH /api/sessions/:sessionId/correction
router.patch('/:sessionId/correction', (req: Request, res: Response) => {
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
    .correctSession(req.params.sessionId, parsed.data, actor)
    .then((session) => {
      if (!session) {
        res.status(404).json({ ok: false, error: 'Session introuvable' });
        return;
      }
      res.json({ ok: true, session });
    })
    .catch((err: unknown) => handleError(res, err));
});

export default router;
