/**
 * Idempotent seed for the dreamMassage MVP.
 * Safe to run multiple times — uses upsert/findFirst guards.
 *
 *   npm run prisma:seed            ← upsert base data only
 *   npm run prisma:seed:clean      ← clean runtime data first, then upsert
 *
 * The --clean-runtime flag (or CLEAN_RUNTIME_DATA=true) deletes:
 *   ChairEvent, DeviceLog, SettingsAuditLog, ChairSession, Shift
 * and resets chair runtime state before seeding base data.
 *
 * NEVER run --clean-runtime in production unless FORCE_CLEAN=true is also set.
 */

import { config } from 'dotenv';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

// Load .env from server/ first, then fall back to project root
config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '..', '.env'), override: false });

// ── Fixed IDs — must never change across runs for upsert stability ─────────────
const IDS = {
  owner:  '00000000-0000-0000-0000-000000000001',
  staff:  '00000000-0000-0000-0001-000000000001',
  plan20: '00000000-0000-0000-0002-000000000001',
  plan30: '00000000-0000-0000-0002-000000000002',
  plan40: '00000000-0000-0000-0002-000000000003',
  rule:   '00000000-0000-0000-0003-000000000001',
} as const;

// ── Prisma client (standalone, not the shared server/prisma.ts) ────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Flags ──────────────────────────────────────────────────────────────────────
const CLEAN_RUNTIME =
  process.argv.includes('--clean-runtime') ||
  process.env.CLEAN_RUNTIME_DATA === 'true';

const IS_PRODUCTION = (process.env.NODE_ENV ?? 'development') === 'production';
const FORCE_CLEAN   = process.env.FORCE_CLEAN === 'true';

// ── Clean runtime data ─────────────────────────────────────────────────────────

async function cleanRuntime(): Promise<void> {
  if (IS_PRODUCTION && !FORCE_CLEAN) {
    console.error('');
    console.error('  ✗ REFUSED: --clean-runtime is blocked in production.');
    console.error('    Set FORCE_CLEAN=true to override. Aborting.');
    console.error('');
    process.exit(1);
  }

  console.log('── Cleaning runtime data ─────────────────────────────────────────');

  // 1. ChairEvent references Chair + ChairSession — must go first
  const { count: evCount } = await prisma.chairEvent.deleteMany({});
  console.log(`  ✓ Deleted chair events      : ${evCount}`);

  // 2. DeviceLog references Chair (nullable FK) — safe after events
  const { count: logCount } = await prisma.deviceLog.deleteMany({});
  console.log(`  ✓ Deleted device logs       : ${logCount}`);

  // 3. SettingsAuditLog — references User only; safe to purge demo/test entries
  const { count: auditCount } = await prisma.settingsAuditLog.deleteMany({});
  console.log(`  ✓ Deleted audit log entries : ${auditCount}`);

  // 4. ChairSession — references Chair + Shift + PricingPlan; events already gone
  const { count: sessionCount } = await prisma.chairSession.deleteMany({});
  console.log(`  ✓ Deleted chair sessions    : ${sessionCount}`);

  // 5. Shift — references StaffMember + User; sessions already gone
  const { count: shiftCount } = await prisma.shift.deleteMany({});
  console.log(`  ✓ Deleted shifts            : ${shiftCount}`);

  // 6. Reset chair runtime state — Shelly sync will repopulate on next poll
  const { count: chairCount } = await prisma.chair.updateMany({
    data: {
      status:             'IDLE',
      currentSessionId:   null,
      maybeActiveSince:   null,
      maybeFinishedSince: null,
      stateChangedAt:     null,
      statusBeforeOffline: null,
      offlineSince:       null,
      lastOnlineAt:       null,
      currentPowerWatts:  null,
      relayIsOn:          null,
      isOnline:           false,
      lastSyncedAt:       null,
    },
  });
  console.log(`  ✓ Reset chair runtime state : ${chairCount} chair(s)`);
  console.log('── Runtime clean done ────────────────────────────────────────────');
}

// ── Upsert base data ───────────────────────────────────────────────────────────

