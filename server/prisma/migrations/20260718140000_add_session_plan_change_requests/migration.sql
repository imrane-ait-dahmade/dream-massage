-- Additive only: session plan change request workflow (OWNER direct + ASSISTANT approval).
-- No DROP / RENAME / destructive ALTER on existing production tables.

-- CreateEnum
CREATE TYPE "SessionPlanChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "session_plan_change_requests" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "reviewed_by_user_id" TEXT,
    "original_plan_id" TEXT,
    "requested_plan_id" TEXT,
    "original_plan_name" VARCHAR(100),
    "requested_plan_name" VARCHAR(100) NOT NULL,
    "original_duration_seconds" INTEGER,
    "requested_duration_seconds" INTEGER NOT NULL,
    "original_expected_amount" DECIMAL(10,2),
    "requested_expected_amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SessionPlanChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "session_matched_plan_id_at_request" TEXT,
    "session_updated_at_at_request" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_plan_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_plan_change_requests_session_id_idx" ON "session_plan_change_requests"("session_id");

-- CreateIndex
CREATE INDEX "session_plan_change_requests_status_idx" ON "session_plan_change_requests"("status");

-- CreateIndex
CREATE INDEX "session_plan_change_requests_requested_by_user_id_idx" ON "session_plan_change_requests"("requested_by_user_id");

-- CreateIndex
CREATE INDEX "session_plan_change_requests_created_at_idx" ON "session_plan_change_requests"("created_at");

-- At most one PENDING request per session (concurrency safety)
CREATE UNIQUE INDEX "unique_pending_plan_change_per_session"
  ON "session_plan_change_requests"("session_id")
  WHERE "status" = 'PENDING';

-- AddForeignKey (Restrict / SetNull only — never Cascade historical rows)
ALTER TABLE "session_plan_change_requests"
  ADD CONSTRAINT "session_plan_change_requests_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "chair_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "session_plan_change_requests"
  ADD CONSTRAINT "session_plan_change_requests_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "session_plan_change_requests"
  ADD CONSTRAINT "session_plan_change_requests_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "session_plan_change_requests"
  ADD CONSTRAINT "session_plan_change_requests_original_plan_id_fkey"
  FOREIGN KEY ("original_plan_id") REFERENCES "pricing_plans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "session_plan_change_requests"
  ADD CONSTRAINT "session_plan_change_requests_requested_plan_id_fkey"
  FOREIGN KEY ("requested_plan_id") REFERENCES "pricing_plans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
