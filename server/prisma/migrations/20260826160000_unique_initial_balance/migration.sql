-- One INITIAL_BALANCE movement per cash account (production cutover).
-- Additive only — does not drop or alter cash table data.

CREATE UNIQUE INDEX "unique_initial_balance_per_account"
  ON "cash_movements" ("cash_account_id")
  WHERE "type" = 'INITIAL_BALANCE';
