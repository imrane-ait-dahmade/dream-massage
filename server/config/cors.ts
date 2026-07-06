import { env } from './env';

// Origins that are always allowed
const FIXED_ORIGINS = [env.FRONTEND_ORIGIN, 'http://localhost:3000'];

// In development, localhost and common LAN IPs (Next.js "Network" URL) are allowed.
const DEV_LOCALHOST = /^http:\/\/localhost:\d+$/;
const DEV_LAN_ORIGIN =
  /^http:\/\/(127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+$/;

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl / server-to-server — no Origin header
  if (FIXED_ORIGINS.includes(origin)) return true;
  if (env.NODE_ENV === 'development' && DEV_LOCALHOST.test(origin)) return true;
  if (env.NODE_ENV === 'development' && DEV_LAN_ORIGIN.test(origin)) return true;
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
