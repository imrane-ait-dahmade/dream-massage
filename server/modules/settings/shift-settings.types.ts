import { z } from 'zod';

// ── Staff Schedule ─────────────────────────────────────────────────────────────
// Planning assigns staff + shift type + day only.
// Hours come from ShiftType — StaffSchedule.startTime/endTime are deprecated.

export const scheduleCreateSchema = z
  .object({
    staffMemberId: z.string().uuid(),
    shiftTypeId:   z.string().uuid().nullable().optional(),
    dayOfWeek:     z.number().int().min(1).max(7),
    isOff:         z.boolean().default(false),
    notes:         z.string().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (!d.isOff && !d.shiftTypeId) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        message: 'shiftTypeId est requis lorsque isOff est false',
        path:    ['shiftTypeId'],
      });
    }
  });

export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>;

export const scheduleUpdateSchema = z
  .object({
    shiftTypeId: z.string().uuid().nullable().optional(),
    isOff:       z.boolean().optional(),
    isActive:    z.boolean().optional(),
    notes:       z.string().max(500).nullable().optional(),
  })
  .strict();

export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;
