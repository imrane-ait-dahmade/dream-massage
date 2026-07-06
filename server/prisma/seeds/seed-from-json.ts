/**
 * Idempotent master-data seed driven by prisma/seed-data/dream-massage-seed-data.json.
 * Never seeds runtime/historical tables (shifts, sessions, events, logs, audit).
 */
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { findShiftTypeOverlapError } from '../../modules/settings/shift-time-ranges';
import {
  buildPlanningSlots,
  CANONICAL_SHIFT_HOURS,
  JOURNEE_SHIFT_TYPE_ID,
  loadSeedData,
  MATIN_SHIFT_TYPE_ID,
  rosterStaffIds,
  SOIR_SHIFT_TYPE_ID,
} from './seed-data.loader';

const DEV_OWNER_PASSWORD = 'changeme123';
const DEV_ASSISTANT_PASSWORD = 'changeme123';

const DAY_LABELS: Record<number, string> = {
  1: 'Lundi', 2: 'Mardi', 3: 'Mercredi',
  4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi', 7: 'Dimanche',
};

export type SeedFromJsonOptions = {
  isProduction: boolean;
  seedAssistantUsers: boolean;
  resetPasswords: boolean;
};

export async function seedFromJson(
  prisma: PrismaClient,
  options: SeedFromJsonOptions,
): Promise<void> {
  const data = loadSeedData();
  const roster = rosterStaffIds(data);

  console.log(`  source : ${data.source.dump_file} (${data.source.generated_at_utc})`);
  console.log('');

  await seedOwnerUser(prisma, data, options);
  await seedAppSettings(prisma, data);
  await seedChairs(prisma, data);
  await seedChairDetectionConfigs(prisma, data);
  await seedPricingPlans(prisma, data);
  await seedPricingRules(prisma, data);
  await seedShiftTypes(prisma, data);
  await seedBonusRules(prisma, data);
  await seedCommissionRules(prisma, data);
  await seedStaffMembers(prisma, data, roster);
  await seedAssistantUsers(prisma, data, options);
  await seedWeeklyPlanning(prisma, data, roster);
}

async function seedOwnerUser(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
  options: SeedFromJsonOptions,
): Promise<void> {
  console.log('── Users ─────────────────────────────────────────────────────────');

  const ownerHash = options.isProduction
    ? '$2b$10$PLACEHOLDER_CHANGE_BEFORE_PRODUCTION_00000000000000000'
    : await bcrypt.hash(DEV_OWNER_PASSWORD, 10);

  const ownerRow = data.seedData.usersSanitized.find((u) => u.role !== 'ASSISTANT');
  if (ownerRow) {
    const role = ownerRow.role === 'OWNER' ? 'OWNER' : ownerRow.role === 'ADMIN' ? 'ADMIN' : 'OWNER';
    await prisma.user.upsert({
      where:  { id: ownerRow.id },
      update: options.isProduction ? { email: ownerRow.email, name: ownerRow.name, role, isActive: true } : {
        email: ownerRow.email, name: ownerRow.name, role, isActive: true, passwordHash: ownerHash,
      },
      create: {
        id: ownerRow.id, name: ownerRow.name, email: ownerRow.email,
        passwordHash: ownerHash, role, isActive: true,
      },
    });
    console.log(`  ✓ ${role} user : ${ownerRow.email}`);
    if (!options.isProduction) {
      console.log(`    password (dev): ${DEV_OWNER_PASSWORD}`);
    }
  }
  console.log('');
}

