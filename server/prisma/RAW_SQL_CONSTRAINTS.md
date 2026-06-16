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

### 5. One active schedule entry per staff member per day

Prevents conflicting planning rows: each staff member can have at most one active
schedule entry per ISO day-of-week. Deactivated (historical) rows are excluded so
the audit trail is preserved without causing index violations.

```sql
CREATE UNIQUE INDEX unique_active_staff_schedule_per_day
  ON staff_schedules (staff_member_id, day_of_week)
  WHERE is_active = true;
```

**Enforcement order**: `shift-settings.service.ts` deactivates the previous active
entry for the same `(staffMemberId, dayOfWeek)` pair before inserting a new one.
This index is the database-level safety net — it prevents race conditions if two
concurrent requests slip past the service-layer check.

### 6. No duplicate auto-shift for same schedule and business date

Prevents the auto-shift job from opening two shifts for the same weekly schedule
entry on the same calendar day (e.g., if the job runs while the server restarts).

```sql
CREATE UNIQUE INDEX unique_auto_shift_per_schedule_day
  ON shifts (staff_schedule_id, business_date)
  WHERE staff_schedule_id IS NOT NULL
    AND business_date IS NOT NULL;
```

**Enforcement order**: `auto-shift.service.ts` checks for an existing row before
inserting. This index is the database-level safety net against concurrent opens.

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
WHERE tablename IN ('chair_sessions', 'chair_detection_configs', 'pricing_rules', 'shifts', 'staff_schedules')
  AND indexname LIKE 'unique_%';
```
