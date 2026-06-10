import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { settingsService } from './settings.service';
import {
  chairUpdateSchema,
  detectionConfigSchema,
  pricingPlanCreateSchema,
  pricingPlanUpdateSchema,
  pricingRuleUpdateSchema,
  staffCreateSchema,
  staffUpdateSchema,
} from './settings.types';

const router = Router();

// ── Zod parse helper ───────────────────────────────────────────────────────────

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

// ── A. Chair settings ──────────────────────────────────────────────────────────

// GET /api/settings/chairs
router.get('/chairs', (_req: Request, res: Response) => {
  settingsService
    .getChairs()
    .then((data) => res.json(data))
    .catch((err: unknown) =>
      res.status(500).json({ ok: false, error: 'Failed to load chairs', detail: String(err) }),
    );
});

// PATCH /api/settings/chairs/:chairId
router.patch('/chairs/:chairId', (req: Request, res: Response) => {
  const parsed = parseBody(chairUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    return;
  }

  settingsService
    .updateChair(req.params.chairId, parsed.data)
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Chair not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) =>
      res.status(500).json({ ok: false, error: 'Failed to update chair', detail: String(err) }),
    );
});

// PATCH /api/settings/chairs/:chairId/detection-config
router.patch('/chairs/:chairId/detection-config', (req: Request, res: Response) => {
  const parsed = parseBody(detectionConfigSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  settingsService
    .updateDetectionConfig(req.params.chairId, parsed.data)
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Chair not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to update detection config', detail: String(err) }),
    );
});

// ── B. Pricing plans ───────────────────────────────────────────────────────────

// GET /api/settings/pricing/plans
router.get('/pricing/plans', (_req: Request, res: Response) => {
  settingsService
    .getPricingPlans()
    .then((data) => res.json(data))
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to load pricing plans', detail: String(err) }),
    );
});

// POST /api/settings/pricing/plans
router.post('/pricing/plans', (req: Request, res: Response) => {
  const parsed = parseBody(pricingPlanCreateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  settingsService
    .createPricingPlan(parsed.data)
    .then((plan) => res.status(201).json(plan))
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to create pricing plan', detail: String(err) }),
    );
});

// PATCH /api/settings/pricing/plans/:planId
router.patch('/pricing/plans/:planId', (req: Request, res: Response) => {
  const parsed = parseBody(pricingPlanUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    return;
  }

  settingsService
    .updatePricingPlan(req.params.planId, parsed.data)
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Pricing plan not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to update pricing plan', detail: String(err) }),
    );
});

// ── C. Pricing rule ────────────────────────────────────────────────────────────

// GET /api/settings/pricing/rule
router.get('/pricing/rule', (_req: Request, res: Response) => {
  settingsService
    .getPricingRule()
    .then((rule) => {
      if (!rule) {
        res.json({ rule: null, message: 'No active pricing rule configured' });
        return;
      }
      res.json(rule);
    })
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to load pricing rule', detail: String(err) }),
    );
});

// PATCH /api/settings/pricing/rule
router.patch('/pricing/rule', (req: Request, res: Response) => {
  const parsed = parseBody(pricingRuleUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  settingsService
    .upsertPricingRule(parsed.data)
    .then((rule) => res.json(rule))
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to update pricing rule', detail: String(err) }),
    );
});

// ── D. Staff members ───────────────────────────────────────────────────────────

// GET /api/settings/staff
router.get('/staff', (_req: Request, res: Response) => {
  settingsService
    .getStaff()
    .then((data) => res.json(data))
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to load staff members', detail: String(err) }),
    );
});

// POST /api/settings/staff
router.post('/staff', (req: Request, res: Response) => {
  const parsed = parseBody(staffCreateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  settingsService
    .createStaff(parsed.data)
    .then((staff) => res.status(201).json(staff))
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to create staff member', detail: String(err) }),
    );
});

// PATCH /api/settings/staff/:staffMemberId
router.patch('/staff/:staffMemberId', (req: Request, res: Response) => {
  const parsed = parseBody(staffUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    return;
  }

  settingsService
    .updateStaff(req.params.staffMemberId, parsed.data)
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Staff member not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to update staff member', detail: String(err) }),
    );
});

// ── E. System info ─────────────────────────────────────────────────────────────

// GET /api/settings/system
router.get('/system', (_req: Request, res: Response) => {
  settingsService
    .getSystemInfo()
    .then((info) => res.json(info))
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to load system info', detail: String(err) }),
    );
});

export default router;
