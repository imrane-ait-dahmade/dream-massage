import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { maskDeviceId } from '../../utils/mask';
import type {
  ChairUpdateInput,
  DetectionConfigInput,
  PricingPlanCreateInput,
  PricingPlanUpdateInput,
  PricingRuleUpdateInput,
  StaffCreateInput,
  StaffUpdateInput,
} from './settings.types';

// ── Audit helper ───────────────────────────────────────────────────────────────

interface AuditParams {
  entityType: string;
  entityId?: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
}

// ── Service ────────────────────────────────────────────────────────────────────

class SettingsService {
  // TODO: Replace with authenticated user from JWT when auth is implemented.
  // Until then, use the first OWNER user as the audit actor.
  private async resolveAuditUserId(): Promise<string | null> {
    try {
      const owner = await prisma.user.findFirst({
        where: { role: 'OWNER', isActive: true },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      return owner?.id ?? null;
    } catch {
      return null;
    }
  }

  private async audit(params: AuditParams): Promise<void> {
    try {
      const userId = await this.resolveAuditUserId();
      await prisma.settingsAuditLog.create({
        data: {
          userId,
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          oldValue: params.oldValue != null ? (params.oldValue as Prisma.InputJsonValue) : undefined,
          newValue: params.newValue != null ? (params.newValue as Prisma.InputJsonValue) : undefined,
          reason: params.reason,
        },
      });
    } catch (err) {
      // Audit failure must never block the primary operation
      logger.warn('[settings] Audit log write failed:', String(err));
    }
  }

  // ── Chairs ────────────────────────────────────────────────────────────────────

  async getChairs() {
    const chairs = await prisma.chair.findMany({
      orderBy: { name: 'asc' },
      include: {
        detectionConfigs: {
          where: { isActive: true },
          take: 1,
          orderBy: { version: 'desc' },
        },
      },
    });

    return {
      items: chairs.map((c) => {
        const cfg = c.detectionConfigs[0] ?? null;
        return {
          id: c.id,
          name: c.name,
          displayName: c.displayName,
          shellyDeviceIdMasked: maskDeviceId(c.shellyDeviceId),
          shellyChannel: c.shellyChannel,
          status: c.status,
          isEnabled: c.isEnabled,
          isOnline: c.isOnline,
          currentPowerWatts: c.currentPowerWatts ?? 0,
          lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
          detectionConfig: cfg
            ? {
                id: cfg.id,
                startThresholdWatts: cfg.startThresholdWatts,
                stopThresholdWatts: cfg.stopThresholdWatts,
                startConfirmSeconds: cfg.startConfirmSeconds,
                stopConfirmSeconds: cfg.stopConfirmSeconds,
                activationDelaySeconds: cfg.activationDelaySeconds,
                baselinePowerWatts: cfg.baselinePowerWatts ?? null,
                version: cfg.version,
              }
            : null,
        };
      }),
    };
  }

  async updateChair(chairId: string, input: ChairUpdateInput) {
    const chair = await prisma.chair.findUnique({ where: { id: chairId } });
    if (!chair) return null;

    const oldValue = { displayName: chair.displayName, isEnabled: chair.isEnabled };

    // Build partial update — only include fields that were explicitly provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;

    const updated = await prisma.chair.update({ where: { id: chairId }, data });

    await this.audit({
      entityType: 'Chair',
      entityId: chairId,
      action: 'UPDATE',
      oldValue,
      newValue: { displayName: updated.displayName, isEnabled: updated.isEnabled },
    });

    return {
      id: updated.id,
      name: updated.name,
      displayName: updated.displayName,
      isEnabled: updated.isEnabled,
    };
  }

  async updateDetectionConfig(chairId: string, input: DetectionConfigInput) {
    const chair = await prisma.chair.findUnique({
      where: { id: chairId },
      include: {
        detectionConfigs: {
          where: { isActive: true },
          take: 1,
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!chair) return null;

    const now = new Date();
    const prevConfig = chair.detectionConfigs[0] ?? null;
    const newVersion = (prevConfig?.version ?? 0) + 1;

    // New config is picked up on the very next Shelly poll tick.
    // chair-state.service.processChairReading re-queries the active config on every
    // call — no server restart needed. A session already in progress continues
    // with the old config until the next state-machine evaluation.

    const newConfig = await prisma.$transaction(async (tx) => {
      // Deactivate the previous active config first
      if (prevConfig) {
        await tx.chairDetectionConfig.update({
          where: { id: prevConfig.id },
          data: { isActive: false, validTo: now },
        });
      }
      // Create the new versioned config
      return tx.chairDetectionConfig.create({
        data: {
          chairId,
          startThresholdWatts: input.startThresholdWatts,
          stopThresholdWatts: input.stopThresholdWatts,
          startConfirmSeconds: input.startConfirmSeconds,
          stopConfirmSeconds: input.stopConfirmSeconds,
          activationDelaySeconds: input.activationDelaySeconds,
          baselinePowerWatts: input.baselinePowerWatts ?? null,
          version: newVersion,
          isActive: true,
          validFrom: now,
        },
      });
    });

    await this.audit({
      entityType: 'ChairDetectionConfig',
      entityId: newConfig.id,
      action: 'CREATE',
      oldValue: prevConfig
        ? {
            id: prevConfig.id,
            version: prevConfig.version,
            startThresholdWatts: prevConfig.startThresholdWatts,
            stopThresholdWatts: prevConfig.stopThresholdWatts,
          }
        : null,
      newValue: {
        id: newConfig.id,
        version: newConfig.version,
        startThresholdWatts: newConfig.startThresholdWatts,
        stopThresholdWatts: newConfig.stopThresholdWatts,
      },
    });

    return {
      id: newConfig.id,
      chairId: newConfig.chairId,
      startThresholdWatts: newConfig.startThresholdWatts,
      stopThresholdWatts: newConfig.stopThresholdWatts,
      startConfirmSeconds: newConfig.startConfirmSeconds,
      stopConfirmSeconds: newConfig.stopConfirmSeconds,
      activationDelaySeconds: newConfig.activationDelaySeconds,
      baselinePowerWatts: newConfig.baselinePowerWatts ?? null,
      version: newConfig.version,
      isActive: newConfig.isActive,
      validFrom: newConfig.validFrom.toISOString(),
    };
  }

  // ── Pricing plans ─────────────────────────────────────────────────────────────

  async getPricingPlans() {
    const plans = await prisma.pricingPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { durationSeconds: 'asc' }],
    });

    return {
      items: plans.map((p) => ({
        id: p.id,
        name: p.name,
        durationSeconds: p.durationSeconds,
        priceAmount: Number(p.priceAmount),
        currency: p.currency,
        isActive: p.isActive,
        sortOrder: p.sortOrder,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  async createPricingPlan(input: PricingPlanCreateInput) {
    const plan = await prisma.pricingPlan.create({
      data: {
        name: input.name,
        durationSeconds: input.durationSeconds,
        priceAmount: input.priceAmount,
        currency: input.currency,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
    });

    await this.audit({
      entityType: 'PricingPlan',
      entityId: plan.id,
      action: 'CREATE',
      newValue: {
        name: plan.name,
        durationSeconds: plan.durationSeconds,
        priceAmount: Number(plan.priceAmount),
      },
    });

    return {
      id: plan.id,
      name: plan.name,
      durationSeconds: plan.durationSeconds,
      priceAmount: Number(plan.priceAmount),
      currency: plan.currency,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      createdAt: plan.createdAt.toISOString(),
    };
  }

  async updatePricingPlan(planId: string, input: PricingPlanUpdateInput) {
    const existing = await prisma.pricingPlan.findUnique({ where: { id: planId } });
    if (!existing) return null;

    const oldValue = {
      name: existing.name,
      durationSeconds: existing.durationSeconds,
      priceAmount: Number(existing.priceAmount),
      isActive: existing.isActive,
    };

    // Updating a plan does NOT recalculate old sessions — they keep their pricingSnapshot.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.durationSeconds !== undefined) data.durationSeconds = input.durationSeconds;
    if (input.priceAmount !== undefined) data.priceAmount = input.priceAmount;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const plan = await prisma.pricingPlan.update({ where: { id: planId }, data });

    await this.audit({
      entityType: 'PricingPlan',
      entityId: planId,
      action: 'UPDATE',
      oldValue,
      newValue: {
        name: plan.name,
        durationSeconds: plan.durationSeconds,
        priceAmount: Number(plan.priceAmount),
        isActive: plan.isActive,
      },
    });

    return {
      id: plan.id,
      name: plan.name,
      durationSeconds: plan.durationSeconds,
      priceAmount: Number(plan.priceAmount),
      currency: plan.currency,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      createdAt: plan.createdAt.toISOString(),
    };
  }

  // ── Pricing rule ──────────────────────────────────────────────────────────────

  private mapPricingRule(rule: (Awaited<ReturnType<typeof prisma.pricingRule.findFirst>> & {
    minimumPlan?: { id: string; name: string; durationSeconds: number; priceAmount: unknown } | null;
  }) | null) {
    if (!rule) return null;
    return {
      id: rule.id,
      roundingMode: rule.roundingMode,
      graceSeconds: rule.graceSeconds,
      minimumBillableSeconds: rule.minimumBillableSeconds,
      minimumPlanId: rule.minimumPlanId,
      overtimePolicy: rule.overtimePolicy,
      extraMinutePrice: rule.extraMinutePrice != null ? Number(rule.extraMinutePrice) : null,
      isActive: rule.isActive,
      minimumPlan: rule.minimumPlan
        ? {
            id: rule.minimumPlan.id,
            name: rule.minimumPlan.name,
            durationSeconds: rule.minimumPlan.durationSeconds,
            priceAmount: Number(rule.minimumPlan.priceAmount),
          }
        : null,
      createdAt: rule.createdAt.toISOString(),
    };
  }

  async getPricingRule() {
    const rule = await prisma.pricingRule.findFirst({
      where: { isActive: true },
      include: {
        minimumPlan: {
          select: { id: true, name: true, durationSeconds: true, priceAmount: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.mapPricingRule(rule);
  }

  async upsertPricingRule(input: PricingRuleUpdateInput) {
    const activeRules = await prisma.pricingRule.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    // Cleanup: if somehow multiple active rules exist, deactivate all but the latest
    if (activeRules.length > 1) {
      logger.warn(
        `[settings] ${activeRules.length} active pricing rules found — deactivating all except the latest`,
      );
      await prisma.pricingRule.updateMany({
        where: { id: { in: activeRules.slice(1).map((r) => r.id) } },
        data: { isActive: false },
      });
    }

    if (activeRules.length === 0) {
      // No rule yet — create one with provided values + safe defaults
      await prisma.pricingRule.create({
        data: {
          roundingMode:           input.roundingMode           ?? 'NEXT_PLAN',
          graceSeconds:           input.graceSeconds           ?? 120,
          minimumBillableSeconds: input.minimumBillableSeconds ?? 180,
          minimumPlanId:          input.minimumPlanId          ?? null,
          overtimePolicy:         input.overtimePolicy         ?? 'ANOMALY',
          extraMinutePrice:       input.extraMinutePrice       ?? null,
          isActive: true,
        },
      });
    } else {
      const existing = activeRules[0];

      const oldValue = {
        roundingMode:           existing.roundingMode,
        graceSeconds:           existing.graceSeconds,
        minimumBillableSeconds: existing.minimumBillableSeconds,
        overtimePolicy:         existing.overtimePolicy,
        extraMinutePrice: existing.extraMinutePrice != null ? Number(existing.extraMinutePrice) : null,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = {};
      if (input.roundingMode           !== undefined) data.roundingMode           = input.roundingMode;
      if (input.graceSeconds           !== undefined) data.graceSeconds           = input.graceSeconds;
      if (input.minimumBillableSeconds !== undefined) data.minimumBillableSeconds = input.minimumBillableSeconds;
      if (input.minimumPlanId          !== undefined) data.minimumPlanId          = input.minimumPlanId;
      if (input.overtimePolicy         !== undefined) data.overtimePolicy         = input.overtimePolicy;
      if (input.extraMinutePrice       !== undefined) data.extraMinutePrice       = input.extraMinutePrice;

      await prisma.pricingRule.update({ where: { id: existing.id }, data });

      await this.audit({
        entityType: 'PricingRule',
        entityId: existing.id,
        action: 'UPDATE',
        oldValue,
        newValue: {
          roundingMode:           input.roundingMode           ?? existing.roundingMode,
          graceSeconds:           input.graceSeconds           ?? existing.graceSeconds,
          minimumBillableSeconds: input.minimumBillableSeconds ?? existing.minimumBillableSeconds,
          overtimePolicy:         input.overtimePolicy         ?? existing.overtimePolicy,
        },
      });
    }

    // Re-fetch with join for consistent response shape
    return this.getPricingRule();
  }

  // ── Staff members ─────────────────────────────────────────────────────────────

  async getStaff() {
    const staff = await prisma.staffMember.findMany({
      orderBy: { name: 'asc' },
    });

    return {
      items: staff.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.phone ?? null,
        isActive: s.isActive,
        notes: s.notes ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  async createStaff(input: StaffCreateInput) {
    const staff = await prisma.staffMember.create({
      data: {
        name: input.name,
        phone: input.phone,
        notes: input.notes,
      },
    });

    await this.audit({
      entityType: 'StaffMember',
      entityId: staff.id,
      action: 'CREATE',
      newValue: { name: staff.name, phone: staff.phone },
    });

    return {
      id: staff.id,
      name: staff.name,
      phone: staff.phone ?? null,
      isActive: staff.isActive,
      notes: staff.notes ?? null,
      createdAt: staff.createdAt.toISOString(),
    };
  }

  async updateStaff(staffMemberId: string, input: StaffUpdateInput) {
    const existing = await prisma.staffMember.findUnique({ where: { id: staffMemberId } });
    if (!existing) return null;

    const oldValue = { name: existing.name, phone: existing.phone, isActive: existing.isActive };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.notes !== undefined) data.notes = input.notes;

    const staff = await prisma.staffMember.update({ where: { id: staffMemberId }, data });

    await this.audit({
      entityType: 'StaffMember',
      entityId: staffMemberId,
      action: 'UPDATE',
      oldValue,
      newValue: { name: staff.name, phone: staff.phone, isActive: staff.isActive },
    });

    return {
      id: staff.id,
      name: staff.name,
      phone: staff.phone ?? null,
      isActive: staff.isActive,
      notes: staff.notes ?? null,
      createdAt: staff.createdAt.toISOString(),
    };
  }

  // ── System info ───────────────────────────────────────────────────────────────

  async getSystemInfo() {
    let dbConnected = false;
    try {
      await prisma.$executeRaw`SELECT 1`;
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    const chairNames = ['F1', 'F2', 'F3', 'F4', 'F5'] as const;
    const devices = chairNames.map((name) => {
      const raw = env[`SHELLY_DEVICE_${name}` as keyof typeof env] as string | undefined;
      return {
        chairName: name,
        deviceIdConfigured: !!raw,
        deviceIdMasked: maskDeviceId(raw),
      };
    });

    return {
      appTimezone: env.APP_TIMEZONE,
      syncIntervalMs: env.SYNC_INTERVAL_MS,
      simulationEnabled: env.SIMULATION_ENABLED,
      shelly: {
        serverUrlConfigured: !!env.SHELLY_SERVER_URL,
        authKeyConfigured: !!env.SHELLY_AUTH_KEY,
        // Never return SHELLY_AUTH_KEY or the full device IDs
        devices,
      },
      database: {
        connected: dbConnected,
      },
    };
  }
}

export const settingsService = new SettingsService();
