-- Archive fields for soft-deleting chair sessions without breaking shift/report history.
ALTER TABLE "chair_sessions" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "chair_sessions" ADD COLUMN "archived_by_id" TEXT;
ALTER TABLE "chair_sessions" ADD COLUMN "archive_reason" TEXT;

CREATE INDEX "chair_sessions_archived_at_idx" ON "chair_sessions"("archived_at");
