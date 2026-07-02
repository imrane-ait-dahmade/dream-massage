# Migration: `20260702120000_add_user_role_staff_member_check`

## What it does

Adds one additive CHECK constraint to `users`:

```sql
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_staff_member_check"
  CHECK (
    ("role" = 'ASSISTANT' AND "staff_member_id" IS NOT NULL)
    OR
    ("role" IN ('OWNER', 'ADMIN') AND "staff_member_id" IS NULL)
  ) NOT VALID;
```

No `DROP`, no `TRUNCATE`, no column type change, no data rewrite. `NOT VALID` means
Postgres does **not** scan existing rows when the migration runs — it only enforces the
rule for rows inserted/updated from this point forward. Existing rows are validated in
a separate, manual step (below), so the migration itself cannot fail or lock the table
because of pre-existing data.

## Pre-deploy verification already performed

Ran a read-only query against the current database on 2026-07-02:

```sql
SELECT id, email, role, staff_member_id FROM users
WHERE (role = 'ASSISTANT' AND staff_member_id IS NULL)
   OR (role IN ('OWNER','ADMIN') AND staff_member_id IS NOT NULL);
```

Result: **0 rows**. Both existing users (`owner@example.com` / OWNER / staff_member_id
NULL, `assistant@example.com` / ASSISTANT / staff_member_id = Oumaima's id) already
satisfy the rule. Validating the constraint after deploy is expected to succeed
immediately.

## Manual step after this migration is deployed

`fly.toml`'s `release_command = "npx prisma migrate deploy"` will apply the `NOT VALID`
constraint automatically on the next deploy. After that deploy finishes, run once
(no urgency, no downtime risk — `VALIDATE CONSTRAINT` only takes a `SHARE UPDATE
EXCLUSIVE` lock, it does not block reads/writes):

```sql
ALTER TABLE "users" VALIDATE CONSTRAINT "users_role_staff_member_check";
```

If it ever fails, re-run the pre-check query above to find the offending row(s) before
deciding how to fix them — do not touch the constraint definition to make it pass.

## Known pre-existing gap (not introduced by this migration)

This repository had **no `prisma/migrations` folder at all** before this change — the
schema was historically kept in sync with `prisma db push` instead of tracked
migrations. This is migration #1 ever committed. Practical consequences:

- `prisma migrate deploy` (already wired into `release_command`) was previously a
  silent no-op on every deploy (no migrations to apply). It will now apply this one
  migration on the next deploy.
- There is still no tracked migration for the *original* schema (tables, other columns,
  other FKs) — only for this new constraint. If the database were ever recreated from
  scratch, `prisma migrate deploy` alone would not rebuild it; `prisma db push` (or a
  proper `prisma migrate dev --create-only` baseline against an **empty** database)
  would still be needed first. This is a pre-existing limitation, not something this
  migration makes worse — flagging it separately since it's a real disaster-recovery
  gap worth addressing later, on its own.
