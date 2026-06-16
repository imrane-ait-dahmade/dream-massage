import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sessionSettingsService } from './session-settings.service';

const router = Router();

const updateSchema = z
  .object({
    minimumBillableSeconds:       z.number().int().nonnegative().optional(),
    graceSeconds:                 z.number().int().nonnegative().optional(),
    roundingMode:                 z.enum(['NEAREST_PLAN', 'NEXT_PLAN', 'EXACT_MINUTES']).optional(),
    overtimePolicy:               z.enum(['NEXT_PLAN', 'EXTRA_MINUTE', 'ANOMALY']).optional(),
    extraMinutePrice:             z.number().nonnegative().nullable().optional(),
    minimumPlanId:                z.string().uuid().nullable().optional(),
    allowManualSessionCorrection: z.boolean().optional(),
    correctionReasonRequired:     z.boolean().optional(),
  })
  .strict();

// GET /api/settings/session
router.get('/', (_req: Request, res: Response) => {
  sessionSettingsService
    .get()
    .then((data) => res.json(data))
    .catch((err: unknown) =>
      res.status(500).json({ ok: false, error: 'Failed to load session settings', detail: String(err) }),
    );
});

// PATCH /api/settings/session
router.patch('/', (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    res.status(400).json({ ok: false, error: msg });
    return;
  }

  sessionSettingsService
    .update(parsed.data)
    .then((data) => res.json(data))
    .catch((err: unknown) =>
      res.status(500).json({ ok: false, error: 'Failed to update session settings', detail: String(err) }),
    );
});

export default router;