async function seedAssistantUsers(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
  options: SeedFromJsonOptions,
): Promise<void> {
  if (!options.seedAssistantUsers) {
    console.log('── Assistant users ─────────────────────────────────────────────');
    console.log('  · Skipped (SEED_ASSISTANT_USERS not set)');
    console.log('');
    return;
  }

  console.log('── Assistant users ─────────────────────────────────────────────');
  const assistantHash = await bcrypt.hash(DEV_ASSISTANT_PASSWORD, 10);

  for (const user of data.seedData.usersSanitized.filter((u) => u.role === 'ASSISTANT')) {
    const staffId = user.staff_member_id;
    if (!staffId) {
      console.warn(`  ⚠ Assistant ${user.email}: invalid staff link — skipped`);
      continue;
    }
    const staff = await prisma.staffMember.findUnique({ where: { id: staffId } });
    if (!staff) {
      console.warn(`  ⚠ Assistant ${user.email}: staff ${staffId} missing — skipped`);
      continue;
    }
    const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } });
    const setPassword = !options.isProduction && (options.resetPasswords || !existing);
    await prisma.user.upsert({
      where:  { id: user.id },
      update: {
        name: user.name, email: user.email, role: 'ASSISTANT',
        staffMemberId: staffId, isActive: true,
        ...(setPassword ? { passwordHash: assistantHash } : {}),
      },
      create: {
        id: user.id, name: user.name, email: user.email,
        passwordHash: assistantHash, role: 'ASSISTANT',
        staffMemberId: staffId, isActive: true,
      },
    });
    console.log(`  ✓ ${user.email} → ${staff.name}`);
  }
  if (!options.isProduction) {
    console.log(`    password (dev): ${DEV_ASSISTANT_PASSWORD}`);
  }
  console.log('');
}

async function seedAppSettings(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
): Promise<void> {
  console.log('── App settings ────────────────────────────────────────────────');
  for (const s of data.seedData.appSettings) {
    await prisma.appSetting.upsert({
      where:  { key: s.key },
      update: { value: s.value, type: s.type, description: s.description },
      create: {
        id: s.id, key: s.key, value: s.value, type: s.type, description: s.description,
      },
    });
    console.log(`  ✓ ${s.key}`);
  }
  console.log('');
}

async function seedChairs(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
): Promise<void> {
  console.log('── Chairs ──────────────────────────────────────────────────────');
  for (const c of data.seedData.chairs) {
    const envDeviceId = process.env[`SHELLY_DEVICE_${c.name}`];
    const existing = await prisma.chair.findUnique({
      where:  { name: c.name },
      select: { shellyDeviceId: true },
    });
    const deviceId = envDeviceId ?? existing?.shellyDeviceId ?? c.shelly_device_id;

    await prisma.chair.upsert({
      where:  { id: c.id },
      update: {
        name: c.name,
        displayName: c.display_name,
        shellyDeviceId: deviceId,
        shellyChannel: c.shelly_channel,
        isEnabled: c.is_enabled,
        status: 'IDLE',
        isOnline: false,
        currentPowerWatts: null,
        relayIsOn: null,
        lastSyncedAt: null,
        currentSessionId: null,
        maybeActiveSince: null,
        maybeFinishedSince: null,
        stateChangedAt: null,
        statusBeforeOffline: null,
        offlineSince: null,
        lastOnlineAt: null,
      },
      create: {
        id: c.id,
        name: c.name,
        displayName: c.display_name,
        shellyDeviceId: deviceId,
        shellyChannel: c.shelly_channel,
        isEnabled: c.is_enabled,
        status: 'IDLE',
        isOnline: false,
      },
    });
    const masked = deviceId.length > 6 ? `${deviceId.slice(0, 4)}***` : deviceId;
    console.log(`  ✓ ${c.name} (${masked})`);
  }
  console.log('');
}

