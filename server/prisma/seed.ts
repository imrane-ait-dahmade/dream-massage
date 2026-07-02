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
  owner:     '00000000-0000-0000-0000-000000000001',
  assistant: '00000000-0000-0000-0000-000000000002',
  staff:     '00000000-0000-0000-0001-000000000001',
  plan20: '00000000-0000-0000-0002-000000000001',
  plan30: '00000000-0000-0000-0002-000000000002',
  plan40: '00000000-0000-0000-0002-000000000003',
  rule:   '00000000-0000-0000-0003-000000000001',
  // ── Shift types ──
  shiftTypeMatin:   '00000000-0000-0000-0004-000000000001',
  shiftTypeSoir:    '00000000-0000-0000-0004-000000000002',
  shiftTypeJournee: '00000000-0000-0000-0004-000000000003',
  // ── Target bonus rules ──
  bonusRuleMatin: '00000000-0000-0000-0005-000000000001',
  bonusRuleSoir:  '00000000-0000-0000-0005-000000000002',
  // ── Example commission rule (inactive until owner confirms) ──
  commRule30: '00000000-0000-0000-0006-000000000001',
  // ── Real staff members (no login, no User record) ──
  fille1: '00000000-0000-0000-0001-000000000002',
  fille2: '00000000-0000-0000-0001-000000000003',
} as const;

// ── Prisma client (standalone, not the shared server/prisma.ts) ────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Flags ──────────────────────────────────────────────────────────────────────
const CLEAN_RUNTIME =
  process.argv.includes('--clean-runtime') ||
  process.env.CLEAN_RUNTIME_DATA === 'true';

const IS_PRODUCTION    = (process.env.NODE_ENV ?? 'development') === 'production';
const FORCE_CLEAN      = process.env.FORCE_CLEAN === 'true';
const SEED_SHIFT_TABLE = process.env.SEED_SHIFT_TABLE === 'true';

// ── Initial weekly shift planning ──────────────────────────────────────────────
// Edit this table to change the seeded planning.
// Day numbers: 1=Lundi, 2=Mardi, 3=Mercredi, 4=Jeudi, 5=Vendredi, 6=Samedi, 7=Dimanche
// shiftTypeName must be null when isOff=true.

const INITIAL_WEEKLY_SHIFT_TABLE: Array<{
  staffName:     string;
  dayOfWeek:     number;
  shiftTypeName: 'MATIN' | 'SOIR' | 'JOURNEE' | null;
  isOff:         boolean;
}> = [
  // ── Fille 1 ─────────────────────────────────────────────────────────────────
  { staffName: 'Fille 1', dayOfWeek: 1, shiftTypeName: 'SOIR',    isOff: false },
  { staffName: 'Fille 1', dayOfWeek: 2, shiftTypeName: 'JOURNEE', isOff: false },
  { staffName: 'Fille 1', dayOfWeek: 3, shiftTypeName: 'MATIN',   isOff: false },
  { staffName: 'Fille 1', dayOfWeek: 4, shiftTypeName: null,      isOff: true  },
  { staffName: 'Fille 1', dayOfWeek: 5, shiftTypeName: 'SOIR',    isOff: false },
  { staffName: 'Fille 1', dayOfWeek: 6, shiftTypeName: 'MATIN',   isOff: false },
  { staffName: 'Fille 1', dayOfWeek: 7, shiftTypeName: 'SOIR',    isOff: false },
  // ── Fille 2 ─────────────────────────────────────────────────────────────────
  { staffName: 'Fille 2', dayOfWeek: 1, shiftTypeName: 'MATIN',   isOff: false },
  { staffName: 'Fille 2', dayOfWeek: 2, shiftTypeName: null,      isOff: true  },
  { staffName: 'Fille 2', dayOfWeek: 3, shiftTypeName: 'SOIR',    isOff: false },
  { staffName: 'Fille 2', dayOfWeek: 4, shiftTypeName: 'JOURNEE', isOff: false },
  { staffName: 'Fille 2', dayOfWeek: 5, shiftTypeName: 'MATIN',   isOff: false },
  { staffName: 'Fille 2', dayOfWeek: 6, shiftTypeName: 'SOIR',    isOff: false },
  { staffName: 'Fille 2', dayOfWeek: 7, shiftTypeName: 'MATIN',   isOff: false },
];

