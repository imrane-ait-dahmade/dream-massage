import { Prisma } from '@prisma/client';
import type { CommissionRule } from '@prisma/client';
import { prisma } from '../../prisma';

// Shorthand for the Decimal constructor.
// Prisma.Decimal is decimal.js — all arithmetic returns new instances (immutable).
const D = Prisma.Decimal;
const ZERO = new D(0);

// ── Return types ───────────────────────────────────────────────────────────────

export interface SessionPrimeLine {
  id: string;
  chairName: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  matchedPlanName: string | null;
  expectedAmount: number;
  correctedAmount: number | null;
  finalAmount: number;
  commissionAmount: number;
  anomalyType: string | null;
  billingStatus: string;
}

export interface CommissionByPlanLine {
  pricingPlanId: string;
  pricingPlanName: string;
  sessionsCount: number;
  grossRevenue: number;
  commissionType: string;
  commissionValue: number;
  commissionAmount: number;
}

export interface ShiftPrimeSummary {
  shift: {
    id: string;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    staffMemberName: string;
    shiftTypeName: string | null;
  };
  totals: {
    grossRevenue: number;
    planCommission: number;
    targetBonus: number;
    manualBonus: number;
    totalPrime: number;
    netRevenue: number;
    sessionsCount: number;
    eligibleCommissionSessionsCount: number;
  };
  commissionByPlan: CommissionByPlanLine[];
  targetBonusRule: {
    id: string;
    shiftTypeName: string;
    targetAmount: number;
    bonusAmount: number;
  } | null;
  manualAdjustments: {
    id: string;
    amount: number;
    reason: string | null;
    createdAt: Date;
  }[];
  sessions: SessionPrimeLine[];
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function resolveFinalAmount(
  expectedAmount: Prisma.Decimal | null,
  correctedAmount: Prisma.Decimal | null,
): Prisma.Decimal {
  // correctedAmount takes precedence over expectedAmount when present.
  if (correctedAmount !== null) return correctedAmount;
  return expectedAmount ?? ZERO;
}

function isEligibleForCommission(
  billingStatus: string,
  anomalyType: string | null,
  matchedPlanId: string | null,
  finalAmount: Prisma.Decimal,
): boolean {
  if (finalAmount.isZero() || finalAmount.isNegative()) return false;
  if (!matchedPlanId) return false;
  // TOO_SHORT sessions have amount=0 and no valid plan — never eligible.
  if (anomalyType && anomalyType.split(',').includes('TOO_SHORT')) return false;
  // DISPUTED sessions require explicit owner review before commission.
  if (billingStatus === 'DISPUTED') return false;
  // CALCULATED or CORRECTED → always eligible.
  if (billingStatus === 'CALCULATED' || billingStatus === 'CORRECTED') return true;
  // PENDING + TOO_LONG: session has a valid plan and price (billed at last-plan rate).
  // The anomaly badge remains for display; commission still applies.
  // This handles sessions created before the PricingService was updated.
  if (billingStatus === 'PENDING' && anomalyType?.split(',').includes('TOO_LONG')) return true;
  return false;
}

// Returns the most recently valid commission rule for a plan at a given date.
// Batch-provided rules are pre-filtered to isActive=true; here we only check dates.
function findValidRule(
  rules: CommissionRule[],
  planId: string,
  atDate: Date,
): CommissionRule | null {
  const candidates = rules
    .filter(
      (r) =>
        r.pricingPlanId === planId &&
        r.validFrom <= atDate &&
        (r.validTo === null || r.validTo > atDate),
    )
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime()); // newest first
  return candidates[0] ?? null;
}

function applyCommissionRule(
  rule: CommissionRule,
  finalAmount: Prisma.Decimal,
): Prisma.Decimal {
  if (rule.type === 'PERCENTAGE') {
    // commission = finalAmount × (value / 100), rounded to 2dp
    return finalAmount
      .mul(rule.value)
      .div(new D(100))
      .toDecimalPlaces(2);
  }
  // FIXED_AMOUNT: same value per eligible session
  return rule.value.toDecimalPlaces(2);
}

// ── Service ────────────────────────────────────────────────────────────────────

export class PrimeCalculationService {
  /**
   * Pure read: calculates the full prime breakdown for a shift without writing
   * anything to the database. Safe to call at any time, on any shift status.
   *
   * Money arithmetic uses Prisma.Decimal (decimal.js) throughout.
   * Final totals are converted to number only when building the return object.
   */
  async calculateShiftPrimeSummary(shiftId: string): Promise<ShiftPrimeSummary> {
    // ── 1. Fetch shift with all related data ─────────────────────────────────
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        staffMember: true,
        shiftType: true,
        sessions: {
          where: { status: 'COMPLETED' },
          include: {
            chair:       { select: { name: true } },
            matchedPlan: { select: { id: true, name: true } },
          },
          orderBy: { startedAt: 'asc' },
        },
        bonusAdjustments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!shift) throw new Error(`Shift not found: ${shiftId}`);

    // ── 2. Batch-fetch commission rules for all plan IDs in this shift ────────
    const planIds = [
      ...new Set(
        shift.sessions
          .filter((s) => s.matchedPlanId !== null)
          .map((s) => s.matchedPlanId!),
      ),
    ];

    const commissionRules =
      planIds.length > 0
        ? await prisma.commissionRule.findMany({
            where: { pricingPlanId: { in: planIds }, isActive: true },
            orderBy: [{ pricingPlanId: 'asc' }, { validFrom: 'desc' }],
          })
        : [];

    // ── 3. Per-session calculation ────────────────────────────────────────────
    let grossRevenue:   Prisma.Decimal = ZERO;
    let planCommission: Prisma.Decimal = ZERO;
    let eligibleCount = 0;