async function seedChairDetectionConfigs(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
): Promise<void> {
  console.log('── Chair detection configs ─────────────────────────────────────');
  const activeByChair = new Map<string, (typeof data.seedData.chairDetectionConfigs)[0]>();
  for (const cfg of data.seedData.chairDetectionConfigs) {
    if (!cfg.is_active) continue;
    const prev = activeByChair.get(cfg.chair_id);
    if (!prev || cfg.version > prev.version) {
      activeByChair.set(cfg.chair_id, cfg);
    }
  }

  for (const cfg of activeByChair.values()) {
    const existing = await prisma.chairDetectionConfig.findFirst({
      where: { chairId: cfg.chair_id, isActive: true },
    });
    if (existing && existing.id !== cfg.id) {
      await prisma.chairDetectionConfig.update({
        where: { id: existing.id },
        data:  { isActive: false, validTo: new Date() },
      });
    }

    await prisma.chairDetectionConfig.upsert({
      where:  { id: cfg.id },
      update: {
        startThresholdWatts:   parseFloat(cfg.start_threshold_watts),
        stopThresholdWatts:    parseFloat(cfg.stop_threshold_watts),
        startConfirmSeconds:   cfg.start_confirm_seconds,
        stopConfirmSeconds:    cfg.stop_confirm_seconds,
        activationDelaySeconds: cfg.activation_delay_seconds,
        baselinePowerWatts:    cfg.baseline_power_watts ? parseFloat(cfg.baseline_power_watts) : null,
        isActive: true,
        version: cfg.version,
      },
      create: {
        id: cfg.id,
        chairId: cfg.chair_id,
        startThresholdWatts:   parseFloat(cfg.start_threshold_watts),
        stopThresholdWatts:    parseFloat(cfg.stop_threshold_watts),
        startConfirmSeconds:   cfg.start_confirm_seconds,
        stopConfirmSeconds:    cfg.stop_confirm_seconds,
        activationDelaySeconds: cfg.activation_delay_seconds,
        baselinePowerWatts:    cfg.baseline_power_watts ? parseFloat(cfg.baseline_power_watts) : null,
        isActive: true,
        version: cfg.version,
      },
    });
    const chair = data.seedData.chairs.find((c) => c.id === cfg.chair_id);
    console.log(
      `  ✓ ${chair?.name ?? cfg.chair_id} v${cfg.version} ` +
      `(${cfg.start_threshold_watts}W / ${cfg.stop_threshold_watts}W)`,
    );
  }
  console.log('');
}

async function seedPricingPlans(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
): Promise<void> {
  console.log('── Pricing plans ───────────────────────────────────────────────');
  for (const p of data.seedData.pricingPlans) {
    await prisma.pricingPlan.upsert({
      where:  { id: p.id },
      update: {
        name: p.name,
        durationSeconds: p.duration_seconds,
        priceAmount: parseFloat(p.price_amount),
        currency: p.currency,
        isActive: p.is_active,
        sortOrder: p.sort_order,
        archivedAt: null,
      },
      create: {
        id: p.id,
        name: p.name,
        durationSeconds: p.duration_seconds,
        priceAmount: parseFloat(p.price_amount),
        currency: p.currency,
        isActive: p.is_active,
        sortOrder: p.sort_order,
      },
    });
    console.log(`  ✓ ${p.name} — ${p.price_amount} ${p.currency}`);
  }
  console.log('');
}

async function seedPricingRules(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
): Promise<void> {
  console.log('── Pricing rules ───────────────────────────────────────────────');
  const activeRules = data.seedData.pricingRules.filter((r) => r.is_active);
  for (const rule of activeRules) {
    await prisma.pricingRule.updateMany({
      where: { isActive: true, id: { not: rule.id } },
      data:  { isActive: false },
    });
    await prisma.pricingRule.upsert({
      where:  { id: rule.id },
      update: {
        roundingMode: rule.rounding_mode as 'NEXT_PLAN',
        graceSeconds: rule.grace_seconds,
        minimumBillableSeconds: rule.minimum_billable_seconds,
        minimumPlanId: rule.minimum_plan_id,
        overtimePolicy: rule.overtime_policy as 'ANOMALY',
        isActive: true,
      },
      create: {
        id: rule.id,
        roundingMode: rule.rounding_mode as 'NEXT_PLAN',
        graceSeconds: rule.grace_seconds,
        minimumBillableSeconds: rule.minimum_billable_seconds,
        minimumPlanId: rule.minimum_plan_id,
        overtimePolicy: rule.overtime_policy as 'ANOMALY',
        isActive: true,
      },
    });
    console.log(`  ✓ ${rule.rounding_mode}, grace ${rule.grace_seconds}s, min ${rule.minimum_billable_seconds}s`);
  }
  console.log('');
}