// Maps the human-readable shiftTypeName above to the fixed DB UUID.
// These IDs must match what seedPrimeData inserts.
const SHIFT_TYPE_IDS: Record<'MATIN' | 'SOIR' | 'JOURNEE', string> = {
  MATIN:   IDS.shiftTypeMatin,
  SOIR:    IDS.shiftTypeSoir,
  JOURNEE: IDS.shiftTypeJournee,
};

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

  // ── Demo assistant (read-only, linked to Fille 1) ───────────────────────────
  const fille1 = await prisma.staffMember.upsert({
    where:  { id: IDS.fille1 },
    update: { isActive: true, name: 'Fille 1' },
    create: { id: IDS.fille1, name: 'Fille 1', isActive: true },
  });

  const ASSISTANT_DEV_PASSWORD = 'assistant123';
  const assistantHash = IS_PRODUCTION
    ? '$2b$10$PLACEHOLDER_CHANGE_BEFORE_PRODUCTION_00000000000000001'
    : await bcrypt.hash(ASSISTANT_DEV_PASSWORD, 10);

  const assistant = await prisma.user.upsert({
    where:  { id: IDS.assistant },
    update: IS_PRODUCTION
      ? { staffMemberId: fille1.id }
      : { passwordHash: assistantHash, staffMemberId: fille1.id },
    create: {
      id:            IDS.assistant,
      name:          fille1.name,
      email:         'assistant@example.com',
      passwordHash:  assistantHash,
      role:          'ASSISTANT',
      staffMemberId: fille1.id,
      isActive:      true,
    },
  });
  console.log(`  ✓ Assistant user: ${assistant.email} (${assistant.role}) → ${fille1.name}`);
  if (!IS_PRODUCTION) {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────┐');
    console.log('  │  Assistant login credentials (dev only)         │');
    console.log('  │  email    : assistant@example.com               │');
    console.log('  │  password : assistant123                        │');
    console.log('  │  staff    : Fille 1 (read-only dashboard)       │');
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

// ── Prime / commission seed data ───────────────────────────────────────────────

async function seedPrimeData(): Promise<void> {
  console.log('── Seeding prime/commission data ─────────────────────────────────');

  // ── Shift types ─────────────────────────────────────────────────────────────
  // update clause corrects old lowercase names and the SOIR label in existing DBs.
  await prisma.shiftType.upsert({
    where:  { id: IDS.shiftTypeMatin },
    update: { name: 'MATIN', label: 'Matin',      startTime: '10:00', endTime: '15:00', isActive: true, sortOrder: 1 },
    create: { id: IDS.shiftTypeMatin,   name: 'MATIN',   label: 'Matin',      startTime: '10:00', endTime: '15:00', isActive: true, sortOrder: 1 },
  });

  await prisma.shiftType.upsert({
    where:  { id: IDS.shiftTypeSoir },
    update: { name: 'SOIR', label: 'Après-midi', startTime: '15:00', endTime: '22:00', isActive: true, sortOrder: 2 },
    create: { id: IDS.shiftTypeSoir,    name: 'SOIR',    label: 'Après-midi', startTime: '15:00', endTime: '22:00', isActive: true, sortOrder: 2 },
  });

  await prisma.shiftType.upsert({
    where:  { id: IDS.shiftTypeJournee },
    update: { name: 'JOURNEE', label: 'Journée', startTime: '10:00', endTime: '22:00', isActive: true, sortOrder: 3 },
    create: { id: IDS.shiftTypeJournee, name: 'JOURNEE', label: 'Journée',    startTime: '10:00', endTime: '22:00', isActive: true, sortOrder: 3 },
  });

  console.log('  ✓ Shift types  : MATIN (10:00–15:00), SOIR/Après-midi (15:00–22:00), JOURNEE (10:00–22:00)');

  // ── Target bonus rules ───────────────────────────────────────────────────────
  // isActive=true — these are reasonable business defaults.
  // Owner activates/edits from settings UI; these serve as ready-to-use examples.
  await prisma.shiftTargetBonusRule.upsert({
    where:  { id: IDS.bonusRuleMatin },
    update: {},
    create: {
      id:           IDS.bonusRuleMatin,
      shiftTypeId:  IDS.shiftTypeMatin,
      targetAmount: 500,
      bonusAmount:  50,
      isActive:     true,
    },
  });

  await prisma.shiftTargetBonusRule.upsert({
    where:  { id: IDS.bonusRuleSoir },
    update: {},
    create: {
      id:           IDS.bonusRuleSoir,
      shiftTypeId:  IDS.shiftTypeSoir,
      targetAmount: 1000,
      bonusAmount:  100,
      isActive:     true,
    },
  });

  console.log('  ✓ Bonus rules  : Matin ≥500→50 MAD, Soir ≥1000→100 MAD (isActive=true)');

  // ── Example commission rule — INACTIVE until owner confirms ──────────────────
  // Seeded for the 30-minute plan (IDS.plan30) as a starting point.
  // The owner must activate this rule from Settings → Primes before it takes effect.
  // Rationale: we do not know the owner's agreed commission rate; activating an
  // incorrect rule would silently generate wrong prime calculations.
  await prisma.commissionRule.upsert({
    where:  { id: IDS.commRule30 },
    update: {},
    create: {
      id:            IDS.commRule30,
      pricingPlanId: IDS.plan30,
      type:          'PERCENTAGE',
      value:         10,
      isActive:      false,   // owner must review and activate from settings
    },
  });

  console.log('  ✓ Commission   : 30 min plan → 10% example rule (isActive=false, needs owner activation)');
  console.log('── Prime seed complete ────────────────────────────────────────────');
}

// ── Partial unique indexes (raw SQL — Prisma cannot express WHERE clauses) ─────

async function applyRawSqlConstraints(): Promise<void> {
  console.log('── Applying raw SQL constraints ──────────────────────────────────');

  const indexes: Array<{ name: string; sql: string }> = [
    {
      name: 'unique_active_session_per_chair',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_active_session_per_chair
              ON chair_sessions (chair_id) WHERE status = 'ACTIVE'`,
    },
    {
      name: 'unique_active_detection_config_per_chair',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_active_detection_config_per_chair
              ON chair_detection_configs (chair_id) WHERE is_active = true`,
    },
    {
      name: 'unique_active_pricing_rule',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_active_pricing_rule
              ON pricing_rules (is_active) WHERE is_active = true`,
    },
    {
      name: 'unique_open_shift',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_open_shift
              ON shifts (status) WHERE status = 'OPEN'`,
    },
    {
      name: 'unique_active_staff_schedule_per_day',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_active_staff_schedule_per_day
              ON staff_schedules (staff_member_id, day_of_week) WHERE is_active = true`,
    },
    {
      name: 'unique_auto_shift_per_schedule_day',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_auto_shift_per_schedule_day
              ON shifts (staff_schedule_id, business_date)
              WHERE staff_schedule_id IS NOT NULL AND business_date IS NOT NULL`,
    },
  ];

  for (const idx of indexes) {
    try {
      await prisma.$executeRawUnsafe(idx.sql);
      console.log(`  ✓ Index : ${idx.name}`);
    } catch (err) {
      // Index already exists with the same definition — safe to ignore.
      // Any real error (e.g. existing duplicate data) will surface here.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists')) {
        console.log(`  · Index : ${idx.name} (already exists)`);
      } else {
        console.warn(`  ⚠ Index : ${idx.name} — ${msg}`);
      }
    }
  }

  console.log('── Constraints done ──────────────────────────────────────────────');
}

