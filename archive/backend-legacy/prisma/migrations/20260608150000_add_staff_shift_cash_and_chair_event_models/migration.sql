-- ============================================================
-- Migration 4: Staff, Shift, CashDeclaration, ChairEvent models
-- + Chair state machine timing columns
-- + ChairSession correction audit columns
-- + Recreate UserRole enum without ASSISTANT
-- ============================================================

-- ── 1. Recreate UserRole enum (PostgreSQL does not support DROP VALUE) ────────
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN');
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole"
  USING "role"::text::"UserRole";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'ADMIN';
DROP TYPE "UserRole_old";

-- ── 2. Add state machine timing columns to chairs ─────────────────────────────
ALTER TABLE "chairs"
  ADD COLUMN "maybe_active_since"    TIMESTAMP(3),
  ADD COLUMN "maybe_finished_since"  TIMESTAMP(3),
  ADD COLUMN "state_changed_at"      TIMESTAMP(3),
  ADD COLUMN "status_before_offline" "ChairStatus",
  ADD COLUMN "offline_since"         TIMESTAMP(3),
  ADD COLUMN "last_online_at"        TIMESTAMP(3);

-- ── 3. Add correction audit columns to chair_sessions ────────────────────────
ALTER TABLE "chair_sessions"
  ADD COLUMN "corrected_by_user_id" TEXT,
  ADD COLUMN "corrected_at"         TIMESTAMP(3);

-- ── 4. Create staff_members ───────────────────────────────────────────────────
CREATE TABLE "staff_members" (
    "id"         TEXT          NOT NULL,
    "name"       VARCHAR(100)  NOT NULL,
    "phone"      VARCHAR(30),
    "is_active"  BOOLEAN       NOT NULL DEFAULT true,
    "notes"      TEXT,
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_members_is_active_idx" ON "staff_members"("is_active");

-- ── 5. Create shifts ──────────────────────────────────────────────────────────
CREATE TABLE "shifts" (
    "id"                TEXT          NOT NULL,
    "staff_member_id"   TEXT          NOT NULL,
    "opened_by_user_id" TEXT          NOT NULL,
    "closed_by_user_id" TEXT,
    "started_at"        TIMESTAMP(3)  NOT NULL,
    "ended_at"          TIMESTAMP(3),
    "status"            "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "expected_cash"     DECIMAL(10,2),
    "declared_cash"     DECIMAL(10,2),
    "difference_cash"   DECIMAL(10,2),
    "notes"             TEXT,
    "created_at"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shifts_status_idx"          ON "shifts"("status");
CREATE INDEX "shifts_started_at_idx"      ON "shifts"("started_at");
CREATE INDEX "shifts_staff_member_id_idx" ON "shifts"("staff_member_id");

-- ── 6. Create cash_declarations ───────────────────────────────────────────────
CREATE TABLE "cash_declarations" (
    "id"                   TEXT          NOT NULL,
    "shift_id"             TEXT          NOT NULL,
    "recorded_by_user_id"  TEXT          NOT NULL,
    "expected_amount"      DECIMAL(10,2) NOT NULL,
    "declared_amount"      DECIMAL(10,2) NOT NULL,
    "difference_amount"    DECIMAL(10,2) NOT NULL,
    "declaration_type"     VARCHAR(50)   NOT NULL DEFAULT 'end_shift',
    "notes"                TEXT,
    "created_at"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_declarations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_declarations_shift_id_idx"   ON "cash_declarations"("shift_id");
CREATE INDEX "cash_declarations_created_at_idx" ON "cash_declarations"("created_at");

-- ── 7. Create chair_events ────────────────────────────────────────────────────
CREATE TABLE "chair_events" (
    "id"          TEXT         NOT NULL,
    "chair_id"    TEXT         NOT NULL,
    "session_id"  TEXT,
    "event_type"  VARCHAR(50)  NOT NULL,
    "from_status" "ChairStatus",
    "to_status"   "ChairStatus",
    "power_watts" DOUBLE PRECISION,
    "message"     TEXT,
    "metadata"    JSONB,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chair_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chair_events_chair_id_idx"            ON "chair_events"("chair_id");
CREATE INDEX "chair_events_session_id_idx"          ON "chair_events"("session_id");
CREATE INDEX "chair_events_event_type_idx"          ON "chair_events"("event_type");
CREATE INDEX "chair_events_created_at_idx"          ON "chair_events"("created_at");
CREATE INDEX "chair_events_chair_id_created_at_idx" ON "chair_events"("chair_id", "created_at");

-- ── 8. Foreign key constraints ────────────────────────────────────────────────

-- shifts → staff_members / users
ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id")   REFERENCES "staff_members"("id") ON DELETE RESTRICT  ON UPDATE CASCADE,
  ADD CONSTRAINT "shifts_opened_by_user_id_fkey"
    FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id")         ON DELETE RESTRICT  ON UPDATE CASCADE,
  ADD CONSTRAINT "shifts_closed_by_user_id_fkey"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id")         ON DELETE SET NULL  ON UPDATE CASCADE;

-- cash_declarations → shifts / users
ALTER TABLE "cash_declarations"
  ADD CONSTRAINT "cash_declarations_shift_id_fkey"
    FOREIGN KEY ("shift_id")            REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_declarations_recorded_by_user_id_fkey"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id")  ON DELETE RESTRICT ON UPDATE CASCADE;

-- chair_events → chairs / chair_sessions
ALTER TABLE "chair_events"
  ADD CONSTRAINT "chair_events_chair_id_fkey"
    FOREIGN KEY ("chair_id")   REFERENCES "chairs"("id")        ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "chair_events_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "chair_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- chair_sessions: wire shift FK + correction audit FK
ALTER TABLE "chair_sessions"
  ADD CONSTRAINT "chair_sessions_shift_id_fkey"
    FOREIGN KEY ("shift_id")             REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "chair_sessions_corrected_by_user_id_fkey"
    FOREIGN KEY ("corrected_by_user_id") REFERENCES "users"("id")  ON DELETE SET NULL ON UPDATE CASCADE;
