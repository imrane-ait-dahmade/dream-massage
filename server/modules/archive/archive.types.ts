import { z } from 'zod';

export const archiveReasonSchema = z.object({
  reason: z.string().max(500).optional(),
  reactivateLinkedUser: z.boolean().optional(),
});

export type ArchiveReasonInput = z.infer<typeof archiveReasonSchema>;

export const bulkMaintenanceSchema = z.object({
  confirmation: z.string().min(1),
  reason:       z.string().max(500).optional(),
});

export type BulkMaintenanceInput = z.infer<typeof bulkMaintenanceSchema>;

export type HardDeleteCheck = {
  allowed: boolean;
  blockers: string[];
};
