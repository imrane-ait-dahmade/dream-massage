import { z } from 'zod';

const HH_MM = /^\d{2}:\d{2}$/;

// ── Shift Type ─────────────────────────────────────────────────────────────────

export const shiftTypeCreateSchema = z
  .object({
    name:      z.string().min(1).max(50),
    label:     z.string().min(1).max(100).optional(),
    startTime: z.string().regex(HH_MM, 'Must be in HH:mm format'),
    endTime:   z.string().regex(HH_MM, 'Must be in HH:mm format'),
    isActive:  z.boolean().default(true),
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .strict();

export type ShiftTypeCreateInput = z.infer<typeof shiftTypeCreateSchema>;

export const shiftTypeUpdateSchema = z
  .object({
    label:     z.string().min(1).max(100).optional(),
    startTime: z.string().regex(HH_MM, 'Must be in HH:mm format').optional(),
    endTime:   z.string().regex(HH_MM, 'Must be in HH:mm format').optional(),
    isActive:  z.boolean().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ShiftTypeUpdateInput = z.infer<typeof shiftTypeUpdateSchema>;

// ── Commission Rule ────────────────────────────────────────────────────────────

export const commissionRuleCreateSchema = z
  .object({
    pricingPlanId: z.string().uuid(),
    type:          z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
    value:         z.number().nonnegative(),
    isActive:      z.boolean().default(true),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.type === 'PERCENTAGE' && d.value > 100) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        message: 'value must be between 0 and 100 for PERCENTAGE type',
        path:    ['value'],
      });
    }
  });

export type CommissionRuleCreateInput = z.infer<typeof commissionRuleCreateSchema>;

export const commissionRuleUpdateSchema = z
  .object({
    type:     z.enum(['PERCENTAGE', 'FIXED_AMOUNT']).optional(),
    value:    z.number().nonnegative().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.type === 'PERCENTAGE' && d.value !== undefined && d.value > 100) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        message: 'value must be between 0 and 100 for PERCENTAGE type',
        path:    ['value'],
      });
    }
  });

export type CommissionRuleUpdateInput = z.infer<typeof commissionRuleUpdateSchema>;

// ── Target Bonus Rule ──────────────────────────────────────────────────────────

export const targetBonusRuleCreateSchema = z
  .object({
    shiftTypeId:  z.string().uuid(),
    targetAmount: z.number().positive(),
    bonusAmount:  z.number().nonnegative(),
    isActive:     z.boolean().default(true),
  })
  .strict();

export type TargetBonusRuleCreateInput = z.infer<typeof targetBonusRuleCreateSchema>;

export const targetBonusRuleUpdateSchema = z
  .object({
    targetAmount: z.number().positive().optional(),
    bonusAmount:  z.number().nonnegative().optional(),
    isActive:     z.boolean().optional(),
  })
  .strict();

export type TargetBonusRuleUpdateInput = z.infer<typeof targetBonusRuleUpdateSchema>;
