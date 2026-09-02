-- Self-start shift: at most one OPEN shift shop-wide (concurrency safety net).
-- Complements shift.service startAssistantShift transaction lock.
-- Safe when ALLOW_MULTIPLE_OPEN_SHIFTS=false (production default).

CREATE UNIQUE INDEX IF NOT EXISTS "unique_single_open_shift_shop_wide"
  ON "shifts" ((true))
  WHERE "status" = 'OPEN' AND "ended_at" IS NULL;
