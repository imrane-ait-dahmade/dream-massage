import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';

export interface PricingResult {
  matchedPlanId: string | null;
  expectedAmount: number;
  billingStatus: 'PENDING' | 'CALCULATED';
  anomalyType: string | null;
  pricingSnapshot: Record<string, unknown>;
}

const FALLBACK_RESULT: PricingResult = {
  matchedPlanId: null,
  expectedAmount: 0,
  billingStatus: 'PENDING',
  anomalyType: null,
  pricingSnapshot: { error: 'no_pricing_data' },
};

export class PricingService {
  async calculateSessionPrice(durationSeconds: number): Promise<PricingResult> {
    try {
      const rule = await prisma.pricingRule.findFirst({
        where: { isActive: true },
        include: { minimumPlan: true },
      });

      if (!rule) {
        logger.warn('[pricing] No active pricing rule found');
        return FALLBACK_RESULT;
      }

      const plans = await prisma.pricingPlan.findMany({
        where: { isActive: true },
        orderBy: { durationSeconds: 'asc' },
      });

      if (plans.length === 0) {
        logger.warn('[pricing] No active pricing plans found');
        return { ...FALLBACK_RESULT, pricingSnapshot: { error: 'no_pricing_plans' } };
      }

      const grace = rule.graceSeconds;
      const minimumBillableSeconds = rule.minimumBillableSeconds;
      const lastPlan = plans[plans.length - 1]!;

      const snapshotBase: Record<string, unknown> = {
        ruleId: rule.id,
        roundingMode: rule.roundingMode,
        graceSeconds: grace,
        overtimePolicy: rule.overtimePolicy,
        minimumBillableSeconds,
        durationSeconds,
        plans: plans.map((p) => ({
          id: p.id,
          name: p.name,
          durationSeconds: p.durationSeconds,
          priceAmount: Number(p.priceAmount),
          currency: p.currency,
        })),
      };

      // ── 1. TOO_SHORT ──────────────────────────────────────────────────────────
      if (durationSeconds < minimumBillableSeconds) {
        return {
          matchedPlanId: null,
          expectedAmount: 0,
          billingStatus: 'PENDING',
          anomalyType: 'TOO_SHORT',
          pricingSnapshot: {
            ...snapshotBase,
            reason: 'TOO_SHORT',
            matchedPlanId: null,
            matchedPlanName: null,
          },
        };
      }

      // ── 2. NEXT_PLAN with grace ───────────────────────────────────────────────
      // Smallest plan where durationSeconds <= plan.durationSeconds + grace
      const matched = plans.find((p) => durationSeconds <= p.durationSeconds + grace);

      if (matched) {
        // Apply minimum plan floor: if matched plan is shorter than minimum, bill minimum instead
        let finalPlan = matched;
        if (rule.minimumPlan && matched.durationSeconds < rule.minimumPlan.durationSeconds) {
          finalPlan = plans.find((p) => p.id === rule.minimumPlanId) ?? matched;
        }

        return {
          matchedPlanId: finalPlan.id,
          expectedAmount: Number(finalPlan.priceAmount),
          billingStatus: 'CALCULATED',
          anomalyType: null,
          pricingSnapshot: {
            ...snapshotBase,
            reason: 'NORMAL',
            matchedPlanId: finalPlan.id,
            matchedPlanName: finalPlan.name,
            matchedPlanDurationSeconds: finalPlan.durationSeconds,
            matchedPlanPrice: Number(finalPlan.priceAmount),
          },
        };
      }

      // ── 3. TOO_LONG: duration > lastPlan.durationSeconds + grace ─────────────
      const overtimePolicy = rule.overtimePolicy;

      if (overtimePolicy === 'ANOMALY') {
        return {
          matchedPlanId: lastPlan.id,
          expectedAmount: Number(lastPlan.priceAmount),
          billingStatus: 'PENDING',
          anomalyType: 'TOO_LONG',
          pricingSnapshot: {
            ...snapshotBase,
            reason: 'TOO_LONG',
            matchedPlanId: lastPlan.id,
            matchedPlanName: lastPlan.name,
            matchedPlanDurationSeconds: lastPlan.durationSeconds,
            matchedPlanPrice: Number(lastPlan.priceAmount),
          },
        };
      }

      if (overtimePolicy === 'NEXT_PLAN') {
        return {
          matchedPlanId: lastPlan.id,
          expectedAmount: Number(lastPlan.priceAmount),
          billingStatus: 'CALCULATED',
          anomalyType: null,
          pricingSnapshot: {
            ...snapshotBase,
            reason: 'TOO_LONG',
            matchedPlanId: lastPlan.id,
            matchedPlanName: lastPlan.name,
            matchedPlanDurationSeconds: lastPlan.durationSeconds,
            matchedPlanPrice: Number(lastPlan.priceAmount),
          },
        };
      }

      // EXTRA_MINUTE — out of scope for MVP; safe fallback to avoid crash
      // TODO: implement EXTRA_MINUTE billing when added to scope
      logger.warn('[pricing] EXTRA_MINUTE policy not implemented — using last plan, PENDING');
      return {
        matchedPlanId: lastPlan.id,
        expectedAmount: Number(lastPlan.priceAmount),
        billingStatus: 'PENDING',
        anomalyType: 'TOO_LONG',
        pricingSnapshot: {
          ...snapshotBase,
          reason: 'TOO_LONG',
          matchedPlanId: lastPlan.id,
          matchedPlanName: lastPlan.name,
          matchedPlanDurationSeconds: lastPlan.durationSeconds,
          matchedPlanPrice: Number(lastPlan.priceAmount),
          note: 'EXTRA_MINUTE_NOT_IMPLEMENTED',
        },
      };
    } catch (err) {
      logger.error('[pricing] Failed to calculate price:', String(err));
      return FALLBACK_RESULT;
    }
  }
}

export const pricingService = new PricingService();
