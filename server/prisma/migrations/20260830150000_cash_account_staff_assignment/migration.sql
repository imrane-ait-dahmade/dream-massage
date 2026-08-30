-- Assign each physical till to at most one active staff member (current assignment).
-- CashMovement.staff_member_id is unchanged (historical attribution).
-- Additive only — no data loss.

ALTER TABLE "cash_accounts"
  ADD COLUMN IF NOT EXISTS "staff_member_id" TEXT;

ALTER TABLE "cash_accounts" DROP CONSTRAINT IF EXISTS "cash_accounts_staff_member_id_fkey";
ALTER TABLE "cash_accounts"
  ADD CONSTRAINT "cash_accounts_staff_member_id_fkey"
  FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "cash_accounts_staff_member_id_idx"
  ON "cash_accounts"("staff_member_id");

-- One active staff member cannot be assigned to two physical tills at once.
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_staff_per_physical_till"
  ON "cash_accounts" ("staff_member_id")
  WHERE "staff_member_id" IS NOT NULL AND "is_active" = true;
