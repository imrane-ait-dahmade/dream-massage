import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { authService } from '../modules/auth/auth.service';
import type { AuthUser } from '../modules/auth/auth.service';

// Extend Express Request to carry the authenticated user
export interface AuthRequest extends Request {
  user?: AuthUser;
}

function extractToken(req: Request): string | undefined {
  // 1. httpOnly cookie (preferred)
  const fromCookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[env.COOKIE_NAME];
  if (fromCookie) return fromCookie;
  // 2. Authorization: Bearer <token> fallback
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  const payload = authService.verifyToken(token);
  if (!payload?.sub) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  authService
    .getUserById(payload.sub)
    .then((user) => {
      if (!user) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      (req as AuthRequest).user = user;
      next();
    })
    .catch(() => {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
    });
}

// For future use — currently OWNER and ADMIN have the same access for MVP
export function requireRole(roles: Array<'OWNER' | 'ADMIN'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthRequest).user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }
    next();
  };
}
