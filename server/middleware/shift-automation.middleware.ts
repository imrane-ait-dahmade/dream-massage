import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

const HEADER_NAME = 'x-shift-automation-secret';

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Protects POST /api/shifts/automation/run for GitHub Actions / cron callers.
 * Does not log or echo the secret.
 */
export function requireShiftAutomationSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configured = env.SHIFT_AUTOMATION_SECRET;
  if (!configured) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  const provided = req.headers[HEADER_NAME];
  if (typeof provided !== 'string' || !secretsMatch(provided, configured)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  next();
}
