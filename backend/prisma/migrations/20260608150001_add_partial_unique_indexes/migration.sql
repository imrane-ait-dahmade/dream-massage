-- ============================================================
-- Migration 5: Partial unique indexes (raw SQL — Prisma cannot
-- express WHERE-clause partial indexes in schema.prisma)
-- ============================================================

-- One active detection config per chair at a time.
-- Prevents the billing service from picking up multiple configs for the same chair.
CREATE UNIQUE INDEX "unique_active_detection_config_per_chair"
  ON "chair_detection_configs" ("chair_id")
  WHERE is_active = true;

-- One active pricing rule at a time.
-- Prevents non-deterministic pricing when multiple rules are inadvertently active.
CREATE UNIQUE INDEX "unique_active_pricing_rule"
  ON "pricing_rules" (is_active)
  WHERE is_active = true;

-- One open shift at a time.
-- Prevents sessions from being split across two concurrent shifts, which would
-- break cash reconciliation.
CREATE UNIQUE INDEX "unique_open_shift"
  ON "shifts" (status)
  WHERE status = 'OPEN';
