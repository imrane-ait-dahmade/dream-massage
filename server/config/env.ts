import { config } from 'dotenv';
import { join } from 'path';
import { z } from 'zod';

config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '..', '.env'), override: false });

const envSchema = z.object({
  PORT: z.string().default('4000').transform((v) => parseInt(v, 10)),
  APP_TIMEZONE: z.string().default('Africa/Casablanca'),
  // Job loop cadence. Default 5000 — was 1000 and caused ~60 dashboard DB reads/min.
  SYNC_INTERVAL_MS: z.string().default('5000').transform((v) => parseInt(v, 10)),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // ── Auth ──────────────────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('1095d'),
  COOKIE_NAME: z.string().default('dream_massage_token'),
  // COOKIE_SECURE=false for local dev, true for production (HTTPS required)
  COOKIE_SECURE: z.string().default('false').transform((v) => v === 'true'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  // Simulation flags — development/testing only, never set in production
  SIMULATION_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SIMULATION_FAST_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // How often to poll Shelly Cloud (ms). Must not imply a DB round-trip per tick.
  SHELLY_POLL_INTERVAL_MS: z
    .string()
    .default('5000')
    .transform((v) => parseInt(v, 10)),
  // Safety reload of chairs/sessions from DB (ms). Not every Shelly tick.
  SHELLY_DB_RECONCILE_INTERVAL_MS: z
    .string()
    .default('60000')
    .transform((v) => parseInt(v, 10)),
  // Flush aggregated min/max/avg power to DB at most this often per active chair.
  POWER_METRICS_FLUSH_INTERVAL_MS: z
    .string()
    .default('60000')
    .transform((v) => parseInt(v, 10)),
  // Short in-process cache for dashboard/home API responses.
  DASHBOARD_CACHE_TTL_MS: z
    .string()
    .default('15000')
    .transform((v) => parseInt(v, 10)),
  // Socket.IO heartbeat + client REST fallback cadence when WS is down.
  DASHBOARD_FALLBACK_REFRESH_MS: z
    .string()
    .default('60000')
    .transform((v) => parseInt(v, 10)),
  // Circuit breaker open duration after consecutive temporary DB errors.
  DB_ERROR_BACKOFF_MAX_MS: z
    .string()
    .default('60000')
    .transform((v) => parseInt(v, 10)),
  // ── Auto-shift job ────────────────────────────────────────────────────────────
  AUTO_SHIFT_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  AUTO_SHIFT_CHECK_INTERVAL_MS: z
    .string()
    .default('900000')
    .transform((v) => parseInt(v, 10)),
  ALLOW_MULTIPLE_OPEN_SHIFTS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // When true: assistants self-start shifts; auto-open from StaffSchedule is disabled.
  SELF_START_SHIFT_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  AUTO_SHIFT_SHOP_OPEN_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'AUTO_SHIFT_SHOP_OPEN_TIME must be HH:mm')
    .default('08:00'),
  AUTO_SHIFT_SHOP_CLOSE_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'AUTO_SHIFT_SHOP_CLOSE_TIME must be HH:mm')
    .default('23:45'),
  // Shared secret for automation endpoints (GitHub Actions, cron).
  CRON_SECRET: z.string().min(16).optional(),
  // Legacy alias — CRON_SECRET takes precedence when both are set.
  SHIFT_AUTOMATION_SECRET: z.string().min(16).optional(),
  // When true, shortens confirm windows for quicker session detection in tests.
  SESSION_TEST_FAST_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Shelly Cloud — optional; server starts without them but Shelly endpoints return 400
  SHELLY_AUTH_KEY: z.string().optional(),
  SHELLY_SERVER_URL: z.string().optional(),
  SHELLY_DEVICE_F1: z.string().optional(),
  SHELLY_DEVICE_F2: z.string().optional(),
  SHELLY_DEVICE_F3: z.string().optional(),
  SHELLY_DEVICE_F4: z.string().optional(),
  SHELLY_DEVICE_F5: z.string().optional(),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('[env] Invalid environment configuration:');
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

const parsed = result.data;

if (
  parsed.NODE_ENV === 'production' &&
  parsed.AUTO_SHIFT_ENABLED &&
  !parsed.CRON_SECRET &&
  !parsed.SHIFT_AUTOMATION_SECRET
) {
  console.error(
    '[env] Production with AUTO_SHIFT_ENABLED=true requires CRON_SECRET or SHIFT_AUTOMATION_SECRET',
  );
  process.exit(1);
}

export const env = parsed;

/** Resolved automation secret — CRON_SECRET preferred over legacy name. */
export function getCronSecret(): string | undefined {
  return env.CRON_SECRET ?? env.SHIFT_AUTOMATION_SECRET;
}
