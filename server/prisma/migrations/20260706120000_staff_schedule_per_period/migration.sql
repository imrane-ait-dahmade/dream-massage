-- Allow Matin + Soir on the same day for one staff member.
-- Replace unique (staff_member_id, day_of_week) with per-period uniqueness.

-- Deactivate forbidden shift types (Journée, etc.)
UPDATE "shift_types"
SET "is_active" = false
WHERE UPPER(REPLACE("name", 'é', 'e')) IN ('JOURNEE', 'DAY', 'FULL_DAY', 'FULLDAY');

-- Split active Journée planning rows into Matin + Soir (idempotent inserts)
INSERT INTO "staff_schedules" (
  "id", "staff_member_id", "shift_type_id", "day_of_week",
  "start_time", "end_time", "is_off", "is_active", "notes",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  s."staff_member_id",
  matin."id",
  s."day_of_week",
  matin."start_time",
  matin."end_time",
  false,
  true,
  COALESCE(s."notes", '') || ' (migré depuis Journée)',
  NOW(),
  NOW()
FROM "staff_schedules" s
INNER JOIN "shift_types" j ON s."shift_type_id" = j."id"
  AND UPPER(REPLACE(j."name", 'é', 'e')) = 'JOURNEE'
INNER JOIN "shift_types" matin ON UPPER(matin."name") = 'MATIN' AND matin."is_active" = true
WHERE s."is_active" = true
  AND s."is_off" = false
  AND NOT EXISTS (
    SELECT 1 FROM "staff_schedules" ex
    WHERE ex."staff_member_id" = s."staff_member_id"
      AND ex."day_of_week" = s."day_of_week"
      AND ex."shift_type_id" = matin."id"
      AND ex."is_active" = true
      AND ex."is_off" = false
  );

INSERT INTO "staff_schedules" (
  "id", "staff_member_id", "shift_type_id", "day_of_week",
  "start_time", "end_time", "is_off", "is_active", "notes",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  s."staff_member_id",
  soir."id",
  s."day_of_week",
  soir."start_time",
  soir."end_time",
  false,
  true,
  COALESCE(s."notes", '') || ' (migré depuis Journée)',
  NOW(),
  NOW()
FROM "staff_schedules" s
INNER JOIN "shift_types" j ON s."shift_type_id" = j."id"
  AND UPPER(REPLACE(j."name", 'é', 'e')) = 'JOURNEE'
INNER JOIN "shift_types" soir ON UPPER(soir."name") = 'SOIR' AND soir."is_active" = true
WHERE s."is_active" = true
  AND s."is_off" = false
  AND NOT EXISTS (
    SELECT 1 FROM "staff_schedules" ex
    WHERE ex."staff_member_id" = s."staff_member_id"
      AND ex."day_of_week" = s."day_of_week"
      AND ex."shift_type_id" = soir."id"
      AND ex."is_active" = true
      AND ex."is_off" = false
  );

-- Deactivate migrated Journée schedule rows
UPDATE "staff_schedules" s
SET "is_active" = false, "updated_at" = NOW()
FROM "shift_types" j
WHERE s."shift_type_id" = j."id"
  AND UPPER(REPLACE(j."name", 'é', 'e')) = 'JOURNEE'
  AND s."is_active" = true;

DROP INDEX IF EXISTS "unique_active_staff_schedule_per_day";

CREATE UNIQUE INDEX "unique_active_staff_schedule_per_day_period"
  ON "staff_schedules" ("staff_member_id", "day_of_week", "shift_type_id")
  WHERE "is_active" = true AND "is_off" = false AND "shift_type_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_active_staff_off_per_day"
  ON "staff_schedules" ("staff_member_id", "day_of_week")
  WHERE "is_active" = true AND "is_off" = true;
