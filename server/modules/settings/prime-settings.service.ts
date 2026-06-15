import { Prisma } from '@prisma/client';
import type { ShiftType } from '@prisma/client';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import type {
  ShiftTypeCreateInput,
  ShiftTypeUpdateInput,
  CommissionRuleCreateInput,
  CommissionRuleUpdateInput,
  TargetBonusRuleCreateInput,
  TargetBonusRuleUpdateInput,
} from './prime-settings.types';

// ── Payload types (Prisma relations included) ──────────────────────────────────

type CommissionRuleWithPlan = Prisma.CommissionRuleGetPayload<{
  include: { plan: { select: { id: true; name: true; priceAmount: true } } };
}>;

type TargetBonusRuleWithType = Prisma.ShiftTargetBonusRuleGetPayload<{
  include: { shiftType: { select: { id: true; name: true; label: true } } };
}>;

// ── Mappers ────────────────────────────────────────────────────────────────────

function mapShiftType(st: ShiftType) {
  return {
    id:        st.id,
    name:      st.name,
    label:     st.label ?? null,
    startTime: st.startTime,
    endTime:   st.endTime,
    isActive:  st.isActive,
    sortOrder: st.sortOrder,
    createdAt: st.createdAt.toISOString(),
  };
}

function mapCommissionRule(rule: CommissionRuleWithPlan) {
  return {
    id:               rule.id,
    pricingPlanId:    rule.pricingPlanId,
    pricingPlanName:  rule.plan.name,
    pricingPlanPrice: Number(rule.plan.priceAmount),
    type:             rule.type,
    value:            Number(rule.value),
    isActive:         rule.isActive,
    validFrom:        rule.validFrom.toISOString(),
    validTo:          rule.validTo?.toISOString() ?? null,
    createdAt:        rule.createdAt.toISOString(),
  };
}

function mapTargetBonusRule(rule: TargetBonusRuleWithType) {
  return {
    id:             rule.id,
    shiftTypeId:    rule.shiftTypeId,
    shiftTypeLabel: rule.shiftType.label ?? rule.shiftType.name,
    targetAmount:   Number(rule.targetAmount),
    bonusAmount:    Number(rule.bonusAmount),
    isActive:       rule.isActive,
    validFrom:      rule.validFrom.toISOString(),
    validTo:        rule.validTo?.toISOString() ?? null,
    createdAt:      rule.createdAt.toISOString(),
  };
}

// ── Audit ──────────────────────────────────────────────────────────────────────

interface AuditParams {
  entityType: string;
  entityId?:  string;
  action:     string;
  oldValue?:  unknown;
  newValue?:  unknown;
  reason?:    string;
}

// ── Service ────────────────────────────────────────────────────────────────────

class PrimeSettingsService {
  // If userId is provided (from req.user), use it.
  // Otherwise fall back to the first active OWNER for the audit trail.
  // TODO: remove fallback once auth is enforced on all callers.
  private async resolveAuditUserId(userId?: string): Promise<string | null> {
    if (userId) return userId;
    try {
      const owner = await prisma.user.findFirst({
        where:   { role: 'OWNER', isActive: true },
        select:  { id: true },
        orderBy: { createdAt: 'asc' },
      });
      return owner?.id ?? null;
    } catch {
      return null;
    }
  }

  private async audit(params: AuditParams, userId?: string): Promise<void> {
    try {
      const resolvedId = await this.resolveAuditUserId(userId);
      await prisma.settingsAuditLog.create({
        data: {
          userId:     resolvedId,
          entityType: params.entityType,
          entityId:   params.entityId,
          action:     params.action,
          oldValue:   params.oldValue != null ? (params.oldValue as Prisma.InputJsonValue) : undefined,
          newValue:   params.newValue != null ? (params.newValue as Prisma.InputJsonValue) : undefined,
          reason:     params.reason,
        },
      });
    } catch (err) {
      logger.warn('[prime-settings] Audit log write failed:', String(err));
    }
  }

  // ── A. Shift Types ─────────────────────────────────────────────────────────────

  async getShiftTypes() {
    const items = await prisma.shiftType.findMany({ orderBy: { sortOrder: 'asc' } });
    return { items: items.map(mapShiftType) };
  }

