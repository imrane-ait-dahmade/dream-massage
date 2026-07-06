/**
 * Idempotent seed for dreamMassage — driven by prisma/seed-data/dream-massage-seed-data.json.
 *
 *   npm run prisma:seed            ← master data from JSON (no runtime history)
 *   npm run prisma:seed:clean      ← clean runtime data first, then seed
 *   npm run prisma:seed:staff-planning ← alias (staff/planning subset, same JSON)
 *
 * Optional env:
 *   SEED_ASSISTANT_USERS=true      ← create ASSISTANT logins (dev placeholder passwords)
 *   RESET_ASSISTANT_PASSWORDS=true ← overwrite assistant passwords (dev only)
 *   DEMO_DATA_ENABLED=true         ← include Demo Staff in roster (non-production only)
 *   CLEAN_RUNTIME_DATA=true        ← wipe sessions/shifts before seed
 *
 * Never seeds: shifts, chair_sessions, chair_events, device_logs, settings_audit_logs,
 * shift_bonus_adjustments.
 */

import { config } from 'dotenv';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { applyRawSqlConstraints, seedFromJson } from './seeds/seed-from-json';
import { DEMO_STAFF_ID } from './seeds/seed-data.loader';

config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '..', '.env'), override: false });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CLEAN_RUNTIME =
  process.argv.includes('--clean-runtime') ||
  process.env.CLEAN_RUNTIME_DATA === 'true';

const IS_PRODUCTION    = (process.env.NODE_ENV ?? 'development') === 'production';
const FORCE_CLEAN      = process.env.FORCE_CLEAN === 'true';
const DEMO_DATA_ENABLED = process.env.DEMO_DATA_ENABLED === 'true';
const SEED_DEMO_DATA    = !IS_PRODUCTION && DEMO_DATA_ENABLED;
const SEED_ASSISTANTS   = process.env.SEED_ASSISTANT_USERS === 'true';
const RESET_PASSWORDS   = process.env.RESET_ASSISTANT_PASSWORDS === 'true';

async function cleanRuntime(): Promise<void> {
  if (IS_PRODUCTION && !FORCE_CLEAN) {
    console.error('  ✗ REFUSED: --clean-runtime blocked in production.');
    process.exit(1);
  }
  console.log('── Cleaning runtime data ─────────────────────────────────────────');
  const { count: evCount } = await prisma.chairEvent.deleteMany({});
  console.log(`  ✓ Deleted chair events      : ${evCount}`);
  const { count: logCount } = await prisma.deviceLog.deleteMany({});
  console.log(`  ✓ Deleted device logs       : ${logCount}`);
  const { count: auditCount } = await prisma.settingsAuditLog.deleteMany({});
  console.log(`  ✓ Deleted audit log entries : ${auditCount}`);
  const { count: sessionCount } = await prisma.chairSession.deleteMany({});
  console.log(`  ✓ Deleted chair sessions    : ${sessionCount}`);
  const { count: shiftCount } = await prisma.shift.deleteMany({});
  console.log(`  ✓ Deleted shifts            : ${shiftCount}`);
  await prisma.chair.updateMany({
    data: {
      status: 'IDLE', currentSessionId: null, maybeActiveSince: null,
      maybeFinishedSince: null, stateChangedAt: null, statusBeforeOffline: null,
      offlineSince: null, lastOnlineAt: null, currentPowerWatts: null,
      relayIsOn: null, isOnline: false, lastSyncedAt: null,
    },
  });
  console.log('── Runtime clean done ────────────────────────────────────────────');
}

async function main(): Promise<void> {
  console.log('');
  console.log('  dreamMassage seed');
  console.log(`  mode: ${CLEAN_RUNTIME ? 'CLEAN-RUNTIME + seed' : 'seed only'}`);
  console.log(`  env : ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log(`  demo staff : ${SEED_DEMO_DATA ? 'included' : 'excluded'}`);
  console.log('');

  if (!process.env.DATABASE_URL) {
    console.error('  ✗ DATABASE_URL is not set.');
    process.exit(1);
  }

  if (CLEAN_RUNTIME) {
    await cleanRuntime();
    console.log('');
  }

  await seedFromJson(prisma, {
    isProduction: IS_PRODUCTION,
    includeDemoStaff: SEED_DEMO_DATA,
    seedAssistantUsers: SEED_ASSISTANTS,
    resetPasswords: RESET_PASSWORDS,
  });

  if (SEED_DEMO_DATA) {
    console.log(`── Demo staff (${DEMO_STAFF_ID}) included via DEMO_DATA_ENABLED ───`);
    console.log('');
  }

  await applyRawSqlConstraints(prisma);
  console.log('');
}

main()
  .catch((e: unknown) => {
    console.error('Seed failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
