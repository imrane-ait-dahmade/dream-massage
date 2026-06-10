import { env } from './env';

// Origins that are always allowed
const FIXED_ORIGINS = [env.FRONTEND_ORIGIN, 'http://localhost:3000'];

// In development, any localhost port is allowed so `next dev` can use 3001, 3002, etc.
const DEV_LOCALHOST = /^http:\/\/localhost:\d+$/;

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl / server-to-server — no Origin header
  if (FIXED_ORIGINS.includes(origin)) return true;
  if (env.NODE_ENV === 'development' && DEV_LOCALHOST.test(origin)) return true;
  return false;
}

/** Drop-in callback for cors() and Socket.IO cors.origin */
export function corsOriginFn(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`CORS: origin not allowed — ${origin ?? '(none)'}`));
  }
}
