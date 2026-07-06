import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireOwner } from '../../middleware/auth.middleware';
import type { AuthRequest } from '../../middleware/auth.middleware';
import { maintenanceService } from './maintenance.service';
import { bulkMaintenanceSchema } from './archive.types';
import { parseBody, handleError } from '../../utils/controller-helpers';

const router = Router();

function ownerId(req: Request): string {
  return (req as AuthRequest).user!.id;
}

// All maintenance routes — OWNER only
router.use(requireOwner);

// GET /api/settings/maintenance/backup-instructions
router.get('/backup-instructions', (_req: Request, res: Response) => {
  res.json(maintenanceService.getBackupInstructions());
});

// POST /api/settings/maintenance/bulk-archive-inactive-staff
router.post('/bulk-archive-inactive-staff', (req: Request, res: Response) => {
  const parsed = parseBody(bulkMaintenanceSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  maintenanceService
    .bulkArchiveInactiveStaff(ownerId(req), parsed.data)
    .then((result) => res.json(result))
    .catch((err: unknown) => handleError(res, err, 'Bulk archive failed'));
});

// POST /api/settings/maintenance/bulk-archive-orphan-schedules
router.post('/bulk-archive-orphan-schedules', (req: Request, res: Response) => {
  const parsed = parseBody(bulkMaintenanceSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  maintenanceService
    .bulkArchiveOrphanSchedules(ownerId(req), parsed.data)
    .then((result) => res.json(result))
    .catch((err: unknown) => handleError(res, err, 'Bulk archive failed'));
});

export default router;
