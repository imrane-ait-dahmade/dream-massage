-- Additive archive fields — no data loss, no table drops.

ALTER TABLE "staff_members"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "archive_reason" TEXT;

CREATE INDEX IF NOT EXISTS "staff_members_archived_at_idx" ON "staff_members" ("archived_at");

ALTER TABLE "staff_schedules"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "archive_reason" TEXT;

CREATE INDEX IF NOT EXISTS "staff_schedules_archived_at_idx" ON "staff_schedules" ("archived_at");

ALTER TABLE "shift_types"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "archive_reason" TEXT;

CREATE INDEX IF NOT EXISTS "shift_types_archived_at_idx" ON "shift_types" ("archived_at");

ALTER TABLE "shifts"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "archive_reason" TEXT;

CREATE INDEX IF NOT EXISTS "shifts_archived_at_idx" ON "shifts" ("archived_at");

ALTER TABLE "pricing_plans"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "archive_reason" TEXT;

CREATE INDEX IF NOT EXISTS "pricing_plans_archived_at_idx" ON "pricing_plans" ("archived_at");
