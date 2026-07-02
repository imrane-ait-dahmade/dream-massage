import { z } from 'zod';

const PASSWORD_MIN = 8;

// ── Create ─────────────────────────────────────────────────────────────────────

export const userCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    email: z.string().email().max(150),
    password: z.string().min(PASSWORD_MIN).max(255),
    role: z.enum(['OWNER', 'ADMIN', 'ASSISTANT']),
    staffMemberId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((d) => d.role !== 'ASSISTANT' || !!d.staffMemberId, {
    message: 'staffMemberId is required when role is ASSISTANT',
    path: ['staffMemberId'],
  });

export type UserCreateInput = z.infer<typeof userCreateSchema>;

// ── Update ─────────────────────────────────────────────────────────────────────
// Cross-field validation (role vs staffMemberId) needs the existing row when role
// isn't part of this particular PATCH — done in the service, not here.

export const userUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().max(150).optional(),
    role: z.enum(['OWNER', 'ADMIN', 'ASSISTANT']).optional(),
    staffMemberId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

// ── Password reset ─────────────────────────────────────────────────────────────

export const userPasswordResetSchema = z
  .object({
    password: z.string().min(PASSWORD_MIN).max(255),
  })
  .strict();

export type UserPasswordResetInput = z.infer<typeof userPasswordResetSchema>;
