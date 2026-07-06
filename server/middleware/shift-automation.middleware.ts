import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getCronSecret } from '../config/env';

const LEGACY_HEADER = 'x-shift-automation-secret';
const CRON_HEADER   = 'x-cron-secret';

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractProvidedSecret(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  const cronHeader = req.headers[CRON_HEADER];
  if (typeof cronHeader === 'string') return cronHeader;
  const legacyHeader = req.headers[LEGACY_HEADER];
  if (typeof legacyHeader === 'string') return legacyHeader;
  return undefined;
}

/**
 * Protects cron/automation endpoints (GitHub Actions, external schedulers).
 * Accepts Authorization: Bearer, x-cron-secret, or legacy x-shift-automation-secret.
 */
export function requireCronSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configured = getCronSecret();
  if (!configured) {
    res.status(503).json({
      ok:    false,
      error: 'Automation secret not configured (set CRON_SECRET or SHIFT_AUTOMATION_SECRET)',
    });
    return;
  }

  const provided = extractProvidedSecret(req);
  if (!provided || !secretsMatch(provided, configured)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  next();
}

/** @deprecated Use requireCronSecret */
export const requireShiftAutomationSecret = requireCronSecret;
