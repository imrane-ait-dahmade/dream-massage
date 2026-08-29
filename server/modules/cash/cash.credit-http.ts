/**
 * Pure HTTP validation for admin cash credit (no Express / DB).
 * Run via: npm run test:cash
 */
import { z } from 'zod';

/**
 * Admin POST /credit body — amount + optional reason only.
 * Rejects type, references, balance fields, created_by from client.
 */
export const adminCreditBodySchema = z
  .object({
    amount: z.number().finite().positive(),
    reason: z.string().max(500).optional(),
    /** Optional attribution — does not own the till balance. */
    staffMemberId: z.string().min(1).optional(),
  })
  .strict();

export type AdminCreditBody = z.infer<typeof adminCreditBodySchema>;

export function parseAdminCreditBody(body: unknown): {
  ok: true;
  value: AdminCreditBody;
} | {
  ok: false;
  error: string;
} {
  const parsed = adminCreditBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: 'Payload invalide' };
  }
  return { ok: true, value: parsed.data };
}