    // planId → accumulator for the commissionByPlan breakdown
    const planAccumulators = new Map<
      string,
      {
        planName:     string;
        sessionsCount: number;
        grossRev:     Prisma.Decimal;
        commAmount:   Prisma.Decimal;
        commType:     string;
        commValue:    Prisma.Decimal;
      }
    >();

    const sessionLines: SessionPrimeLine[] = [];

    for (const session of shift.sessions) {
      const finalAmount = resolveFinalAmount(session.expectedAmount, session.correctedAmount);
      grossRevenue = grossRevenue.add(finalAmount);

      let commissionAmount: Prisma.Decimal = ZERO;

      if (
        session.matchedPlanId &&
        isEligibleForCommission(
          session.billingStatus,
          session.anomalyType,
          session.matchedPlanId,
          finalAmount,
        )
      ) {
        const rule = findValidRule(commissionRules, session.matchedPlanId, session.startedAt);

        if (rule) {
          eligibleCount++;
          commissionAmount = applyCommissionRule(rule, finalAmount);
          planCommission = planCommission.add(commissionAmount);

          const acc = planAccumulators.get(session.matchedPlanId);
          if (acc) {
            acc.sessionsCount++;
            acc.grossRev  = acc.grossRev.add(finalAmount);
            acc.commAmount = acc.commAmount.add(commissionAmount);
          } else {
            planAccumulators.set(session.matchedPlanId, {
              planName:     session.matchedPlan?.name ?? session.matchedPlanId,
              sessionsCount: 1,
              grossRev:     finalAmount,
              commAmount:   commissionAmount,
              commType:     rule.type,
              commValue:    rule.value,
            });
          }
        }
      }

      sessionLines.push({
        id:              session.id,
        chairName:       session.chair.name,
        startedAt:       session.startedAt,
        endedAt:         session.endedAt,
        durationSeconds: session.durationSeconds,
        matchedPlanName: session.matchedPlan?.name ?? null,
        expectedAmount:  Number(session.expectedAmount ?? ZERO),
        correctedAmount: session.correctedAmount !== null ? Number(session.correctedAmount) : null,
        finalAmount:     Number(finalAmount),
        commissionAmount: Number(commissionAmount),
        anomalyType:     session.anomalyType,
        billingStatus:   session.billingStatus,
      });
    }

    // ── 4. Target bonus ───────────────────────────────────────────────────────
    // Validity date: shift.startedAt (rules active when the shift opened apply).
    // Among all matching rules, only the highest targetAmount that is still
    // ≤ grossRevenue applies (non-cumulative).
    let targetBonus: Prisma.Decimal = ZERO;
    let targetBonusRuleOut: ShiftPrimeSummary['targetBonusRule'] = null;

    if (shift.shiftTypeId) {
      const bonusRule = await prisma.shiftTargetBonusRule.findFirst({
        where: {
          shiftTypeId:  shift.shiftTypeId,
          isActive:     true,
          validFrom:    { lte: shift.startedAt },
          OR:           [{ validTo: null }, { validTo: { gt: shift.startedAt } }],
          targetAmount: { lte: grossRevenue },
        },
        orderBy: { targetAmount: 'desc' }, // highest matching threshold wins
      });

      if (bonusRule) {
        targetBonus = bonusRule.bonusAmount;
        targetBonusRuleOut = {
          id:            bonusRule.id,
          shiftTypeName: shift.shiftType?.label ?? shift.shiftType?.name ?? '',
          targetAmount:  Number(bonusRule.targetAmount),
          bonusAmount:   Number(bonusRule.bonusAmount),
        };
      }
    }

    // ── 5. Manual bonus ───────────────────────────────────────────────────────
    let manualBonus: Prisma.Decimal = ZERO;
    const manualAdjustments: ShiftPrimeSummary['manualAdjustments'] = [];

    for (const adj of shift.bonusAdjustments) {
      manualBonus = manualBonus.add(adj.amount);
      manualAdjustments.push({
        id:        adj.id,
        amount:    Number(adj.amount),
        reason:    adj.reason,
        createdAt: adj.createdAt,
      });
    }

    // ── 6. Final totals (all Decimal arithmetic, convert to number at boundary) ─
    const totalPrime = planCommission.add(targetBonus).add(manualBonus).toDecimalPlaces(2);
    const netRevenue = grossRevenue.sub(totalPrime).toDecimalPlaces(2);

    const commissionByPlan: CommissionByPlanLine[] = Array.from(
      planAccumulators.entries(),
    ).map(([planId, acc]) => ({
      pricingPlanId:   planId,
      pricingPlanName: acc.planName,
      sessionsCount:   acc.sessionsCount,
      grossRevenue:    Number(acc.grossRev),
      commissionType:  acc.commType,
      commissionValue: Number(acc.commValue),
      commissionAmount: Number(acc.commAmount),
    }));

    return {
      shift: {
        id:              shift.id,
        status:          shift.status,
        startedAt:       shift.startedAt,
        endedAt:         shift.endedAt,
        staffMemberName: shift.staffMember.name,
        shiftTypeName:   shift.shiftType?.label ?? shift.shiftType?.name ?? null,
      },
      totals: {
        grossRevenue:                     Number(grossRevenue),
        planCommission:                   Number(planCommission),
        targetBonus:                      Number(targetBonus),
        manualBonus:                      Number(manualBonus),
        totalPrime:                       Number(totalPrime),
        netRevenue:                       Number(netRevenue),
        sessionsCount:                    shift.sessions.length,
        eligibleCommissionSessionsCount:  eligibleCount,
      },
      commissionByPlan,
      targetBonusRule:   targetBonusRuleOut,
      manualAdjustments,
      sessions:          sessionLines,
    };
  }
}

export const primeCalculationService = new PrimeCalculationService();