  async createShiftType(input: ShiftTypeCreateInput, userId?: string) {
    const existing = await prisma.shiftType.findUnique({ where: { name: input.name } });
    if (existing) {
      throw Object.assign(
        new Error(`Shift type with name "${input.name}" already exists`),
        { status: 409 },
      );
    }

    const created = await prisma.shiftType.create({
      data: {
        name:      input.name,
        label:     input.label ?? null,
        startTime: input.startTime,
        endTime:   input.endTime,
        isActive:  input.isActive,
        sortOrder: input.sortOrder,
      },
    });

    await this.audit({
      entityType: 'ShiftType',
      entityId:   created.id,
      action:     'CREATE',
      newValue:   { name: created.name, startTime: created.startTime, endTime: created.endTime },
    }, userId);

    return mapShiftType(created);
  }

  async updateShiftType(id: string, input: ShiftTypeUpdateInput, userId?: string) {
    const existing = await prisma.shiftType.findUnique({ where: { id } });
    if (!existing) return null;

    const oldValue = {
      label:     existing.label,
      startTime: existing.startTime,
      endTime:   existing.endTime,
      isActive:  existing.isActive,
      sortOrder: existing.sortOrder,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    if (input.label     !== undefined) data.label     = input.label;
    if (input.startTime !== undefined) data.startTime = input.startTime;
    if (input.endTime   !== undefined) data.endTime   = input.endTime;
    if (input.isActive  !== undefined) data.isActive  = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await prisma.shiftType.update({ where: { id }, data });

    await this.audit({
      entityType: 'ShiftType',
      entityId:   id,
      action:     'UPDATE',
      oldValue,
      newValue:   { label: updated.label, startTime: updated.startTime, endTime: updated.endTime, isActive: updated.isActive },
    }, userId);

    return mapShiftType(updated);
  }

  // ── B. Commission Rules ────────────────────────────────────────────────────────

  private fetchCommissionRuleWithPlan(id: string): Promise<CommissionRuleWithPlan | null> {
    return prisma.commissionRule.findUnique({
      where:   { id },
      include: { plan: { select: { id: true, name: true, priceAmount: true } } },
    });
  }

  async getCommissionRules() {
    const items = await prisma.commissionRule.findMany({
      include: { plan: { select: { id: true, name: true, priceAmount: true } } },
      orderBy: [{ isActive: 'desc' }, { validFrom: 'desc' }],
    });
    return { items: items.map(mapCommissionRule) };
  }

  async createCommissionRule(input: CommissionRuleCreateInput, userId?: string) {
    const plan = await prisma.pricingPlan.findUnique({ where: { id: input.pricingPlanId } });
    if (!plan) {
      throw Object.assign(
        new Error(`Pricing plan not found: ${input.pricingPlanId}`),
        { status: 404 },
      );
    }

    const now = new Date();

    // When the new rule is active, deactivate all existing active rules for the same plan.
    // Only one active commission rule per plan should exist at a time.
    if (input.isActive) {
      const prevActive = await prisma.commissionRule.findMany({
        where:  { pricingPlanId: input.pricingPlanId, isActive: true },
        select: { id: true },
      });
      if (prevActive.length > 0) {
        await prisma.commissionRule.updateMany({
          where: { id: { in: prevActive.map((r) => r.id) } },
          data:  { isActive: false, validTo: now },
        });
        logger.info(
          `[prime-settings] Deactivated ${prevActive.length} previous commission rule(s) for plan "${plan.name}"`,
        );
      }
    }

    const created = await prisma.commissionRule.create({
      data: {
        pricingPlanId: input.pricingPlanId,
        type:          input.type,
        value:         input.value,
        isActive:      input.isActive,
        validFrom:     now,
        validTo:       null,
      },
    });

    await this.audit({
      entityType: 'CommissionRule',
      entityId:   created.id,
      action:     'CREATE',
      newValue:   {
        planName: plan.name,
        type:     created.type,
        value:    Number(created.value),
        isActive: created.isActive,
      },
    }, userId);

    const ruleWithPlan = await this.fetchCommissionRuleWithPlan(created.id);
    return mapCommissionRule(ruleWithPlan!);
  }

  async patchCommissionRule(id: string, input: CommissionRuleUpdateInput, userId?: string) {
    const existing = await this.fetchCommissionRuleWithPlan(id);
    if (!existing) return null;

    const changingTypeOrValue = input.type !== undefined || input.value !== undefined;
    const now = new Date();

    if (!changingTypeOrValue) {
      // Simple isActive toggle: update in place.
      // Seal the validity window (validTo=now) when deactivating an active rule.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = {};
      if (input.isActive !== undefined) {
        data.isActive = input.isActive;
        if (!input.isActive && existing.isActive) data.validTo = now;
      }

      const updated = await prisma.commissionRule.update({ where: { id }, data });

      await this.audit({
        entityType: 'CommissionRule',
        entityId:   id,
        action:     'UPDATE',
        oldValue:   { isActive: existing.isActive },
        newValue:   { isActive: updated.isActive },
      }, userId);

      const updatedWithPlan = await this.fetchCommissionRuleWithPlan(id);
      return mapCommissionRule(updatedWithPlan!);
    }

    // Structural change (type or value): deactivate old rule, create new version.
    // Historical shift calculations retain their pricingSnapshot, so old commission
    // amounts are not affected by creating a new rule version.
    const newRule = await prisma.$transaction(async (tx) => {
      await tx.commissionRule.update({
        where: { id },
        data:  { isActive: false, validTo: now },
      });
      return tx.commissionRule.create({
        data: {
          pricingPlanId: existing.pricingPlanId,
          type:          input.type     !== undefined ? input.type     : existing.type,
          value:         input.value    !== undefined ? input.value    : existing.value,
          isActive:      input.isActive !== undefined ? input.isActive : existing.isActive,
          validFrom:     now,
          validTo:       null,
        },
      });
    });

    await this.audit({
      entityType: 'CommissionRule',
      entityId:   newRule.id,
      action:     'CREATE',
      oldValue:   { replacedId: existing.id, type: existing.type, value: Number(existing.value) },
      newValue:   { type: newRule.type, value: Number(newRule.value), isActive: newRule.isActive },
      reason:     'Structural change via PATCH — old rule deactivated, new version created',
    }, userId);

    const newRuleWithPlan = await this.fetchCommissionRuleWithPlan(newRule.id);
    return mapCommissionRule(newRuleWithPlan!);
  }

  // ── C. Target Bonus Rules ──────────────────────────────────────────────────────

  private fetchTargetBonusRuleWithType(id: string): Promise<TargetBonusRuleWithType | null> {
    return prisma.shiftTargetBonusRule.findUnique({
      where:   { id },
      include: { shiftType: { select: { id: true, name: true, label: true } } },
    });
  }

  async getTargetBonusRules() {
    const items = await prisma.shiftTargetBonusRule.findMany({
      include: { shiftType: { select: { id: true, name: true, label: true } } },
      orderBy: [{ isActive: 'desc' }, { targetAmount: 'asc' }],
    });
    return { items: items.map(mapTargetBonusRule) };
  }

  async createTargetBonusRule(input: TargetBonusRuleCreateInput, userId?: string) {
    const shiftType = await prisma.shiftType.findUnique({ where: { id: input.shiftTypeId } });
    if (!shiftType) {
      throw Object.assign(
        new Error(`Shift type not found: ${input.shiftTypeId}`),
        { status: 404 },
      );
    }

    const now = new Date();

    // When the new rule is active, deactivate any active rule with the same
    // shiftTypeId + targetAmount (same threshold = replacement, not addition).
    if (input.isActive) {
      const prevActive = await prisma.shiftTargetBonusRule.findMany({
        where: {
          shiftTypeId:  input.shiftTypeId,
          targetAmount: input.targetAmount,
          isActive:     true,
        },
        select: { id: true },
      });
      if (prevActive.length > 0) {
        await prisma.shiftTargetBonusRule.updateMany({
          where: { id: { in: prevActive.map((r) => r.id) } },
          data:  { isActive: false, validTo: now },
        });
        logger.info(
          `[prime-settings] Deactivated ${prevActive.length} previous bonus rule(s) for ${shiftType.name} @ ${input.targetAmount}`,
        );
      }
    }

    const created = await prisma.shiftTargetBonusRule.create({
      data: {
        shiftTypeId:  input.shiftTypeId,
        targetAmount: input.targetAmount,
        bonusAmount:  input.bonusAmount,
        isActive:     input.isActive,
        validFrom:    now,
        validTo:      null,
      },
    });

    await this.audit({
      entityType: 'ShiftTargetBonusRule',
      entityId:   created.id,
      action:     'CREATE',
      newValue:   {
        shiftType:    shiftType.name,
        targetAmount: Number(created.targetAmount),
        bonusAmount:  Number(created.bonusAmount),
        isActive:     created.isActive,
      },
    }, userId);

    const ruleWithType = await this.fetchTargetBonusRuleWithType(created.id);
    return mapTargetBonusRule(ruleWithType!);
  }

  async patchTargetBonusRule(id: string, input: TargetBonusRuleUpdateInput, userId?: string) {
    const existing = await this.fetchTargetBonusRuleWithType(id);
    if (!existing) return null;

    const changingAmounts = input.targetAmount !== undefined || input.bonusAmount !== undefined;
    const now = new Date();

    if (!changingAmounts) {
      // Simple isActive toggle: update in place.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = {};
      if (input.isActive !== undefined) {
        data.isActive = input.isActive;
        if (!input.isActive && existing.isActive) data.validTo = now;
      }

      const updated = await prisma.shiftTargetBonusRule.update({ where: { id }, data });

      await this.audit({
        entityType: 'ShiftTargetBonusRule',
        entityId:   id,
        action:     'UPDATE',
        oldValue:   { isActive: existing.isActive },
        newValue:   { isActive: updated.isActive },
      }, userId);

      const updatedWithType = await this.fetchTargetBonusRuleWithType(id);
      return mapTargetBonusRule(updatedWithType!);
    }

    // Structural change: deactivate old, create new version.
    const newRule = await prisma.$transaction(async (tx) => {
      await tx.shiftTargetBonusRule.update({
        where: { id },
        data:  { isActive: false, validTo: now },
      });
      return tx.shiftTargetBonusRule.create({
        data: {
          shiftTypeId:  existing.shiftTypeId,
          targetAmount: input.targetAmount !== undefined ? input.targetAmount : existing.targetAmount,
          bonusAmount:  input.bonusAmount  !== undefined ? input.bonusAmount  : existing.bonusAmount,
          isActive:     input.isActive     !== undefined ? input.isActive     : existing.isActive,
          validFrom:    now,
          validTo:      null,
        },
      });
    });

    await this.audit({
      entityType: 'ShiftTargetBonusRule',
      entityId:   newRule.id,
      action:     'CREATE',
      oldValue:   {
        replacedId:   existing.id,
        targetAmount: Number(existing.targetAmount),
        bonusAmount:  Number(existing.bonusAmount),
      },
      newValue:   {
        targetAmount: Number(newRule.targetAmount),
        bonusAmount:  Number(newRule.bonusAmount),
        isActive:     newRule.isActive,
      },
      reason: 'Structural change via PATCH — old rule deactivated, new version created',
    }, userId);

    const newRuleWithType = await this.fetchTargetBonusRuleWithType(newRule.id);
    return mapTargetBonusRule(newRuleWithType!);
  }

  // ── D. Prime Settings Summary ──────────────────────────────────────────────────

  async getPrimeSummary() {
    const [shiftTypes, pricingPlans, commissionRules, targetBonusRules] = await Promise.all([
      prisma.shiftType.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.pricingPlan.findMany({
        orderBy: [{ sortOrder: 'asc' }, { durationSeconds: 'asc' }],
      }),
      prisma.commissionRule.findMany({
        include: { plan: { select: { id: true, name: true, priceAmount: true } } },
        orderBy: [{ isActive: 'desc' }, { validFrom: 'desc' }],
      }),
      prisma.shiftTargetBonusRule.findMany({
        include: { shiftType: { select: { id: true, name: true, label: true } } },
        orderBy: [{ isActive: 'desc' }, { targetAmount: 'asc' }],
      }),
    ]);

    return {
      shiftTypes: shiftTypes.map(mapShiftType),
      pricingPlans: pricingPlans.map((p) => ({
        id:              p.id,
        name:            p.name,
        durationSeconds: p.durationSeconds,
        priceAmount:     Number(p.priceAmount),
        currency:        p.currency,
        isActive:        p.isActive,
        sortOrder:       p.sortOrder,
      })),
      commissionRules:  commissionRules.map(mapCommissionRule),
      targetBonusRules: targetBonusRules.map(mapTargetBonusRule),
      defaults: {
        commissionExample:  'Plan 30 min at 30 MAD with 10% → 3 MAD commission per eligible session',
        targetBonusExample: 'Matin shift with grossRevenue ≥ 500 MAD → 50 MAD bonus',
      },
    };
  }
}

export const primeSettingsService = new PrimeSettingsService();
