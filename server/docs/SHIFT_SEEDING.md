# Shift Planning Seed

Seeds the initial weekly shift planning for Dream Care based on the handwritten business schedule.

---

## What is seeded

### Shift Types

| Name | Label | Start | End | sortOrder |
|---|---|---|---|---|
| MATIN | Matin | 10:00 | 15:00 | 1 |
| SOIR | Après-midi | 15:00 | 22:00 | 2 |
| JOURNEE | Journée | 10:00 | 22:00 | 3 |

These are also seeded by the base `npm run prisma:seed` (via `seedPrimeData`).

### Staff Members

| Name | Login | Notes |
|---|---|---|
| Fille 1 | None | StaffMember only — no User account, no password |
| Fille 2 | None | StaffMember only — no User account, no password |

Assistants are not app users. They are tracked via `StaffMember` records only.
The Owner/Admin opens shifts on their behalf from the dashboard.

### Weekly Schedule

| Jour | Fille 1 | Fille 2 |
|---|---|---|
| Lundi | Après-midi (15:00–22:00) | Matin (10:00–15:00) |
| Mardi | Journée (10:00–22:00) | OFF |
| Mercredi | Matin (10:00–15:00) | Après-midi (15:00–22:00) |
| Jeudi | OFF | Journée (10:00–22:00) |
| Vendredi | Après-midi (15:00–22:00) | Matin (10:00–15:00) |
| Samedi | Matin (10:00–15:00) | Après-midi (15:00–22:00) |
| Dimanche | Après-midi (15:00–22:00) | Matin (10:00–15:00) |

The schedule is designed so that MATIN (10:00–15:00) and SOIR (15:00–22:00) do not overlap — each ends exactly when the other begins. This is compatible with `ALLOW_MULTIPLE_OPEN_SHIFTS=false`.

---

## How to adjust the planning

The table is defined near the top of `prisma/seed.ts` in the constant `INITIAL_WEEKLY_SHIFT_TABLE`:

```typescript
const INITIAL_WEEKLY_SHIFT_TABLE = [
  { staffName: 'Fille 1', dayOfWeek: 1, shiftTypeName: 'SOIR',    isOff: false },
  { staffName: 'Fille 1', dayOfWeek: 4, shiftTypeName: null,      isOff: true  },
  // ...
];
```

After editing, re-run the seed with `SEED_SHIFT_TABLE=true` to apply.

---

## How to run

### Git Bash / WSL / macOS / Linux

```bash
cd server

# Seed the shift planning (includes base data + shift table)
SEED_SHIFT_TABLE=true npm run prisma:seed

# Shorthand (same thing)
npm run prisma:seed:shifts
```

### PowerShell (Windows)

The npm script `prisma:seed:shifts` uses `SEED_SHIFT_TABLE=true` syntax which does not work natively in PowerShell. Use one of these alternatives:

```powershell
# Option A: set env var inline before running
$env:SEED_SHIFT_TABLE = "true"
npm run prisma:seed

# Option B: run via Git Bash
bash -c "SEED_SHIFT_TABLE=true npm run prisma:seed"
```

### Without the flag (safe default)

Running `npm run prisma:seed` without `SEED_SHIFT_TABLE=true` will **not** touch `StaffSchedule` data. It is safe to run at any time.

---

## What happens on each run

When `SEED_SHIFT_TABLE=true`:

1. **Shift types** are upserted by fixed UUID (idempotent, always correct).
2. **Fille 1** and **Fille 2** are upserted by fixed UUID (no-op if they already exist).
3. For each row in `INITIAL_WEEKLY_SHIFT_TABLE`:
   - Any existing **active** `StaffSchedule` row for that `(staffMemberId, dayOfWeek)` pair is **deactivated** (set `isActive=false`). The row is kept for audit purposes.
   - A **new active** `StaffSchedule` row is created.

> **Warning**: every `SEED_SHIFT_TABLE=true` run deactivates and recreates the active schedule rows for Fille 1 and Fille 2. Manual changes made via the Settings UI will be overwritten. Only run this seed intentionally.

---

## Verification

### Prisma Studio

```bash
cd server
npx prisma studio
```

Open `StaffSchedule` — you should see 14 active rows (7 per staff member).
Open `StaffMember` — Fille 1 and Fille 2 should have no `email` or password fields (they are not `User` records).

### Direct SQL

```sql
-- Count active schedules by staff member
SELECT sm.name, COUNT(*) as days
FROM staff_schedules ss
JOIN staff_members sm ON sm.id = ss.staff_member_id
WHERE ss.is_active = true
GROUP BY sm.name
ORDER BY sm.name;
-- Expected: Fille 1 → 7, Fille 2 → 7

-- Show the full planning
SELECT sm.name, ss.day_of_week, st.name as shift, ss.is_off
FROM staff_schedules ss
JOIN staff_members sm ON sm.id = ss.staff_member_id
LEFT JOIN shift_types st ON st.id = ss.shift_type_id
WHERE ss.is_active = true
ORDER BY sm.name, ss.day_of_week;
```

---

## TODOs

| Item | Notes |
|---|---|
| Real staff names | Replace 'Fille 1' / 'Fille 2' with actual first names once confirmed |
| Add more staff | Extend `INITIAL_WEEKLY_SHIFT_TABLE` and add a new `IDS.filleN` entry |
| Time overrides | `StaffSchedule` supports `startTime`/`endTime` overrides per row; seed defaults to ShiftType times |
