-- Optional link from User (ASSISTANT login) to StaffMember.
-- Required before users_role_staff_member_check references staff_member_id.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "staff_member_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_staff_member_id_key"
  ON "users"("staff_member_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_staff_member_id_fkey'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_staff_member_id_fkey"
      FOREIGN KEY ("staff_member_id")
      REFERENCES "staff_members"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
