import { config } from 'dotenv';
import { join } from 'path';
import { z } from 'zod';

config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '..', '.env'), override: false });

const envSchema = z.object({
  PORT: z.string().default('4000').transform((v) => parseInt(v, 10)),
  APP_TIMEZONE: z.string().default('Africa/Casablanca'),
  SYNC_INTERVAL_MS: z.string().default('1000').transform((v) => parseInt(v, 10)),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('[env] Invalid environment configuration:');
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
