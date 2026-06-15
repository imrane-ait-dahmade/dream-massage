import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { primeSettingsService } from './prime-settings.service';
import { shiftSettingsService } from './shift-settings.service';
import { scheduleCreateSchema, scheduleUpdateSchema } from './shift-settings.types';
import { shiftTypeCreateSchema, shiftTypeUpdateSchema } from './prime-settings.types';
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

function handleError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof Error) {
    const status = (err as NodeJS.ErrnoException & { status?: number }).status;
    if (status === 404 || err.message.toLowerCase().includes('introuvable')) {
      res.status(404).json({ ok: false, error: err.message });
      return;
    }
    if (status === 409 || err.message.toLowerCase().includes('already exists')) {
      res.status(409).json({ ok: false, error: err.message });
      return;
    }
    if (status === 400) {
      res.status(400).json({ ok: false, error: err.message });
      return;
    }
  }
  res.status(500).json({ ok: false, error: fallback, detail: String(err) });
}

function userId(req: Request): string | undefined {
  return (req as AuthRequest).user?.id;
}

// ── A. Shift Types ────────────────────────────────────────────────────────────
// ShiftType CRUD is shared with /api/settings/prime/shift-types.
// Here the same primeSettingsService is reused so both paths read/write the
// same data. The two endpoints serve different UX contexts (prime config vs.
// shift planning) but operate on the same ShiftType table.

// GET /api/settings/shifts/types
router.get('/types', (_req: Request, res: Response) => {
  primeSettingsService
    .getShiftTypes()
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load shift types'));
});

// POST /api/settings/shifts/types
router.post('/types', (req: Request, res: Response) => {
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

// PATCH /api/settings/shifts/types/:id
router.patch('/types/:id', (req: Request, res: Response) => {
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
    .updateShiftType(req.params.id, parsed.data, userId(req))
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Shift type not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to update shift type'));
});

// ── B. Staff Schedule ─────────────────────────────────────────────────────────

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

// ── C. Today suggestions ──────────────────────────────────────────────────────

// GET /api/settings/shifts/today-suggestions
router.get('/today-suggestions', (_req: Request, res: Response) => {
  shiftSettingsService
    .getTodaySuggestions()
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load today suggestions'));
});

export default router;
