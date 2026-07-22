-- Additive only: allow plan-change requests to also (or only) change paid amount.
-- paidAmount is stored on chair_sessions.corrected_amount (unchanged column).
-- No DROP / RENAME / destructive ALTER on chair_sessions.

-- Allow amount-only requests (no plan change): plan snapshot fields become nullable.
ALTER TABLE "session_plan_change_requests"
  ALTER COLUMN "requested_plan_name" DROP NOT NULL;

ALTER TABLE "session_plan_change_requests"
  ALTER COLUMN "requested_duration_seconds" DROP NOT NULL;

ALTER TABLE "session_plan_change_requests"
  ALTER COLUMN "requested_expected_amount" DROP NOT NULL;

-- Snapshots for paid-amount changes.
-- NULL requested_paid_amount = no paid change requested.
-- 0 = explicit request to set paid amount to 0 DH (valid).
ALTER TABLE "session_plan_change_requests"
  ADD COLUMN "original_paid_amount" DECIMAL(10,2),
  ADD COLUMN "requested_paid_amount" DECIMAL(10,2);
