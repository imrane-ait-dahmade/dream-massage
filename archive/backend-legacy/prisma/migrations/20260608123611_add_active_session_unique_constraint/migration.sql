-- Partial unique index: one ACTIVE session per chair at most.
-- Prisma cannot express WHERE-clause partial indexes in schema.prisma,
-- so this is maintained as a manual migration step.
-- This guarantees at the database level that no chair can have two
-- simultaneous ACTIVE sessions, even under concurrent polling writes.
CREATE UNIQUE INDEX "unique_active_session_per_chair"
  ON "chair_sessions" ("chair_id")
  WHERE status = 'ACTIVE';
