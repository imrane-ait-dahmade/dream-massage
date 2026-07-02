import { Router } from 'express';
import type { Request, Response } from 'express';
import { userSettingsService } from './user-settings.service';
import { userCreateSchema, userUpdateSchema, userPasswordResetSchema } from './user-settings.types';
import { parseBody, handleError } from '../../utils/controller-helpers';
import type { AuthRequest } from '../../middleware/auth.middleware';

const router = Router();

function userId(req: Request): string | undefined {
  return (req as AuthRequest).user?.id;
}

// GET /api/settings/users
router.get('/', (_req: Request, res: Response) => {
  userSettingsService
    .getUsers()
    .then((data) => res.json(data))
    .catch((err: unknown) => handleError(res, err, 'Failed to load users'));
});

// POST /api/settings/users
router.post('/', (req: Request, res: Response) => {
  const parsed = parseBody(userCreateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  userSettingsService
    .createUser(parsed.data, userId(req))
    .then((user) => res.status(201).json(user))
    .catch((err: unknown) => handleError(res, err, 'Failed to create user'));
});

// PATCH /api/settings/users/:id
router.patch('/:id', (req: Request, res: Response) => {
  const parsed = parseBody(userUpdateSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    return;
  }
  userSettingsService
    .updateUser(req.params.id, parsed.data, userId(req))
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'User not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to update user'));
});

// PATCH /api/settings/users/:id/password
router.patch('/:id/password', (req: Request, res: Response) => {
  const parsed = parseBody(userPasswordResetSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  userSettingsService
    .resetPassword(req.params.id, parsed.data, userId(req))
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'User not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to reset password'));
});

// PATCH /api/settings/users/:id/disable
router.patch('/:id/disable', (req: Request, res: Response) => {
  userSettingsService
    .disableUser(req.params.id, userId(req))
    .then((result) => {
      if (!result) {
        res.status(404).json({ ok: false, error: 'User not found' });
        return;
      }
      res.json(result);
    })
    .catch((err: unknown) => handleError(res, err, 'Failed to disable user'));
});

export default router;