async function seedBaseData(): Promise<void> {
  console.log('── Seeding base data ─────────────────────────────────────────────');

  // ── Owner user ──────────────────────────────────────────────────────────────
  // In dev: seed sets the dev password so login works immediately.
  // In production: never overwrite an existing password — only create if missing.
  // CHANGE THE PASSWORD before going to production.
  const DEV_PASSWORD = 'changeme123';
  const ownerHash = IS_PRODUCTION
    ? '$2b$10$PLACEHOLDER_CHANGE_BEFORE_PRODUCTION_00000000000000000'
    : await bcrypt.hash(DEV_PASSWORD, 10);

  const owner = await prisma.user.upsert({
    where:  { id: IDS.owner },
    update: IS_PRODUCTION ? {} : { passwordHash: ownerHash },
    create: {
      id:           IDS.owner,
      name:         'Owner',
      email:        'owner@example.com',
      passwordHash: ownerHash,
      role:         'OWNER',
      isActive:     true,
    },
  });
  console.log(`  ✓ Owner user   : ${owner.email} (${owner.role})`);
  if (!IS_PRODUCTION) {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────┐');
    console.log('  │  Owner login credentials (dev only)             │');
    console.log('  │  email    : owner@example.com                   │');
    console.log('  │  password : changeme123                         │');
    console.log('  │  Change before production!                      │');
    console.log('  └─────────────────────────────────────────────────┘');
    console.log('');
  }

  // ── Demo staff member ───────────────────────────────────────────────────────
  const staff = await prisma.staffMember.upsert({
    where:  { id: IDS.staff },
    update: {},
    create: {
      id:       IDS.staff,
      name:     'Demo Staff',
      isActive: true,
    },
  });
  console.log(`  ✓ Staff member : ${staff.name} (id: …${staff.id.slice(-8)})`);

  // ── Chairs F1–F5 ────────────────────────────────────────────────────────────
  // Device ID priority:
  //   1. SHELLY_DEVICE_Fx env var (real value, if present)
  //   2. Existing DB shellyDeviceId (keep it — never overwrite real IDs)
  //   3. Placeholder CHANGE_ME_Fx (only if chair is being created fresh)
  const chairDefs = [
    { name: 'F1', displayName: 'Fauteuil 1' },
    { name: 'F2', displayName: 'Fauteuil 2' },
    { name: 'F3', displayName: 'Fauteuil 3' },
    { name: 'F4', displayName: 'Fauteuil 4' },
    { name: 'F5', displayName: 'Fauteuil 5' },
  ] as const;

  for (const def of chairDefs) {
    const envDeviceId =
      process.env[`SHELLY_DEVICE_${def.name}`] ?? undefined;

    const existing = await prisma.chair.findUnique({
      where:  { name: def.name },
      select: { id: true, shellyDeviceId: true, isEnabled: true },
    });

    let chair: { id: string; name: string; displayName: string | null; shellyDeviceId: string };

    if (existing) {
      // Update displayName always; only update device ID if env provides one
      // AND the current value is still a placeholder (never overwrite a real ID
      // unless env explicitly provides a different real ID for migration).
      const isPlaceholder = existing.shellyDeviceId.startsWith('CHANGE_ME_');
      const updateDeviceId =
        envDeviceId !== undefined &&
        (isPlaceholder || existing.shellyDeviceId !== envDeviceId)
          ? envDeviceId
          : undefined;

      chair = await prisma.chair.update({
        where: { name: def.name },
        data: {
          displayName: def.displayName,
          ...(updateDeviceId !== undefined ? { shellyDeviceId: updateDeviceId } : {}),
        },
        select: { id: true, name: true, displayName: true, shellyDeviceId: true },
      });

      const deviceNote = updateDeviceId
        ? ` (device → ${updateDeviceId})`
        : ` (device unchanged: ${chair.shellyDeviceId.startsWith('CHANGE_ME') ? chair.shellyDeviceId : chair.shellyDeviceId.slice(0, 4) + '***'})`;
      console.log(`  ✓ Chair        : ${chair.name} (updated)${deviceNote}`);
    } else {
      const deviceIdForCreate = envDeviceId ?? `CHANGE_ME_${def.name}`;
      chair = await prisma.chair.create({
        data: {
          name:          def.name,
          displayName:   def.displayName,
          shellyDeviceId: deviceIdForCreate,
          shellyChannel: 0,
          status:        'IDLE',
          isOnline:      false,
          isEnabled:     true,
        },
        select: { id: true, name: true, displayName: true, shellyDeviceId: true },
      });
      const deviceNote = envDeviceId
        ? envDeviceId.slice(0, 4) + '***'
        : deviceIdForCreate;
      console.log(`  ✓ Chair        : ${chair.name} (created, device=${deviceNote})`);
    }

    // ── Detection config — create default only if no active config exists ──────
    const existingConfig = await prisma.chairDetectionConfig.findFirst({
      where: { chairId: chair.id, isActive: true },
    });
    if (!existingConfig) {
      await prisma.chairDetectionConfig.create({
        data: {
          chairId:               chair.id,
          startThresholdWatts:   7,
          stopThresholdWatts:    5,
          startConfirmSeconds:   30,
          stopConfirmSeconds:    180,
          activationDelaySeconds: 30,
          baselinePowerWatts:    2.1,
          isActive:              true,
          version:               1,
        },
      });
      console.log(`    └ Detection config created (v1, 7W start / 5W stop)`);
    } else {
      console.log(
        `    └ Detection config exists (v${existingConfig.version}, ` +
        `${existingConfig.startThresholdWatts}W start / ${existingConfig.stopThresholdWatts}W stop)`,
      );
    }
  }

  // ── Pricing plans ────────────────────────────────────────────────────────────
  const plan20 = await prisma.pricingPlan.upsert({
    where:  { id: IDS.plan20 },
    update: {},
    create: {
      id:              IDS.plan20,
      name:            '20 minutes',
      durationSeconds: 1200,
      priceAmount:     20,
      currency:        'MAD',
      isActive:        true,
      sortOrder:       1,
    },
  });

  await prisma.pricingPlan.upsert({
    where:  { id: IDS.plan30 },
    update: {},
    create: {
      id:              IDS.plan30,
      name:            '30 minutes',
      durationSeconds: 1800,
      priceAmount:     30,
      currency:        'MAD',
      isActive:        true,
      sortOrder:       2,
    },
  });

  await prisma.pricingPlan.upsert({
    where:  { id: IDS.plan40 },
    update: {},
    create: {
      id:              IDS.plan40,
      name:            '40 minutes',
      durationSeconds: 2400,
      priceAmount:     40,
      currency:        'MAD',
      isActive:        true,
      sortOrder:       3,
    },
  });
  console.log('  ✓ Pricing plans: 20 min/20 MAD, 30 min/30 MAD, 40 min/40 MAD');

  // ── Pricing rule ─────────────────────────────────────────────────────────────
  // Deactivate any other active rules BEFORE upserting the canonical one so that
  // the partial unique index unique_active_pricing_rule is never violated.
  const { count: deactivated } = await prisma.pricingRule.updateMany({
    where: { isActive: true, id: { not: IDS.rule } },
    data:  { isActive: false },
  });
  if (deactivated > 0) {
    console.log(`  ✓ Pricing rule : deactivated ${deactivated} non-canonical rule(s)`);
  }

  await prisma.pricingRule.upsert({
    where:  { id: IDS.rule },
    update: {
      minimumBillableSeconds: 180,
      overtimePolicy:         'ANOMALY',
      isActive:               true,
    },
    create: {
      id:                     IDS.rule,
      roundingMode:           'NEXT_PLAN',
      graceSeconds:           120,
      minimumBillableSeconds: 180,
      minimumPlanId:          plan20.id,
      overtimePolicy:         'ANOMALY',
      isActive:               true,
    },
  });

  console.log('  ✓ Pricing rule : NEXT_PLAN, grace 120s, min 180s, overtime ANOMALY, minimum = 20 min');

  // ── App settings ─────────────────────────────────────────────────────────────
  const appSettings = [
    {
      key:         'timezone',
      value:       'Africa/Casablanca',
      type:        'string',
      description: 'IANA timezone used for session timestamps and shift reporting',
    },
    {
      key:         'sync_interval_ms',
      value:       '1000',
      type:        'number',
      description: 'Shelly Cloud poll interval in milliseconds',
    },
    {
      key:         'default_currency',
      value:       'MAD',
      type:        'string',
      description: 'Default currency for pricing plans',
    },
  ];

  for (const s of appSettings) {
    await prisma.appSetting.upsert({
      where:  { key: s.key },
      update: {},
      create: s,
    });
  }
  console.log('  ✓ App settings : timezone, sync_interval_ms, default_currency');

  console.log('── Seed complete ─────────────────────────────────────────────────');
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('  dreamMassage seed');
  console.log(`  mode: ${CLEAN_RUNTIME ? 'CLEAN-RUNTIME + seed' : 'seed only'}`);
  console.log(`  env : ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log('');

  if (!process.env.DATABASE_URL) {
    console.error('  ✗ DATABASE_URL is not set. Load .env before running.');
    process.exit(1);
  }

  if (CLEAN_RUNTIME) {
    await cleanRuntime();
    console.log('');
  }

  await seedBaseData();
  console.log('');
}

main()
  .catch((e: unknown) => {
    console.error('Seed failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
