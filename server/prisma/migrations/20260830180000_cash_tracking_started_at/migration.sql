-- Cutover guard: sessions before cash_tracking_started_at must not receive first SESSION_PAYMENT.
-- Additive only — backfill from existing cutover movements, never touches balances.

ALTER TABLE "cash_accounts"
  ADD COLUMN IF NOT EXISTS "cash_tracking_started_at" TIMESTAMPTZ;

-- Prefer INITIAL_BALANCE as the official cutover moment.
UPDATE "cash_accounts" ca
SET "cash_tracking_started_at" = sub.first_at
FROM (
  SELECT "cash_account_id", MIN("created_at") AS first_at
  FROM "cash_movements"
  WHERE "type" = 'INITIAL_BALANCE'
  GROUP BY "cash_account_id"
) sub
WHERE ca."id" = sub."cash_account_id"
  AND ca."cash_tracking_started_at" IS NULL;

-- Fallback: first movement on the till (e.g. ADMIN_ADJUSTMENT cutover without INITIAL_BALANCE).
UPDATE "cash_accounts" ca
SET "cash_tracking_started_at" = sub.first_at
FROM (
  SELECT "cash_account_id", MIN("created_at") AS first_at
  FROM "cash_movements"
  GROUP BY "cash_account_id"
) sub
WHERE ca."id" = sub."cash_account_id"
  AND ca."cash_tracking_started_at" IS NULL;