// ── Weekly shift planning seed (opt-in, controlled by SEED_SHIFT_TABLE=true) ───

async function seedShiftTable(): Promise<void> {
  console.log('── Seeding weekly shift planning ─────────────────────────────────');

  // ── Staff members (real employees, no login) ─────────────────────────────────
  const fille1 = await prisma.staffMember.upsert({
    where:  { id: IDS.fille1 },
    update: { isActive: true },
    create: { id: IDS.fille1, name: 'Fille 1', isActive: true },
  });
  const fille2 = await prisma.staffMember.upsert({
    where:  { id: IDS.fille2 },
    update: { isActive: true },
    create: { id: IDS.fille2, name: 'Fille 2', isActive: true },
  });
  console.log(`  ✓ Staff : ${fille1.name} (id: …${fille1.id.slice(-8)})`);
  console.log(`  ✓ Staff : ${fille2.name} (id: …${fille2.id.slice(-8)}) — no login`);

  // ── Verify shift types exist (seeded by seedPrimeData) ──────────────────────
  const stCount = await prisma.shiftType.count({
    where: { id: { in: Object.values(SHIFT_TYPE_IDS) } },
  });
  if (stCount < 3) {
    console.error(
      `  ✗ Only ${stCount}/3 shift types found by ID. ` +
      `Run base seed first (seedPrimeData seeds them).`,
    );
    return;
  }

  // Build name → ID map from fixed IDs (avoids any name-casing issues)
  const staffIdMap: Record<string, string> = {
    'Fille 1': fille1.id,
    'Fille 2': fille2.id,
  };

  const DAY_LABELS: Record<number, string> = {
    1: 'Lundi', 2: 'Mardi', 3: 'Mercredi',
    4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi', 7: 'Dimanche',
  };

  let deactivated = 0;
  let created     = 0;
  let skipped     = 0;

  for (const entry of INITIAL_WEEKLY_SHIFT_TABLE) {
    // ── Validate ────────────────────────────────────────────────────────────
    if (entry.dayOfWeek < 1 || entry.dayOfWeek > 7) {
      console.warn(`  ⚠ Invalid dayOfWeek=${entry.dayOfWeek} for ${entry.staffName} — skipped`);
      skipped++;
      continue;
    }

    const staffId = staffIdMap[entry.staffName];
    if (!staffId) {
      console.warn(`  ⚠ Unknown staffName="${entry.staffName}" — skipped`);
      skipped++;
      continue;
    }

    if (!entry.isOff && entry.shiftTypeName === null) {
      console.warn(
        `  ⚠ shiftTypeName required when isOff=false ` +
        `(${entry.staffName} / ${DAY_LABELS[entry.dayOfWeek]}) — skipped`,
      );
      skipped++;
      continue;
    }

    const shiftTypeId = entry.shiftTypeName ? SHIFT_TYPE_IDS[entry.shiftTypeName] : null;

    // ── Deactivate existing active schedule for same staff + day ─────────────
    const { count } = await prisma.staffSchedule.updateMany({
      where: { staffMemberId: staffId, dayOfWeek: entry.dayOfWeek, isActive: true },
      data:  { isActive: false },
    });
    deactivated += count;

    // ── Create new active row ────────────────────────────────────────────────
    await prisma.staffSchedule.create({
      data: {
        staffMemberId: staffId,
        shiftTypeId:   shiftTypeId ?? null,
        dayOfWeek:     entry.dayOfWeek,
        isOff:         entry.isOff,
        isActive:      true,
        notes:         'Planification initiale — généré par le seed',
      },
    });
    created++;

    const shiftLabel = entry.isOff ? 'OFF' : entry.shiftTypeName ?? '?';
    console.log(`  · ${entry.staffName} ${DAY_LABELS[entry.dayOfWeek]}: ${shiftLabel}`);
  }

  if (deactivated > 0) {
    console.log(`  · Deactivated ${deactivated} previous active schedule row(s)`);
  }
  if (skipped > 0) {
    console.log(`  ⚠ Skipped ${skipped} invalid entr${skipped === 1 ? 'y' : 'ies'}`);
  }
  console.log(`  ✓ Created ${created} schedule entries`);
  console.log('── Shift planning seed done ──────────────────────────────────────');
}

