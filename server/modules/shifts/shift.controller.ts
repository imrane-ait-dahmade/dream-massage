import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { primeCalculationService } from '../prime/prime-calculation.service';
import { shiftService } from './shift.service';
import { getAutoShiftStatus, runAutoShiftSyncJob } from '../../jobs/auto-shift.job';
import type { AuthRequest } from '../../middleware/auth.middleware';

const router = Router();

// ── Validation schemas ─────────────────────────────────────────────────────────

const bonusAdjustmentSchema = z.object({
  amount: z.number().finite(),
  reason: z.string().max(500).optional(),
});

const shiftOpenSchema = z
  .object({
    staffMemberId: z.string().uuid(),
    shiftTypeId:   z.string().uuid().optional(),
  })
  .strict();

const shiftCloseSchema = z
  .object({
    declaredCash: z.number().finite().nonnegative().optional(),
  })
  .strict();

// ── Error helper ───────────────────────────────────────────────────────────────

function handleError(res: Response, err: unknown): void {
  const msg    = err instanceof Error ? err.message : String(err);
  const status = (err instanceof Error ? (err as { status?: number }).status : undefined);
  if (status === 404 || msg.toLowerCase().includes('not found') || msg.includes('introuvable')) {
    res.status(404).json({ ok: false, error: msg });
    return;
  }
  if (status === 409) {
    res.status(409).json({ ok: false, error: msg });
    return;
  }
  if (status === 400) {
    res.status(400).json({ ok: false, error: msg });
    return;
  }
  res.status(500).json({ ok: false, error: 'Internal server error', detail: msg });
}

// ── GET /api/shifts/automation/status ─────────────────────────────────────────
// Returns current auto-shift job state (enabled, interval, last run counts, last error).

router.get('/automation/status', (_req: Request, res: Response) => {
  res.json(getAutoShiftStatus());
});

// ── POST /api/shifts/automation/run ───────────────────────────────────────────
// Manually triggers one auto-shift sync cycle. Useful for testing without waiting
// for the scheduled interval.

router.post('/automation/run', (_req: Request, res: Response) => {
  runAutoShiftSyncJob()
    .then((result) => res.json({ ok: true, ...result }))
    .catch((err: unknown) => handleError(res, err));
});

// ── GET /api/shifts/open ───────────────────────────────────────────────────────
// Returns the currently open shift or { shift: null } if none is open.
// Registered before /:id routes so Express doesn't treat "open" as an ID.

router.get('/open', (_req: Request, res: Response) => {
  shiftService
    .getOpenShift()
    .then((shift) => res.json({ shift: shift ?? null }))
    .catch((err: unknown) => handleError(res, err));
});

// ── POST /api/shifts/open ─────────────────────────────────────────────────────
// Opens a new shift. Only one shift can be OPEN at a time.

router.post('/open', (req: Request, res: Response) => {
  const parsed = shiftOpenSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    res.status(400).json({ ok: false, error: msg });
    return;
  }

  const openedByUserId = (req as AuthRequest).user?.id;
  if (!openedByUserId) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  shiftService
    .openShift(parsed.data, openedByUserId)
    .then((shift) => res.status(201).json({ shift }))
    .catch((err: unknown) => handleError(res, err));
});

// ── POST /api/shifts/:id/close ────────────────────────────────────────────────
// Closes an open shift; optionally records the declared cash amount.

router.post('/:id/close', (req: Request, res: Response) => {
  const parsed = shiftCloseSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    res.status(400).json({ ok: false, error: msg });
    return;
  }

  const closedByUserId = (req as AuthRequest).user?.id;
  if (!closedByUserId) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  shiftService
    .closeShift(req.params.id, closedByUserId, parsed.data.declaredCash)
    .then((shift) => res.json({ shift }))
    .catch((err: unknown) => handleError(res, err));
});

// ── GET /api/shifts/:id/prime-summary ─────────────────────────────────────────
// Read-only calculation: does NOT write to the database.
// Safe to call at any time, on any shift status.

router.get('/:id/prime-summary', (req: Request, res: Response) => {
  primeCalculationService
    .calculateShiftPrimeSummary(req.params.id)
    .then((summary) => res.json(summary))
    .catch((err: unknown) => handleError(res, err));
});

// ── POST /api/shifts/:id/recalculate-prime ────────────────────────────────────
// Calculates AND persists the prime snapshot to the Shift row.
// Returns the saved summary.

router.post('/:id/recalculate-prime', (req: Request, res: Response) => {
  shiftService
    .recalculateAndSaveShiftPrimeSummary(req.params.id)
    .then((summary) => res.json(summary))
    .catch((err: unknown) => handleError(res, err));
});

// ── POST /api/shifts/:id/bonus-adjustments ────────────────────────────────────
// Creates a ShiftBonusAdjustment, then recalculates and saves the prime summary.
// amount can be negative (deduction).

router.post('/:id/bonus-adjustments', (req: Request, res: Response) => {
  const parsed = bonusAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    res.status(400).json({ ok: false, error: msg });
    return;
  }

  const userId = (req as AuthRequest).user?.id;

  shiftService
    .addBonusAdjustment(req.params.id, userId, parsed.data.amount, parsed.data.reason)
    .then((summary) => res.status(201).json(summary))
    .catch((err: unknown) => handleError(res, err));
});

export default router;
