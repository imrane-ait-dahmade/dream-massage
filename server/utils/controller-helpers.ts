import { z } from 'zod';
import type { Response } from 'express';

/**
 * Parse request body against a Zod schema.
 * Returns { ok: true, data } on success or { ok: false, error } with a
 * human-readable validation message on failure.
 * Shared across all settings controllers to avoid copy-paste.
 */
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data as z.output<S> };
  const msg = result.error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
  return { ok: false, error: msg };
}

/**
 * Send a structured error response, inferring status from the thrown error.
 * Recognises 400 / 404 / 409 via the `.status` property or message keywords.
 */
export function handleError(res: Response, err: unknown, fallbackMsg: string): void {
  if (err instanceof Error) {
    const status = (err as NodeJS.ErrnoException & { status?: number }).status;
    const msg = err.message.toLowerCase();
    if (status === 404 || msg.includes('not found') || msg.includes('introuvable')) {
      res.status(404).json({ ok: false, error: err.message });
      return;
    }
    if (status === 409 || msg.includes('already exists')) {
      res.status(409).json({ ok: false, error: err.message });
      return;
    }
    if (status === 400) {
      res.status(400).json({ ok: false, error: err.message });
      return;
    }
  }
  res.status(500).json({ ok: false, error: fallbackMsg, detail: String(err) });
}
