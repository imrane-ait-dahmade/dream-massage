import { Router } from 'express';
import type { Request, Response } from 'express';
import { shiftSettingsService } from './shift-settings.service';
import { scheduleCreateSchema, scheduleUpdateSchema } from './shift-settings.types';
import { parseBody, handleError } from '../../utils/controller-helpers';
import type { AuthRequest } from '../../middleware/auth.middleware';

// Canonical shift-type CRUD lives at /api/settings/prime/shift-types.
// This router handles schedule management and today suggestions only.

const router = Router();

function userId(req: Request): string | undefined {
  return (req as AuthRequest).user?.id;
}

// ── A. Staff Schedule ─────────────────────────────────────────────────────────

// GET /api/settings/shifts/schedule[?staffMemberId=...]
router.get('/schedule', (req: Request, res: Response) => {
  const staffMemberId =
    typeof req.query.staffMemberId === 'string' ? req.query.staffMemberId : undefined;
  shiftSettingsService
    .getSchedule(staffMemberId)
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load schedule'));
});

// POST /api/settings/shifts/schedule
router.post('/schedule', (req: Request, res: Response) => {
  const parsed = parseBody(scheduleCreateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  shiftSettingsService
    .createScheduleEntry(parsed.data, userId(req))
    .then((entry) => res.status(201).json(entry))
    .catch((err: unknown) => handleError(res, err, 'Failed to create schedule entry'));
});

// PATCH /api/settings/shifts/schedule/:id
router.patch('/schedule/:id', (req: Request, res: Response) => {
  const parsed = parseBody(scheduleUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    return;
  }
  shiftSettingsService
    .updateScheduleEntry(req.params.id, parsed.data, userId(req))
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Schedule entry not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to update schedule entry'));
});

// DELETE /api/settings/shifts/schedule/:id
router.delete('/schedule/:id', (req: Request, res: Response) => {
  shiftSettingsService
    .deleteScheduleEntry(req.params.id, userId(req))
    .then((deleted) => {
      if (!deleted) {
        res.status(404).json({ ok: false, error: 'Schedule entry not found' });
        return;
      }
      res.json({ ok: true });
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to delete schedule entry'));
});

// ── B. Today suggestions ──────────────────────────────────────────────────────

// GET /api/settings/shifts/today-suggestions
router.get('/today-suggestions', (_req: Request, res: Response) => {
  shiftSettingsService
    .getTodaySuggestions()
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load today suggestions'));
});

export default router;
