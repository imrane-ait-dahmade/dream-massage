import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { authService } from '../modules/auth/auth.service';
import type { AuthUser, UserRole } from '../modules/auth/auth.service';

export interface AuthRequest extends Request {
  user?: AuthUser;
}

function extractToken(req: Request): string | undefined {
  const fromCookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[env.COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

export function isOwnerOrAdmin(user: AuthUser | undefined): user is AuthUser {
  return user?.role === 'OWNER' || user?.role === 'ADMIN';
}

export function isAssistant(user: AuthUser | undefined): user is AuthUser {
  return user?.role === 'ASSISTANT';
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

export function requireRole(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthRequest).user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }
    next();
  };
}

/** Blocks ASSISTANT from owner/admin-only routes. */
export function requireOwnerAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isOwnerOrAdmin((req as AuthRequest).user)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  next();
}

/** Restricts route to ASSISTANT role only (e.g. GET /api/assistant/me). */
export function requireAssistant(req: Request, res: Response, next: NextFunction): void {
  if (!isAssistant((req as AuthRequest).user)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  next();
}

/**
 * Assistant routes readable by ASSISTANT (own data) or OWNER/ADMIN (preview).
 * Must be used after requireAuth.
 */
export function requireAssistantRouteAccess(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthRequest).user;
  if (!user) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  if (isAssistant(user) || isOwnerOrAdmin(user)) {
    next();
    return;
  }
  res.status(403).json({ ok: false, error: 'Forbidden' });
}
