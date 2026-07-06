/**
 * Shared Prisma client + environment guards for standalone seed scripts.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '..', '.env'), override: false });

export const IS_PRODUCTION = (process.env.NODE_ENV ?? 'development') === 'production';

export function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    console.error('  ✗ DATABASE_URL is not set. Load .env before running.');
    process.exit(1);
  }
}

export function assertStaffPlanningSeedAllowed(): void {
  if (IS_PRODUCTION && process.env.ALLOW_STAFF_PLANNING_SEED !== 'true') {
    console.error('');
    console.error('  ✗ REFUSED: staff-planning seed is blocked in production.');
    console.error('    Set ALLOW_STAFF_PLANNING_SEED=true to override (upsert only, no wipe).');
    console.error('');
    process.exit(1);
  }
}

export function createSeedPrisma(): { prisma: PrismaClient; pool: Pool } {
  requireDatabaseUrl();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}
