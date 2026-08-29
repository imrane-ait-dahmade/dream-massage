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

### 4. One open shift per physical till

With multiple open shifts allowed (`ALLOW_MULTIPLE_OPEN_SHIFTS`), at most one OPEN
shift may use a given physical cash account (`Caisse 1` / `Caisse 2`).

```sql
-- Legacy shop-wide guard (drop when multi-open is enabled):
-- DROP INDEX IF EXISTS unique_open_shift;

CREATE UNIQUE INDEX unique_open_shift_per_cash_account
  ON shifts (cash_account_id)
  WHERE status = 'OPEN' AND cash_account_id IS NOT NULL;
```

Migration `20260826180000_physical_cash_registers` creates this index.
Enforced also in `shift.service.ts` openShift (closes same-till OPEN before create).

**Note**: The older `unique_open_shift` (one OPEN row shop-wide) conflicts with
multi-till operation and must be dropped when `ALLOW_MULTIPLE_OPEN_SHIFTS=true`.

### 5. One active schedule entry per staff member per day per period

Each staff member can have at most one active Matin and one active Soir row per ISO
day-of-week. The same person may have both periods on the same day. Rest-day (is_off)
rows remain unique per staff + day.

```sql
DROP INDEX IF EXISTS unique_active_staff_schedule_per_day;

CREATE UNIQUE INDEX unique_active_staff_schedule_per_day_period
  ON staff_schedules (staff_member_id, day_of_week, shift_type_id)
  WHERE is_active = true AND is_off = false AND shift_type_id IS NOT NULL;

CREATE UNIQUE INDEX unique_active_staff_off_per_day
  ON staff_schedules (staff_member_id, day_of_week)
  WHERE is_active = true AND is_off = true;
```

**Enforcement order**: `shift-settings.service.ts` rejects duplicate same period and
deactivates only the previous row for the same `(staffMemberId, dayOfWeek, shiftTypeId)`
before inserting. Migration `20260706120000_staff_schedule_per_period` splits legacy
Journée rows into Matin + Soir.

### 6. One SESSION_PAYMENT movement per session reference

Prevents double-crediting the same ChairSession into a staff cash account.
Paid-amount changes after the first credit use CORRECTION deltas; clear/archive use REVERSAL.

```sql
CREATE UNIQUE INDEX unique_session_payment_per_reference
  ON cash_movements (reference_type, reference_id)
  WHERE type = 'SESSION_PAYMENT'
    AND reference_type IS NOT NULL
    AND reference_id IS NOT NULL;
```

### 7. No duplicate auto-shift for same schedule and business date

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

### 8. One PENDING session plan-change request per session

Prevents two concurrent open approval requests on the same session.

```sql
CREATE UNIQUE INDEX unique_pending_plan_change_per_session
  ON session_plan_change_requests (session_id)
  WHERE status = 'PENDING';
```

**Enforcement order**: `session-plan-change.service.ts` rejects a second PENDING
request before insert. This index is the database-level safety net against races.
Migration `20260718140000_add_session_plan_change_requests` creates the table and
this index. Migration `20260721220000_session_modification_paid_amount` adds paid
amount snapshots and allows amount-only requests (plan fields nullable); the
partial unique index is unchanged.

### 9. One INITIAL_BALANCE per cash account

Production cutover: at most one opening-balance movement per ledger account.

```sql
CREATE UNIQUE INDEX unique_initial_balance_per_account
  ON cash_movements (cash_account_id)
  WHERE type = 'INITIAL_BALANCE';
```

Migration `20260826160000_unique_initial_balance`. Enforced also in `CashService.setInitialBalance`.

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
WHERE tablename IN (
  'chair_sessions',
  'chair_detection_configs',
  'pricing_rules',
  'shifts',
  'staff_schedules',
  'cash_movements',
  'cash_accounts',
  'session_plan_change_requests'
)
  AND indexname LIKE 'unique_%';
```
