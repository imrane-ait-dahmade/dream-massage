-- Prime / planning models referenced by later migrations (staff_schedule_per_period, seed).
-- Additive: creates missing tables and extends shifts for auto-shift + bonus.

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateTable shift_types
CREATE TABLE "shift_types" (
    "id"         TEXT         NOT NULL,
    "name"       VARCHAR(50)  NOT NULL,
    "label"      VARCHAR(100),
    "start_time" VARCHAR(5)   NOT NULL,
    "end_time"   VARCHAR(5)   NOT NULL,
    "is_active"  BOOLEAN      NOT NULL DEFAULT true,
    "sort_order" INTEGER      NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_types_name_key" ON "shift_types"("name");
CREATE INDEX "shift_types_is_active_idx" ON "shift_types"("is_active");

-- CreateTable staff_schedules
CREATE TABLE "staff_schedules" (
    "id"              TEXT         NOT NULL,
    "staff_member_id" TEXT         NOT NULL,
    "shift_type_id"   TEXT,
    "day_of_week"     INTEGER      NOT NULL,
    "start_time"      VARCHAR(5),
    "end_time"        VARCHAR(5),
    "is_off"          BOOLEAN      NOT NULL DEFAULT false,
    "is_active"       BOOLEAN      NOT NULL DEFAULT true,
    "notes"           TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_schedules_staff_member_id_idx" ON "staff_schedules"("staff_member_id");
CREATE INDEX "staff_schedules_shift_type_id_idx" ON "staff_schedules"("shift_type_id");
CREATE INDEX "staff_schedules_day_of_week_idx" ON "staff_schedules"("day_of_week");
CREATE INDEX "staff_schedules_is_active_idx" ON "staff_schedules"("is_active");

-- Legacy uniqueness (replaced in 20260706120000_staff_schedule_per_period)
CREATE UNIQUE INDEX "unique_active_staff_schedule_per_day"
  ON "staff_schedules" ("staff_member_id", "day_of_week")
  WHERE "is_active" = true;

-- CreateTable commission_rules
CREATE TABLE "commission_rules" (
    "id"                 TEXT             NOT NULL,
    "pricing_plan_id"    TEXT             NOT NULL,
    "type"               "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "value"              DECIMAL(8,4)     NOT NULL,
    "is_active"          BOOLEAN          NOT NULL DEFAULT true,
    "valid_from"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to"           TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commission_rules_pricing_plan_id_is_active_idx" ON "commission_rules"("pricing_plan_id", "is_active");
CREATE INDEX "commission_rules_is_active_idx" ON "commission_rules"("is_active");
CREATE INDEX "commission_rules_valid_from_idx" ON "commission_rules"("valid_from");

-- CreateTable shift_target_bonus_rules
CREATE TABLE "shift_target_bonus_rules" (
    "id"                 TEXT          NOT NULL,
    "shift_type_id"      TEXT          NOT NULL,
    "target_amount"      DECIMAL(10,2) NOT NULL,
    "bonus_amount"       DECIMAL(10,2) NOT NULL,
    "is_active"          BOOLEAN       NOT NULL DEFAULT true,
    "valid_from"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to"           TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "shift_target_bonus_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shift_target_bonus_rules_shift_type_id_is_active_idx" ON "shift_target_bonus_rules"("shift_type_id", "is_active");
CREATE INDEX "shift_target_bonus_rules_is_active_idx" ON "shift_target_bonus_rules"("is_active");
CREATE INDEX "shift_target_bonus_rules_target_amount_idx" ON "shift_target_bonus_rules"("target_amount");

-- CreateTable shift_bonus_adjustments
CREATE TABLE "shift_bonus_adjustments" (
    "id"                 TEXT          NOT NULL,
    "shift_id"           TEXT          NOT NULL,
    "amount"             DECIMAL(10,2) NOT NULL,
    "reason"             TEXT,
    "created_by_user_id" TEXT,
    "created_at"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_bonus_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shift_bonus_adjustments_shift_id_idx" ON "shift_bonus_adjustments"("shift_id");

-- Extend shifts for auto-shift + prime snapshot
ALTER TABLE "shifts"
  ADD COLUMN "shift_type_id"          TEXT,
  ADD COLUMN "staff_schedule_id"      TEXT,
  ADD COLUMN "business_date"          VARCHAR(10),
  ADD COLUMN "scheduled_start_at"     TIMESTAMP(3),
  ADD COLUMN "scheduled_end_at"       TIMESTAMP(3),
  ADD COLUMN "opened_automatically"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "closed_automatically"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "auto_close_reason"      VARCHAR(100),
  ADD COLUMN "gross_revenue"          DECIMAL(10,2),
  ADD COLUMN "plan_commission"        DECIMAL(10,2),
  ADD COLUMN "target_bonus"           DECIMAL(10,2),
  ADD COLUMN "manual_bonus"           DECIMAL(10,2),
  ADD COLUMN "total_prime"            DECIMAL(10,2),
  ADD COLUMN "net_revenue"            DECIMAL(10,2);

CREATE INDEX "shifts_shift_type_id_idx" ON "shifts"("shift_type_id");
CREATE INDEX "shifts_staff_schedule_id_idx" ON "shifts"("staff_schedule_id");
CREATE INDEX "shifts_business_date_idx" ON "shifts"("business_date");

CREATE UNIQUE INDEX "unique_auto_shift_per_schedule_day"
  ON "shifts" ("staff_schedule_id", "business_date")
  WHERE "staff_schedule_id" IS NOT NULL AND "business_date" IS NOT NULL;

-- Add pricing_rules.minimum_billable_seconds if missing (schema default 180)
ALTER TABLE "pricing_rules"
  ADD COLUMN IF NOT EXISTS "minimum_billable_seconds" INTEGER NOT NULL DEFAULT 180;

-- Foreign keys
ALTER TABLE "staff_schedules"
  ADD CONSTRAINT "staff_schedules_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_schedules_shift_type_id_fkey"
    FOREIGN KEY ("shift_type_id") REFERENCES "shift_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_pricing_plan_id_fkey"
    FOREIGN KEY ("pricing_plan_id") REFERENCES "pricing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "commission_rules_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shift_target_bonus_rules"
  ADD CONSTRAINT "shift_target_bonus_rules_shift_type_id_fkey"
    FOREIGN KEY ("shift_type_id") REFERENCES "shift_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shift_target_bonus_rules_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shift_bonus_adjustments"
  ADD CONSTRAINT "shift_bonus_adjustments_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shift_bonus_adjustments_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_shift_type_id_fkey"
    FOREIGN KEY ("shift_type_id") REFERENCES "shift_types"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "shifts_staff_schedule_id_fkey"
    FOREIGN KEY ("staff_schedule_id") REFERENCES "staff_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
