import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';

export interface PricingResult {
  matchedPlanId: string | null;
  expectedAmount: number;
  pricingSnapshot: Record<string, unknown>;
}

const FALLBACK_RESULT: PricingResult = {
  matchedPlanId: null,
  expectedAmount: 0,
  pricingSnapshot: { error: 'no_pricing_data' },
};

export class PricingService {
  async calculateSessionPrice(durationSeconds: number): Promise<PricingResult> {
    try {
      const rule = await prisma.pricingRule.findFirst({ where: { isActive: true } });

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

      // NEXT_PLAN: smallest plan where session fits within plan duration + grace window
      const matched = plans.find((p) => durationSeconds <= p.durationSeconds + grace);
      // If duration exceeds all plans, use the largest plan
      const finalPlan = matched ?? plans[plans.length - 1]!;
      const isOvertime = !matched;

      const expectedAmount = Number(finalPlan.priceAmount);

      const pricingSnapshot: Record<string, unknown> = {
        ruleId: rule.id,
        roundingMode: rule.roundingMode,
        graceSeconds: grace,
        overtimePolicy: rule.overtimePolicy,
        durationSeconds,
        matchedPlanId: finalPlan.id,
        matchedPlanName: finalPlan.name,
        isOvertime,
        plans: plans.map((p) => ({
          id: p.id,
          name: p.name,
          durationSeconds: p.durationSeconds,
          priceAmount: Number(p.priceAmount),
          currency: p.currency,
        })),
      };

      return { matchedPlanId: finalPlan.id, expectedAmount, pricingSnapshot };
    } catch (err) {
      logger.error('[pricing] Failed to calculate price:', String(err));
      return FALLBACK_RESULT;
    }
  }
}

export const pricingService = new PricingService();
