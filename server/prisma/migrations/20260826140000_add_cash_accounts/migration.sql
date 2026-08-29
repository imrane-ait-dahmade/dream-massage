-- Per-staff cumulative cash ledger (additive; does not alter shift till columns).
-- IDs are TEXT to match existing staff_members / users primary keys.
-- Idempotent cleanup for a previous partial apply of this migration.

DROP TABLE IF EXISTS "cash_movements" CASCADE;
DROP TABLE IF EXISTS "cash_accounts" CASCADE;
DROP TYPE IF EXISTS "CashMovementType" CASCADE;

CREATE TYPE "CashMovementType" AS ENUM (
  'INITIAL_BALANCE',
  'SESSION_PAYMENT',
  'MANUAL_INCOME',
  'WITHDRAWAL',
  'ADMIN_ADJUSTMENT',
  'CORRECTION',
  'REVERSAL'
);

CREATE TABLE "cash_accounts" (
  "id" TEXT NOT NULL,
  "staff_member_id" TEXT NOT NULL,
  "current_balance" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_accounts_staff_member_id_key" ON "cash_accounts"("staff_member_id");

ALTER TABLE "cash_accounts"
  ADD CONSTRAINT "cash_accounts_staff_member_id_fkey"
  FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cash_movements" (
  "id" TEXT NOT NULL,
  "cash_account_id" TEXT NOT NULL,
  "staff_member_id" TEXT NOT NULL,
  "type" "CashMovementType" NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "balance_before" DECIMAL(12, 2) NOT NULL,
  "balance_after" DECIMAL(12, 2) NOT NULL,
  "reference_type" VARCHAR(50),
  "reference_id" TEXT,
  "reason" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_movements_cash_account_id_created_at_idx"
  ON "cash_movements"("cash_account_id", "created_at");

CREATE INDEX "cash_movements_staff_member_id_created_at_idx"
  ON "cash_movements"("staff_member_id", "created_at");

CREATE INDEX "cash_movements_reference_type_reference_id_idx"
  ON "cash_movements"("reference_type", "reference_id");

CREATE INDEX "cash_movements_type_created_at_idx"
  ON "cash_movements"("type", "created_at");

ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_cash_account_id_fkey"
  FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one SESSION_PAYMENT row per session reference (anti double-count of first credit).
CREATE UNIQUE INDEX "unique_session_payment_per_reference"
  ON "cash_movements" ("reference_type", "reference_id")
  WHERE "type" = 'SESSION_PAYMENT'
    AND "reference_type" IS NOT NULL
    AND "reference_id" IS NOT NULL;
