import { prisma } from '../../prisma';
import { settingsService } from './settings.service';
import type { PricingRuleUpdateInput } from './settings.types';

const ALLOW_KEY  = 'session.allowManualCorrection';
const REASON_KEY = 'session.correctionReasonRequired';

function parseBool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined) return def;
  return raw === 'true';
}

class SessionSettingsService {
  async get() {
    const [rule, rows] = await Promise.all([
      prisma.pricingRule.findFirst({
        where:   { isActive: true },
        include: { minimumPlan: { select: { id: true, name: true, durationSeconds: true, priceAmount: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.appSetting.findMany({ where: { key: { in: [ALLOW_KEY, REASON_KEY] } } }),
    ]);

    const map = new Map(rows.map((s) => [s.key, s.value]));

    return {
      minimumBillableSeconds:       rule?.minimumBillableSeconds ?? 180,
      graceSeconds:                 rule?.graceSeconds           ?? 120,
      roundingMode:                 rule?.roundingMode           ?? 'NEXT_PLAN',
      overtimePolicy:               rule?.overtimePolicy         ?? 'ANOMALY',
      extraMinutePrice:             rule?.extraMinutePrice != null ? Number(rule.extraMinutePrice) : null,
      minimumPlanId:                rule?.minimumPlanId          ?? null,
      minimumPlan: rule?.minimumPlan
        ? {
            id:              rule.minimumPlan.id,
            name:            rule.minimumPlan.name,
            durationSeconds: rule.minimumPlan.durationSeconds,
            priceAmount:     Number(rule.minimumPlan.priceAmount),
          }
        : null,
      allowManualSessionCorrection: parseBool(map.get(ALLOW_KEY),  true),
      correctionReasonRequired:     parseBool(map.get(REASON_KEY), true),
    };
  }

  async update(input: {
    minimumBillableSeconds?:       number;
    graceSeconds?:                 number;
    roundingMode?:                 string;
    overtimePolicy?:               string;
    extraMinutePrice?:             number | null;
    minimumPlanId?:                string | null;
    allowManualSessionCorrection?: boolean;
    correctionReasonRequired?:     boolean;
  }) {
    // Update pricing rule fields via existing service
    const pricingInput: Partial<PricingRuleUpdateInput> = {};
    if (input.minimumBillableSeconds !== undefined) pricingInput.minimumBillableSeconds = input.minimumBillableSeconds;
    if (input.graceSeconds           !== undefined) pricingInput.graceSeconds           = input.graceSeconds;
    if (input.roundingMode           !== undefined) pricingInput.roundingMode           = input.roundingMode as PricingRuleUpdateInput['roundingMode'];
    if (input.overtimePolicy         !== undefined) pricingInput.overtimePolicy         = input.overtimePolicy as PricingRuleUpdateInput['overtimePolicy'];
    if (input.extraMinutePrice       !== undefined) pricingInput.extraMinutePrice       = input.extraMinutePrice;
    if (input.minimumPlanId          !== undefined) pricingInput.minimumPlanId          = input.minimumPlanId;

    if (Object.keys(pricingInput).length > 0) {
      await settingsService.upsertPricingRule(pricingInput);
    }

    // Update boolean flags in AppSetting
    const appUpdates: Array<[string, boolean]> = [];
    if (input.allowManualSessionCorrection !== undefined) appUpdates.push([ALLOW_KEY,  input.allowManualSessionCorrection]);
    if (input.correctionReasonRequired     !== undefined) appUpdates.push([REASON_KEY, input.correctionReasonRequired]);

    await Promise.all(
      appUpdates.map(([key, val]) =>
        prisma.appSetting.upsert({
          where:  { key },
          create: { key, value: String(val), type: 'boolean' },
          update: { value: String(val) },
        }),
      ),
    );

    return this.get();
  }

  async getAllowManualCorrection(): Promise<boolean> {
    const s = await prisma.appSetting.findUnique({ where: { key: ALLOW_KEY } });
    return parseBool(s?.value, true);
  }

  async getCorrectionReasonRequired(): Promise<boolean> {
    const s = await prisma.appSetting.findUnique({ where: { key: REASON_KEY } });
    return parseBool(s?.value, true);
  }
}

export const sessionSettingsService = new SessionSettingsService();
