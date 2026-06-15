import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { primeSettingsService } from './prime-settings.service';
import {
  shiftTypeCreateSchema,
  shiftTypeUpdateSchema,
  commissionRuleCreateSchema,
  commissionRuleUpdateSchema,
  targetBonusRuleCreateSchema,
  targetBonusRuleUpdateSchema,
} from './prime-settings.types';
import type { AuthRequest } from '../../middleware/auth.middleware';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data as z.output<S> };
  const msg = result.error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
  return { ok: false, error: msg };
}

function handleError(res: Response, err: unknown, fallbackMsg: string): void {
  if (err instanceof Error) {
    const status = (err as NodeJS.ErrnoException & { status?: number }).status;
    if (status === 404 || err.message.toLowerCase().includes('not found')) {
      res.status(404).json({ ok: false, error: err.message });
      return;
    }
    if (status === 409 || err.message.toLowerCase().includes('already exists')) {
      res.status(409).json({ ok: false, error: err.message });
      return;
    }
  }
  res.status(500).json({ ok: false, error: fallbackMsg, detail: String(err) });
}

function userId(req: Request): string | undefined {
  return (req as AuthRequest).user?.id;
}

// ── A. Shift Types ─────────────────────────────────────────────────────────────

// GET /api/settings/prime/shift-types
router.get('/shift-types', (_req: Request, res: Response) => {
  primeSettingsService
    .getShiftTypes()
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load shift types'));
});

// POST /api/settings/prime/shift-types
router.post('/shift-types', (req: Request, res: Response) => {
  const parsed = parseBody(shiftTypeCreateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  primeSettingsService
    .createShiftType(parsed.data, userId(req))
    .then((st) => res.status(201).json(st))
    .catch((err: unknown) => handleError(res, err, 'Failed to create shift type'));
});

// PATCH /api/settings/prime/shift-types/:shiftTypeId
router.patch('/shift-types/:shiftTypeId', (req: Request, res: Response) => {
  const parsed = parseBody(shiftTypeUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    return;
  }
  primeSettingsService
    .updateShiftType(req.params.shiftTypeId, parsed.data, userId(req))
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Shift type not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to update shift type'));
});

// ── B. Commission Rules ────────────────────────────────────────────────────────

// GET /api/settings/prime/commission-rules
router.get('/commission-rules', (_req: Request, res: Response) => {
  primeSettingsService
    .getCommissionRules()
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load commission rules'));
});

// POST /api/settings/prime/commission-rules
router.post('/commission-rules', (req: Request, res: Response) => {
  const parsed = parseBody(commissionRuleCreateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  primeSettingsService
    .createCommissionRule(parsed.data, userId(req))
    .then((rule) => res.status(201).json(rule))
    .catch((err: unknown) => handleError(res, err, 'Failed to create commission rule'));
});

// PATCH /api/settings/prime/commission-rules/:ruleId
router.patch('/commission-rules/:ruleId', (req: Request, res: Response) => {
  const parsed = parseBody(commissionRuleUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    return;
  }
  primeSettingsService
    .patchCommissionRule(req.params.ruleId, parsed.data, userId(req))
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Commission rule not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to update commission rule'));
});

// ── C. Target Bonus Rules ──────────────────────────────────────────────────────

// GET /api/settings/prime/target-bonus-rules
router.get('/target-bonus-rules', (_req: Request, res: Response) => {
  primeSettingsService
    .getTargetBonusRules()
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load target bonus rules'));
});

// POST /api/settings/prime/target-bonus-rules
router.post('/target-bonus-rules', (req: Request, res: Response) => {
  const parsed = parseBody(targetBonusRuleCreateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  primeSettingsService
    .createTargetBonusRule(parsed.data, userId(req))
    .then((rule) => res.status(201).json(rule))
    .catch((err: unknown) => handleError(res, err, 'Failed to create target bonus rule'));
});

// PATCH /api/settings/prime/target-bonus-rules/:ruleId
router.patch('/target-bonus-rules/:ruleId', (req: Request, res: Response) => {
  const parsed = parseBody(targetBonusRuleUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    return;
  }
  primeSettingsService
    .patchTargetBonusRule(req.params.ruleId, parsed.data, userId(req))
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Target bonus rule not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to update target bonus rule'));
});

// ── D. Summary ─────────────────────────────────────────────────────────────────

// GET /api/settings/prime/summary
router.get('/summary', (_req: Request, res: Response) => {
  primeSettingsService
    .getPrimeSummary()
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load prime settings summary'));
});

export default router;
