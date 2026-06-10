import { z } from 'zod';

// ── Chair ──────────────────────────────────────────────────────────────────────

export const chairUpdateSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export type ChairUpdateInput = z.infer<typeof chairUpdateSchema>;

// ── Detection config ───────────────────────────────────────────────────────────

export const detectionConfigSchema = z
  .object({
    startThresholdWatts: z.number().nonnegative(),
    stopThresholdWatts: z.number().nonnegative(),
    startConfirmSeconds: z.number().int().positive(),
    stopConfirmSeconds: z.number().int().positive(),
    activationDelaySeconds: z.number().int().nonnegative(),
    baselinePowerWatts: z.number().nonnegative().nullable().optional(),
  })
  .strict()
  .refine((d) => d.startThresholdWatts > d.stopThresholdWatts, {
    message: 'startThresholdWatts must be greater than stopThresholdWatts',
    path: ['startThresholdWatts'],
  });

export type DetectionConfigInput = z.infer<typeof detectionConfigSchema>;

// ── Pricing plan ───────────────────────────────────────────────────────────────

export const pricingPlanCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    durationSeconds: z.number().int().positive(),
    priceAmount: z.number().nonnegative(),
    currency: z.string().min(1).max(10).default('MAD'),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .strict();

export type PricingPlanCreateInput = z.infer<typeof pricingPlanCreateSchema>;

export const pricingPlanUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    durationSeconds: z.number().int().positive().optional(),
    priceAmount: z.number().nonnegative().optional(),
    currency: z.string().min(1).max(10).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();

export type PricingPlanUpdateInput = z.infer<typeof pricingPlanUpdateSchema>;

// ── Pricing rule ───────────────────────────────────────────────────────────────

export const pricingRuleUpdateSchema = z
  .object({
    roundingMode: z.enum(['NEAREST_PLAN', 'NEXT_PLAN', 'EXACT_MINUTES']).optional(),
    graceSeconds: z.number().int().nonnegative().optional(),
    minimumBillableSeconds: z.number().int().nonnegative().optional(),
    minimumPlanId: z.string().uuid().nullable().optional(),
    overtimePolicy: z.enum(['NEXT_PLAN', 'EXTRA_MINUTE', 'ANOMALY']).optional(),
    extraMinutePrice: z.number().nonnegative().nullable().optional(),
  })
  .strict();

export type PricingRuleUpdateInput = z.infer<typeof pricingRuleUpdateSchema>;

// ── Staff ──────────────────────────────────────────────────────────────────────

export const staffCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    phone: z.string().max(30).optional(),
    notes: z.string().optional(),
  })
  .strict();

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const staffUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().max(30).nullable().optional(),
    isActive: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;
