-- Physical cash registers (additive).
-- Transforms staff-owned cash_accounts → physical tills CASH_1 / CASH_2.
-- Preserves existing cash_movements (remap to CASH_1 if any).
-- Does NOT DROP cash_accounts / cash_movements tables.

-- 1) Physical register columns
ALTER TABLE "cash_accounts"
  ADD COLUMN IF NOT EXISTS "code" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "name" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

-- 2) Shift / schedule → physical till
ALTER TABLE "shifts"
  ADD COLUMN IF NOT EXISTS "cash_account_id" TEXT;

ALTER TABLE "staff_schedules"
  ADD COLUMN IF NOT EXISTS "cash_account_id" TEXT;

-- 3) Movements may omit staff (admin till ops / cutover)
ALTER TABLE "cash_movements"
  ALTER COLUMN "staff_member_id" DROP NOT NULL;

-- 4) Release staff ownership on accounts
ALTER TABLE "cash_accounts"
  DROP CONSTRAINT IF EXISTS "cash_accounts_staff_member_id_fkey";

DROP INDEX IF EXISTS "cash_accounts_staff_member_id_key";

ALTER TABLE "cash_accounts"
  ALTER COLUMN "staff_member_id" DROP NOT NULL;

-- 5) Seed physical tills (idempotent)
INSERT INTO "cash_accounts" ("id", "code", "name", "current_balance", "is_active", "created_at", "updated_at", "staff_member_id")
SELECT gen_random_uuid()::text, 'CASH_1', 'Caisse 1', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (SELECT 1 FROM "cash_accounts" WHERE "code" = 'CASH_1');

INSERT INTO "cash_accounts" ("id", "code", "name", "current_balance", "is_active", "created_at", "updated_at", "staff_member_id")
SELECT gen_random_uuid()::text, 'CASH_2', 'Caisse 2', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (SELECT 1 FROM "cash_accounts" WHERE "code" = 'CASH_2');

-- 6) Remap legacy movements → Caisse 1 (keep staff_member_id on rows)
UPDATE "cash_movements" m
SET "cash_account_id" = (SELECT "id" FROM "cash_accounts" WHERE "code" = 'CASH_1' LIMIT 1)
WHERE m."cash_account_id" IN (
  SELECT a."id" FROM "cash_accounts" a
  WHERE a."code" IS NULL OR a."code" NOT IN ('CASH_1', 'CASH_2')
);

-- 7) Remove obsolete staff-owned accounts
DELETE FROM "cash_accounts"
WHERE "code" IS NULL OR "code" NOT IN ('CASH_1', 'CASH_2');

-- 8) Normalize names + enforce identity
UPDATE "cash_accounts" SET "name" = 'Caisse 1' WHERE "code" = 'CASH_1';
UPDATE "cash_accounts" SET "name" = 'Caisse 2' WHERE "code" = 'CASH_2';

ALTER TABLE "cash_accounts"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "name" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "cash_accounts_code_key" ON "cash_accounts"("code");

-- 9) Drop obsolete ownership column
ALTER TABLE "cash_accounts" DROP COLUMN IF EXISTS "staff_member_id";

-- 10) FKs + indexes
ALTER TABLE "shifts" DROP CONSTRAINT IF EXISTS "shifts_cash_account_id_fkey";
ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_cash_account_id_fkey"
  FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "shifts_cash_account_id_idx" ON "shifts"("cash_account_id");

ALTER TABLE "staff_schedules" DROP CONSTRAINT IF EXISTS "staff_schedules_cash_account_id_fkey";
ALTER TABLE "staff_schedules"
  ADD CONSTRAINT "staff_schedules_cash_account_id_fkey"
  FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "staff_schedules_cash_account_id_idx" ON "staff_schedules"("cash_account_id");

-- At most one OPEN shift per physical till
CREATE UNIQUE INDEX IF NOT EXISTS "unique_open_shift_per_cash_account"
  ON "shifts" ("cash_account_id")
  WHERE "status" = 'OPEN' AND "cash_account_id" IS NOT NULL;
