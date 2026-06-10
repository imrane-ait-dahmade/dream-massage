import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from './auth.service';
import { requireAuth } from '../../middleware/auth.middleware';
import type { AuthRequest } from '../../middleware/auth.middleware';
import { env } from '../../config/env';

const router = Router();

// Three years in milliseconds (matches JWT_EXPIRES_IN = 1095d)
const COOKIE_MAX_AGE_MS = 1095 * 24 * 60 * 60 * 1000;

function setCookie(res: Response, token: string): void {
  res.cookie(env.COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

function clearCookie(res: Response): void {
  res.clearCookie(env.COOKIE_NAME, { path: '/' });
}

// ── POST /api/auth/login ───────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Email et mot de passe requis' });
    return;
  }

  const { email, password } = parsed.data;

  authService
    .login(email, password)
    .then((result) => {
      if (!result) {
        res.status(401).json({ ok: false, error: 'Email ou mot de passe incorrect' });
        return;
      }
      setCookie(res, result.token);
      res.json({ ok: true, user: result.user });
    })
    .catch(() => {
      res.status(500).json({ ok: false, error: 'Erreur serveur' });
    });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = (req as AuthRequest).user!;
  res.json({ ok: true, user });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', (req: Request, res: Response) => {
  clearCookie(res);
  res.json({ ok: true });
});

export default router;