async function seedShiftTypes(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
): Promise<void> {
  console.log('── Shift types (hours normalized to 08:00–15:00 / 15:00–23:45) ─');
  const matin = CANONICAL_SHIFT_HOURS.MATIN;
  const soir = CANONICAL_SHIFT_HOURS.SOIR;

  const overlapErr = findShiftTypeOverlapError(
    { id: MATIN_SHIFT_TYPE_ID, name: 'MATIN', startTime: matin.startTime, endTime: matin.endTime },
    [{ id: SOIR_SHIFT_TYPE_ID, name: 'SOIR', startTime: soir.startTime, endTime: soir.endTime, isActive: true }],
  );
  if (overlapErr) throw new Error(overlapErr);

  for (const [id, hours, name, sortOrder] of [
    [MATIN_SHIFT_TYPE_ID, matin, 'MATIN', 1],
    [SOIR_SHIFT_TYPE_ID, soir, 'SOIR', 2],
  ] as const) {
    const fromDump = data.seedData.shiftTypes.find((st) => st.id === id);
    await prisma.shiftType.upsert({
      where:  { id },
      update: {
        name,
        label: hours.label,
        startTime: hours.startTime,
        endTime: hours.endTime,
        isActive: true,
        sortOrder,
        archivedAt: null,
      },
      create: {
        id, name, label: hours.label,
        startTime: hours.startTime, endTime: hours.endTime,
        isActive: true, sortOrder,
      },
    });
    const dumpHours = fromDump ? ` (dump: ${fromDump.start_time}–${fromDump.end_time})` : '';
    console.log(`  ✓ ${name} ${hours.startTime}–${hours.endTime}${dumpHours}`);
  }

  const journee = data.seedData.shiftTypes.find((st) => st.id === JOURNEE_SHIFT_TYPE_ID);
  if (journee) {
    await prisma.shiftType.upsert({
      where:  { id: JOURNEE_SHIFT_TYPE_ID },
      update: { name: 'JOURNEE', label: journee.label, isActive: false, sortOrder: 99 },
      create: {
        id: JOURNEE_SHIFT_TYPE_ID,
        name: 'JOURNEE',
        label: journee.label ?? 'Journée',
        startTime: journee.start_time,
        endTime: journee.end_time,
        isActive: false,
        sortOrder: 99,
      },
    });
    console.log('  ✓ JOURNEE désactivé (FK historique uniquement)');
  }
  console.log('');
}

async function seedBonusRules(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
): Promise<void> {
  console.log('── Target bonus rules ──────────────────────────────────────────');
  for (const rule of data.seedData.shiftTargetBonusRules) {
    await prisma.shiftTargetBonusRule.upsert({
      where:  { id: rule.id },
      update: {
        shiftTypeId: rule.shift_type_id,
        targetAmount: parseFloat(rule.target_amount),
        bonusAmount: parseFloat(rule.bonus_amount),
        isActive: rule.is_active,
      },
      create: {
        id: rule.id,
        shiftTypeId: rule.shift_type_id,
        targetAmount: parseFloat(rule.target_amount),
        bonusAmount: parseFloat(rule.bonus_amount),
        isActive: rule.is_active,
      },
    });
  }
  console.log('  ✓ Bonus rules upserted');
  console.log('');
}

async function seedCommissionRules(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
): Promise<void> {
  console.log('── Commission rules ────────────────────────────────────────────');
  for (const rule of data.seedData.commissionRules) {
    await prisma.commissionRule.upsert({
      where:  { id: rule.id },
      update: {
        pricingPlanId: rule.pricing_plan_id,
        type: rule.type as 'PERCENTAGE',
        value: parseFloat(rule.value),
        isActive: rule.is_active,
      },
      create: {
        id: rule.id,
        pricingPlanId: rule.pricing_plan_id,
        type: rule.type as 'PERCENTAGE',
        value: parseFloat(rule.value),
        isActive: rule.is_active,
      },
    });
    const plan = data.seedData.pricingPlans.find((p) => p.id === rule.pricing_plan_id);
    console.log(`  ✓ ${plan?.name ?? rule.pricing_plan_id} — ${rule.value}% (active=${rule.is_active})`);
  }
  console.log('');
}

