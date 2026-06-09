# Raw SQL Constraints — server/prisma

Prisma cannot express partial unique indexes (WHERE-clause indexes) in `schema.prisma`.
These must be applied manually after running `prisma migrate dev`.

## How to apply

After `prisma migrate dev --name init_mvp_schema` creates the migration file at
`server/prisma/migrations/<timestamp>_init_mvp_schema/migration.sql`, open that file
and append the following SQL **before** running the migration, or apply it separately
via Supabase SQL editor.

---

## Required Partial Unique Indexes

### 1. One active session per chair

Prevents two simultaneous ACTIVE sessions on the same chair, even under concurrent writes.

```sql
CREATE UNIQUE INDEX unique_active_session_per_chair
  ON chair_sessions (chair_id)
  WHERE status = 'ACTIVE';
```

### 2. One active detection config per chair

Ensures exactly one config row drives detection for each chair at any given time.

```sql
CREATE UNIQUE INDEX unique_active_detection_config_per_chair
  ON chair_detection_configs (chair_id)
  WHERE is_active = true;
```

### 3. One active pricing rule

Prevents two active billing rulesets from co-existing, which would make billing non-deterministic.

```sql
CREATE UNIQUE INDEX unique_active_pricing_rule
  ON pricing_rules (is_active)
  WHERE is_active = true;
```

### 4. One open shift

Prevents two concurrent open shifts, which would cause sessions to be double-counted in cash reconciliation.

```sql
CREATE UNIQUE INDEX unique_open_shift
  ON shifts (status)
  WHERE status = 'OPEN';
```

---

## When to apply

Apply these immediately after the initial migration succeeds and before the server
starts processing real Shelly data. Applying them to an already-running database
with data is safe as long as no violations exist (the index creation will fail with
a unique violation error if duplicates are present).

## Verification

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('chair_sessions', 'chair_detection_configs', 'pricing_rules', 'shifts')
  AND indexname LIKE 'unique_%';
```
