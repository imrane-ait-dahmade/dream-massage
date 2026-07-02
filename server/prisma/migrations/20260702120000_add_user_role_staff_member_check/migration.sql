-- Enforce the User / StaffMember role invariant at the database level:
--   role = 'ASSISTANT'        => staff_member_id IS NOT NULL
--   role IN ('OWNER','ADMIN') => staff_member_id IS NULL
--
-- Additive only: no DROP, no TRUNCATE, no data rewrite.
-- Added NOT VALID so existing rows are NOT scanned/locked at deploy time.
-- Verified via a read-only pre-check against production data before writing this
-- migration: 0 existing rows violate the rule, so validating is safe once deployed.
-- Run the companion VALIDATE CONSTRAINT statement manually after this migration
-- has been applied (see server/docs/MIGRATION_NOTES_user_staff_check.md).
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_staff_member_check"
  CHECK (
    ("role" = 'ASSISTANT' AND "staff_member_id" IS NOT NULL)
    OR
    ("role" IN ('OWNER', 'ADMIN') AND "staff_member_id" IS NULL)
  ) NOT VALID;