// ── Demo schedule (opt-in, never overwrites) ───────────────────────────────────

async function seedDemoSchedule(): Promise<void> {
  console.log('── Seeding demo schedule ─────────────────────────────────────────');

  // Only create entries if none exist at all (fully idempotent — never wipes data)
  const existingCount = await prisma.staffSchedule.count();
  if (existingCount > 0) {
    console.log(`  · Staff schedules already exist (${existingCount} rows). Skipping.`);
    console.log('── Demo schedule skipped ─────────────────────────────────────────');
    return;
  }

  // Assign Demo Staff to MATIN shift on Monday (day 1)
  await prisma.staffSchedule.create({
    data: {
      staffMemberId: IDS.staff,
      shiftTypeId:   IDS.shiftTypeMatin,
      dayOfWeek:     1,     // Monday
      isOff:         false,
      isActive:      true,
      notes:         'Exemple — généré par le seed',
    },
  });

  console.log('  ✓ Demo schedule: Demo Staff → Matin, Lundi');
  console.log('── Demo schedule done ────────────────────────────────────────────');
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('  dreamMassage seed');
  console.log(`  mode: ${CLEAN_RUNTIME ? 'CLEAN-RUNTIME + seed' : 'seed only'}`);
  console.log(`  env : ${IS_PRODUCTION ? 'production' : 'development'}`);
  if (SEED_SHIFT_TABLE) {
    console.log('  SEED_SHIFT_TABLE=true — weekly planning will be seeded');
  }
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
  await seedPrimeData();
  console.log('');
  await applyRawSqlConstraints();
  console.log('');

  if (SEED_SHIFT_TABLE) {
    await seedShiftTable();
    console.log('');
  }

  if (process.env.SEED_DEMO_SCHEDULE === 'true') {
    await seedDemoSchedule();
    console.log('');
  }
}

main()
  .catch((e: unknown) => {
    console.error('Seed failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
