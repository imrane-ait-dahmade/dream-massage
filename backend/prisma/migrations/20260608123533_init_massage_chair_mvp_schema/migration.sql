-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ChairStatus" AS ENUM ('IDLE', 'MAYBE_ACTIVE', 'ACTIVE', 'MAYBE_FINISHED', 'OFFLINE', 'ERROR', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'UNCERTAIN', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'CALCULATED', 'CORRECTED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('NEAREST_PLAN', 'NEXT_PLAN', 'EXACT_MINUTES');

-- CreateEnum
CREATE TYPE "OvertimePolicy" AS ENUM ('NEXT_PLAN', 'EXTRA_MINUTE', 'ANOMALY');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "DeviceLogSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ASSISTANT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairs" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(10) NOT NULL,
    "display_name" VARCHAR(100),
    "shelly_device_id" VARCHAR(100) NOT NULL,
    "shelly_channel" INTEGER NOT NULL DEFAULT 0,
    "status" "ChairStatus" NOT NULL DEFAULT 'IDLE',
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "current_power_watts" DOUBLE PRECISION,
    "relay_is_on" BOOLEAN,
    "last_synced_at" TIMESTAMP(3),
    "current_session_id" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chair_detection_configs" (
    "id" TEXT NOT NULL,
    "chair_id" TEXT NOT NULL,
    "start_threshold_watts" DOUBLE PRECISION NOT NULL DEFAULT 7,
    "stop_threshold_watts" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "start_confirm_seconds" INTEGER NOT NULL DEFAULT 30,
    "stop_confirm_seconds" INTEGER NOT NULL DEFAULT 180,
    "activation_delay_seconds" INTEGER NOT NULL DEFAULT 30,
    "baseline_power_watts" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chair_detection_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_plans" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "price_amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'MAD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "rounding_mode" "RoundingMode" NOT NULL DEFAULT 'NEXT_PLAN',
    "grace_seconds" INTEGER NOT NULL DEFAULT 120,
    "minimum_plan_id" TEXT,
    "overtime_policy" "OvertimePolicy" NOT NULL DEFAULT 'NEXT_PLAN',
    "extra_minute_price" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chair_sessions" (
    "id" TEXT NOT NULL,
    "chair_id" TEXT NOT NULL,
    "shift_id" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "detected_start_at" TIMESTAMP(3),
    "confirmed_start_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL,
    "low_power_detected_at" TIMESTAMP(3),
    "confirmed_end_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "start_power_watts" DOUBLE PRECISION,
    "end_power_watts" DOUBLE PRECISION,
    "min_power_watts" DOUBLE PRECISION,
    "max_power_watts" DOUBLE PRECISION,
    "avg_power_watts" DOUBLE PRECISION,
    "detection_config_id" TEXT,
    "detection_snapshot" JSONB,
    "matched_plan_id" TEXT,
    "expected_amount" DECIMAL(10,2),
    "pricing_snapshot" JSONB,
    "billing_status" "BillingStatus" NOT NULL DEFAULT 'PENDING',
    "anomaly_type" VARCHAR(100),
    "correction_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chair_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "chair_id" TEXT NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "power_watts" DOUBLE PRECISION,
    "message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_logs" (
    "id" TEXT NOT NULL,
    "chair_id" TEXT,
    "event_type" VARCHAR(50) NOT NULL,
    "message" TEXT,
    "power_watts" DOUBLE PRECISION,
    "raw_data" JSONB,
    "severity" "DeviceLogSeverity" NOT NULL DEFAULT 'INFO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" TEXT,
    "action" VARCHAR(50) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'string',
    "description" TEXT,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "chairs_name_key" ON "chairs"("name");

-- CreateIndex
CREATE UNIQUE INDEX "chairs_shelly_device_id_key" ON "chairs"("shelly_device_id");

-- CreateIndex
CREATE INDEX "chairs_status_idx" ON "chairs"("status");

-- CreateIndex
CREATE INDEX "chairs_is_online_idx" ON "chairs"("is_online");

-- CreateIndex
CREATE INDEX "chairs_last_synced_at_idx" ON "chairs"("last_synced_at");

-- CreateIndex
CREATE INDEX "chair_sessions_chair_id_idx" ON "chair_sessions"("chair_id");

-- CreateIndex
CREATE INDEX "chair_sessions_status_idx" ON "chair_sessions"("status");

-- CreateIndex
CREATE INDEX "chair_sessions_started_at_idx" ON "chair_sessions"("started_at");

-- CreateIndex
CREATE INDEX "chair_sessions_ended_at_idx" ON "chair_sessions"("ended_at");

-- CreateIndex
CREATE INDEX "chair_sessions_matched_plan_id_idx" ON "chair_sessions"("matched_plan_id");

-- CreateIndex
CREATE INDEX "chair_sessions_billing_status_idx" ON "chair_sessions"("billing_status");

-- CreateIndex
CREATE INDEX "chair_sessions_chair_id_status_idx" ON "chair_sessions"("chair_id", "status");

-- CreateIndex
CREATE INDEX "chair_sessions_chair_id_started_at_idx" ON "chair_sessions"("chair_id", "started_at");

-- CreateIndex
CREATE INDEX "session_events_session_id_idx" ON "session_events"("session_id");

-- CreateIndex
CREATE INDEX "session_events_chair_id_idx" ON "session_events"("chair_id");

-- CreateIndex
CREATE INDEX "session_events_event_type_idx" ON "session_events"("event_type");

-- CreateIndex
CREATE INDEX "session_events_created_at_idx" ON "session_events"("created_at");

-- CreateIndex
CREATE INDEX "session_events_session_id_created_at_idx" ON "session_events"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "device_logs_chair_id_idx" ON "device_logs"("chair_id");

-- CreateIndex
CREATE INDEX "device_logs_event_type_idx" ON "device_logs"("event_type");

-- CreateIndex
CREATE INDEX "device_logs_severity_idx" ON "device_logs"("severity");

-- CreateIndex
CREATE INDEX "device_logs_created_at_idx" ON "device_logs"("created_at");

-- CreateIndex
CREATE INDEX "settings_audit_logs_user_id_idx" ON "settings_audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "settings_audit_logs_entity_type_idx" ON "settings_audit_logs"("entity_type");

-- CreateIndex
CREATE INDEX "settings_audit_logs_entity_id_idx" ON "settings_audit_logs"("entity_id");

-- CreateIndex
CREATE INDEX "settings_audit_logs_created_at_idx" ON "settings_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "settings_audit_logs_entity_type_entity_id_idx" ON "settings_audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_key_key" ON "app_settings"("key");

-- AddForeignKey
ALTER TABLE "chair_detection_configs" ADD CONSTRAINT "chair_detection_configs_chair_id_fkey" FOREIGN KEY ("chair_id") REFERENCES "chairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chair_detection_configs" ADD CONSTRAINT "chair_detection_configs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_plans" ADD CONSTRAINT "pricing_plans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_minimum_plan_id_fkey" FOREIGN KEY ("minimum_plan_id") REFERENCES "pricing_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chair_sessions" ADD CONSTRAINT "chair_sessions_chair_id_fkey" FOREIGN KEY ("chair_id") REFERENCES "chairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chair_sessions" ADD CONSTRAINT "chair_sessions_matched_plan_id_fkey" FOREIGN KEY ("matched_plan_id") REFERENCES "pricing_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chair_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_logs" ADD CONSTRAINT "device_logs_chair_id_fkey" FOREIGN KEY ("chair_id") REFERENCES "chairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings_audit_logs" ADD CONSTRAINT "settings_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