async function seedStaffMembers(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
  roster: Set<string>,
): Promise<void> {
  console.log('── Staff members ───────────────────────────────────────────────');
  for (const staff of data.seedData.staffMembers) {
    if (!roster.has(staff.id)) continue;
    await prisma.staffMember.upsert({
      where:  { id: staff.id },
      update: {
        name: staff.name,
        phone: staff.phone,
        notes: staff.notes,
        isActive: staff.is_active,
        archivedAt: null,
        archiveReason: null,
      },
      create: {
        id: staff.id,
        name: staff.name,
        phone: staff.phone,
        notes: staff.notes,
        isActive: staff.is_active,
      },
    });
    console.log(`  ✓ ${staff.name}`);
  }
  console.log('');
}

async function seedWeeklyPlanning(
  prisma: PrismaClient,
  data: ReturnType<typeof loadSeedData>,
  roster: Set<string>,
): Promise<void> {
  console.log('── Weekly planning ───────────────────────────────────────────');

  await prisma.staffSchedule.updateMany({
    where: { shiftTypeId: JOURNEE_SHIFT_TYPE_ID, isActive: true, archivedAt: null },
    data:  { isActive: false },
  });

  const slots = buildPlanningSlots(data, roster);
  let created = 0;
  let unchanged = 0;

  const staffNameById = new Map(
    data.seedData.staffMembers.map((s) => [s.id, s.name]),
  );

  for (const slot of slots) {
    const result = await upsertPlanningSlot(prisma, slot);
    if (result === 'created') created++;
    else unchanged++;

    const shiftLabel = slot.isOff
      ? 'OFF'
      : slot.shiftTypeId === MATIN_SHIFT_TYPE_ID
        ? 'MATIN'
        : slot.shiftTypeId === SOIR_SHIFT_TYPE_ID
          ? 'SOIR'
          : '?';
    console.log(
      `  · ${staffNameById.get(slot.staffMemberId) ?? slot.staffMemberId} ` +
      `${DAY_LABELS[slot.dayOfWeek]}: ${shiftLabel}`,
    );
  }

  console.log(`  ✓ ${created} created, ${unchanged} unchanged (${slots.length} slots)`);
  console.log('');
}

async function upsertPlanningSlot(
  prisma: PrismaClient,
  slot: { staffMemberId: string; dayOfWeek: number; shiftTypeId: string | null; isOff: boolean },
): Promise<'created' | 'unchanged'> {
  const existing = await prisma.staffSchedule.findFirst({
    where: {
      staffMemberId: slot.staffMemberId,
      dayOfWeek:     slot.dayOfWeek,
      isOff:         slot.isOff,
      shiftTypeId:   slot.isOff ? null : slot.shiftTypeId,
      isActive:      true,
      archivedAt:    null,
    },
  });

  if (existing) {
    if (existing.startTime !== null || existing.endTime !== null) {
      await prisma.staffSchedule.update({
        where: { id: existing.id },
        data:  { startTime: null, endTime: null },
      });
    }
    return 'unchanged';
  }

  await prisma.staffSchedule.create({
    data: {
      staffMemberId: slot.staffMemberId,
      shiftTypeId:   slot.isOff ? null : slot.shiftTypeId,
      dayOfWeek:     slot.dayOfWeek,
      startTime:     null,
      endTime:       null,
      isOff:         slot.isOff,
      isActive:      true,
      notes:         'Planification — seed JSON',
    },
  });
  return 'created';
}

export async function applyRawSqlConstraints(prisma: PrismaClient): Promise<void> {
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
      name: 'drop_unique_active_staff_schedule_per_day',
      sql: `DROP INDEX IF EXISTS unique_active_staff_schedule_per_day`,
    },
    {
      name: 'unique_active_staff_schedule_per_day_period',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_active_staff_schedule_per_day_period
              ON staff_schedules (staff_member_id, day_of_week, shift_type_id)
              WHERE is_active = true AND is_off = false AND shift_type_id IS NOT NULL`,
    },
    {
      name: 'unique_active_staff_off_per_day',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS unique_active_staff_off_per_day
              ON staff_schedules (staff_member_id, day_of_week)
              WHERE is_active = true AND is_off = true`,
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
