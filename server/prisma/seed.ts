/**
 * Idempotent seed for the dreamMassage MVP.
 * Safe to run multiple times — uses upsert with fixed IDs where possible.
 *
 * Run: npm run prisma:seed
 *
 * To generate a real passwordHash for the owner:
 *   node -e "const b=require('bcryptjs');b.hash('yourpassword',10).then(console.log)"
 * (install bcryptjs first: npm install bcryptjs)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// ── Fixed IDs so upserts are stable across runs ────────────────────────────────
const IDS = {
  owner: '00000000-0000-0000-0000-000000000001',
  staff: '00000000-0000-0000-0001-000000000001',
  plan20: '00000000-0000-0000-0002-000000000001',
  plan30: '00000000-0000-0000-0002-000000000002',
  plan40: '00000000-0000-0000-0002-000000000003',
} as const;

// ── Prisma client (seed runs standalone, not via server/prisma.ts) ─────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  console.log('── Seeding database ──────────────────────────────────────────────');

  // ── Owner user ───────────────────────────────────────────────────────────────
  // DEV placeholder — NOT a valid bcrypt hash; server will reject login until replaced.
  // Generate: node -e "const b=require('bcryptjs');b.hash('changeme',10).then(console.log)"
  const DEV_PASSWORD_HASH = '$2b$10$DEV_PLACEHOLDER_REPLACE_BEFORE_PRODUCTION_00000000000';

  const owner = await prisma.user.upsert({
    where: { id: IDS.owner },
    update: {},
    create: {
      id: IDS.owner,
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'OWNER',
      isActive: true,
    },
  });
  console.log(`✓ Owner user   : ${owner.email} (role: ${owner.role})`);

  // ── Demo staff member ────────────────────────────────────────────────────────
  const staff = await prisma.staffMember.upsert({
    where: { id: IDS.staff },
    update: {},
    create: {
      id: IDS.staff,
      name: 'Demo Staff',
      isActive: true,
    },
  });
  console.log(`✓ Staff member : ${staff.name}`);

  // ── Chairs F1–F5 + detection configs ────────────────────────────────────────
  const chairDefs = [
    { name: 'F1', displayName: 'Fauteuil 1', shellyDeviceId: 'CHANGE_ME_F1' },
    { name: 'F2', displayName: 'Fauteuil 2', shellyDeviceId: 'CHANGE_ME_F2' },
    { name: 'F3', displayName: 'Fauteuil 3', shellyDeviceId: 'CHANGE_ME_F3' },
    { name: 'F4', displayName: 'Fauteuil 4', shellyDeviceId: 'CHANGE_ME_F4' },
    { name: 'F5', displayName: 'Fauteuil 5', shellyDeviceId: 'CHANGE_ME_F5' },
  ];

  for (const def of chairDefs) {
    const chair = await prisma.chair.upsert({
      where: { name: def.name },
      update: {},
      create: {
        name: def.name,
        displayName: def.displayName,
        shellyDeviceId: def.shellyDeviceId,
        shellyChannel: 0,
        status: 'IDLE',
        isOnline: false,
        isEnabled: true,
      },
    });
    console.log(`✓ Chair        : ${chair.name} (${chair.displayName})`);

    const existingConfig = await prisma.chairDetectionConfig.findFirst({
      where: { chairId: chair.id, isActive: true },
    });
    if (!existingConfig) {
      await prisma.chairDetectionConfig.create({
        data: {
          chairId: chair.id,
          startThresholdWatts: 7,
          stopThresholdWatts: 5,
          startConfirmSeconds: 30,
          stopConfirmSeconds: 180,
          activationDelaySeconds: 30,
          baselinePowerWatts: 2.1,
          isActive: true,
          version: 1,
        },
      });
      console.log(`  └ Detection config created for ${chair.name}`);
    } else {
      console.log(`  └ Detection config already exists for ${chair.name}`);
    }
  }

  // ── Pricing plans ────────────────────────────────────────────────────────────
  const plan20 = await prisma.pricingPlan.upsert({
    where: { id: IDS.plan20 },
    update: {},
    create: {
      id: IDS.plan20,
      name: '20 minutes',
      durationSeconds: 1200,
      priceAmount: 20,
      currency: 'MAD',
      isActive: true,
      sortOrder: 1,
    },
  });

  await prisma.pricingPlan.upsert({
    where: { id: IDS.plan30 },
    update: {},
    create: {
      id: IDS.plan30,
      name: '30 minutes',
      durationSeconds: 1800,
      priceAmount: 30,
      currency: 'MAD',
      isActive: true,
      sortOrder: 2,
    },
  });

  await prisma.pricingPlan.upsert({
    where: { id: IDS.plan40 },
    update: {},
    create: {
      id: IDS.plan40,
      name: '40 minutes',
      durationSeconds: 2400,
      priceAmount: 40,
      currency: 'MAD',
      isActive: true,
      sortOrder: 3,
    },
  });
  console.log('✓ Pricing plans: 20 min (20 MAD), 30 min (30 MAD), 40 min (40 MAD)');

  // ── Pricing rule ─────────────────────────────────────────────────────────────
  const activeRule = await prisma.pricingRule.findFirst({ where: { isActive: true } });
  if (!activeRule) {
    await prisma.pricingRule.create({
      data: {
        roundingMode: 'NEXT_PLAN',
        graceSeconds: 120,
        minimumPlanId: plan20.id,
        overtimePolicy: 'NEXT_PLAN',
        isActive: true,
      },
    });
    console.log('✓ Pricing rule : NEXT_PLAN, grace 120s, minimum = 20 min');
  } else {
    console.log('✓ Pricing rule : already exists, skipped');
  }

  // ── App settings ─────────────────────────────────────────────────────────────
  const settings = [
    {
      key: 'timezone',
      value: 'Africa/Casablanca',
      type: 'string',
      description: 'IANA timezone used for session timestamps and shift reporting',
    },
    {
      key: 'sync_interval_ms',
      value: '1000',
      type: 'number',
      description: 'Shelly Cloud poll interval in milliseconds',
    },
    {
      key: 'default_currency',
      value: 'MAD',
      type: 'string',
      description: 'Default currency for pricing plans',
    },
  ];

  for (const s of settings) {
    await prisma.appSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }
  console.log('✓ App settings : timezone, sync_interval_ms, default_currency');

  console.log('── Seed complete ─────────────────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
