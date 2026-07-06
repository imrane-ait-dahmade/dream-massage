import { Router } from 'express';
import type { Request, Response } from 'express';
import { settingsService, parseStaffVisibility } from './settings.service';
import {
  chairUpdateSchema,
  detectionConfigSchema,
  pricingPlanCreateSchema,
  pricingPlanUpdateSchema,
  pricingRuleUpdateSchema,
  staffCreateSchema,
  staffUpdateSchema,
} from './settings.types';
import { parseBody } from '../../utils/controller-helpers';
import type { AuthRequest } from '../../middleware/auth.middleware';
import primeSettingsRouter from './prime-settings.controller';
import shiftSettingsRouter from './shift-settings.controller';
import sessionSettingsRouter from './session-settings.controller';
import userSettingsRouter from './user-settings.controller';
import maintenanceRouter from '../archive/maintenance.controller';
import { archiveReasonSchema } from '../archive/archive.types';

const router = Router();

// ── Sub-routers ────────────────────────────────────────────────────────────────
router.use('/prime',   primeSettingsRouter);
router.use('/shifts',  shiftSettingsRouter);
router.use('/session', sessionSettingsRouter);
router.use('/users',   userSettingsRouter);
router.use('/maintenance', maintenanceRouter);

function userId(req: Request): string | undefined {
  return (req as AuthRequest).user?.id;
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
    .updateChair(req.params.chairId, parsed.data, userId(req))
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
    .updateDetectionConfig(req.params.chairId, parsed.data, userId(req))
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
    .createPricingPlan(parsed.data, userId(req))
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
    .updatePricingPlan(req.params.planId, parsed.data, userId(req))
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
    .upsertPricingRule(parsed.data, userId(req))
    .then((rule) => res.json(rule))
    .catch((err: unknown) =>
      res
        .status(500)
        .json({ ok: false, error: 'Failed to update pricing rule', detail: String(err) }),
    );
});

// ── D. Staff members ───────────────────────────────────────────────────────────

// GET /api/settings/staff?visibility=active|archived|all
router.get('/staff', (req: Request, res: Response) => {
  const visibility = parseStaffVisibility(
    typeof req.query.visibility === 'string' ? req.query.visibility : undefined,
  );
  settingsService
    .getStaff(visibility)
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
    .createStaff(parsed.data, userId(req))
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
    .updateStaff(req.params.staffMemberId, parsed.data, userId(req))
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

// PATCH /api/settings/staff/:staffMemberId/archive
router.patch('/staff/:staffMemberId/archive', (req: Request, res: Response) => {
  const parsed = parseBody(archiveReasonSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  settingsService
    .archiveStaff(req.params.staffMemberId, userId(req), parsed.data)
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Staff member not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ ok: false, error: (err as Error).message });
    });
});

// PATCH /api/settings/staff/:staffMemberId/restore
router.patch('/staff/:staffMemberId/restore', (req: Request, res: Response) => {
  const parsed = parseBody(archiveReasonSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  settingsService
    .restoreStaff(req.params.staffMemberId, userId(req), parsed.data)
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Staff member not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ ok: false, error: (err as Error).message });
    });
});

// DELETE /api/settings/staff/:staffMemberId — hard delete only when safe
router.delete('/staff/:staffMemberId', (req: Request, res: Response) => {
  settingsService
    .hardDeleteStaff(req.params.staffMemberId, userId(req))
    .then((deleted) => {
      if (!deleted) {
        res.status(404).json({ ok: false, error: 'Staff member not found' });
        return;
      }
      res.json({ ok: true });
    })
    .catch((err: unknown) => {
      const status = (err as { status?: number }).status ?? 500;
      const blockers = (err as { blockers?: string[] }).blockers;
      res.status(status).json({ ok: false, error: (err as Error).message, blockers });
    });
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
