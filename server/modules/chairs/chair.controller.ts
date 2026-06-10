import { Router } from 'express';
import type { Request, Response } from 'express';
import { chairDetailService } from './chair-detail.service';
import type { SessionFilters } from './chair-detail.service';

const router = Router();

// ── GET /api/chairs/:chairIdOrName/overview ────────────────────────────────────
// Accepts a chair UUID or a short name like F1, F2, F3, F4, F5.

router.get('/:chairIdOrName/overview', (req: Request, res: Response) => {
  const { chairIdOrName } = req.params;

  chairDetailService
    .getChairOverview(chairIdOrName)
    .then((overview) => {
      if (!overview) {
        res.status(404).json({ ok: false, error: 'Chair not found' });
        return;
      }
      res.json(overview);
    })
    .catch((err: unknown) => {
      res.status(500).json({
        ok: false,
        error: 'Failed to load chair overview',
        detail: String(err),
      });
    });
});

// ── GET /api/chairs/:chairIdOrName/sessions ────────────────────────────────────
// Query params: period (today|month|custom), from, to, page, limit, status

router.get('/:chairIdOrName/sessions', (req: Request, res: Response) => {
  const { chairIdOrName } = req.params;
  const { period, from, to, page, limit, status } = req.query;

  // Validate period
  if (period !== undefined && !['today', 'month', 'custom'].includes(String(period))) {
    res.status(400).json({ ok: false, error: 'Invalid period. Accepted: today, month, custom' });
    return;
  }

  // Validate page
  const pageNum = page !== undefined ? parseInt(String(page), 10) : 1;
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    res.status(400).json({ ok: false, error: 'Invalid page (must be an integer >= 1)' });
    return;
  }

  // Validate limit
  const limitNum = limit !== undefined ? parseInt(String(limit), 10) : 20;
  if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
    res.status(400).json({ ok: false, error: 'Invalid limit (1–100)' });
    return;
  }

  // period=custom requires at least one of from/to
  if (period === 'custom' && !from && !to) {
    res.status(400).json({ ok: false, error: 'period=custom requires from and/or to (YYYY-MM-DD)' });
    return;
  }

  const filters: SessionFilters = {
    period: period as SessionFilters['period'],
    from: from ? String(from) : undefined,
    to: to ? String(to) : undefined,
    page: pageNum,
    limit: limitNum,
    status: status ? String(status) : undefined,
  };

  chairDetailService
    .getChairSessions(chairIdOrName, filters)
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'Chair not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => {
      res.status(500).json({
        ok: false,
        error: 'Failed to load sessions',
        detail: String(err),
      });
    });
});

export default router;
