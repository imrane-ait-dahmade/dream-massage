# Seed & Reset Guide — dreamMassage MVP

## Commands

```bash
# Upsert base data only (safe at any time, no data deleted)
npm run prisma:seed

# Clean runtime data, then upsert base data
npm run prisma:seed:clean

# Open Prisma Studio to inspect the database
npm run prisma:studio
```

Run all commands from the `server/` directory.

---

## What the seed keeps / creates

| Category | Records | Behavior |
|---|---|---|
| **Owner user** | `owner@example.com`, role OWNER | Upsert by fixed ID — never duplicated |
| **Chairs F1–F5** | name, displayName, shellyChannel | Upsert by name — device IDs never overwritten with placeholders |
| **Detection configs** | 7W start / 5W stop defaults | Created only if no active config exists for that chair |
| **Pricing plans** | 20 min/20 MAD, 30 min/30 MAD, 40 min/40 MAD | Upsert by fixed ID |
| **Pricing rule** | NEXT_PLAN, grace 120s, minimum = 20 min | Upsert by fixed ID — extra active rules are deactivated |
| **App settings** | timezone, sync_interval_ms, default_currency | Upsert by key |

**Demo data (Demo Staff, example ASSISTANT login, demo schedule) is not created by
default.** Demo data must never run in production. Set `DEMO_DATA_ENABLED=true`
(non-production only — see `.env.example`) or run `npm run prisma:seed:demo` to
also seed it.

### Device ID priority (chairs)

1. `SHELLY_DEVICE_F1`…`F5` env variable — used if present
2. Existing DB value — kept unchanged if env is absent
3. `CHANGE_ME_F1`…`F5` placeholder — only used when creating a chair fresh without an env value

The seed **never** writes a `CHANGE_ME_*` placeholder over an existing real device ID.

---

## What `--clean-runtime` deletes

> **WARNING: destructive. Use only in local/dev environments.**
> In production the command aborts unless `FORCE_CLEAN=true` is also set.

Deletion order respects foreign-key constraints:

| Order | Table | Reason |
|---|---|---|
| 1 | `chair_events` | References `chairs` + `chair_sessions` |
| 2 | `device_logs` | References `chairs` (nullable) |
| 3 | `settings_audit_logs` | Demo/test entries only |
| 4 | `chair_sessions` | References `chairs` + `shifts` + `pricing_plans` |
| 5 | `shifts` | References `staff_members` + `users` |

After deletion, all chair runtime fields are reset:

| Field | Reset value |
|---|---|
| `status` | `IDLE` |
| `currentSessionId` | `null` |
| `maybeActiveSince` | `null` |
| `maybeFinishedSince` | `null` |
| `stateChangedAt` | `null` |
| `statusBeforeOffline` | `null` |
| `offlineSince` | `null` |
| `lastOnlineAt` | `null` |
| `currentPowerWatts` | `null` |
| `relayIsOn` | `null` |
| `isOnline` | `false` |
| `lastSyncedAt` | `null` |

Shelly sync repopulates the live fields on the next poll cycle after the server starts.

### What is NOT deleted

- `users` — owner account is preserved
- `staff_members` — real staff records preserved
- `chairs` — chair config and device IDs preserved
- `chair_detection_configs` — versioned configs preserved
- `pricing_plans` — preserved
- `pricing_rules` — preserved
- `app_settings` — preserved

---

## Typical usage

### First run on a fresh database

```bash
npm run prisma:seed
```

### After accumulating demo / simulation data

```bash
# Confirm you are on local dev, then:
npm run prisma:seed:clean
```

Expected output:
```
  dreamMassage seed
  mode: CLEAN-RUNTIME + seed
  env : development
  demo data : disabled

── Cleaning runtime data ─────────────────────────────────────────
  ✓ Deleted chair events      : 342
  ✓ Deleted device logs       : 1204
  ✓ Deleted audit log entries : 58
  ✓ Deleted chair sessions    : 47
  ✓ Deleted shifts            : 3
  ✓ Reset chair runtime state : 5 chair(s)
── Runtime clean done ────────────────────────────────────────────

── Seeding base data ─────────────────────────────────────────────
  ✓ Owner user   : owner@example.com (OWNER)
  ✓ Chair        : F1 (updated) (device unchanged: f1b4***)
    └ Detection config exists (v1, 7W start / 5W stop)
  ...
── Seed complete ─────────────────────────────────────────────────
```

Add `DEMO_DATA_ENABLED=true` (or run `npm run prisma:seed:demo`) to also see
`✓ Assistant user: assistant@example.com (ASSISTANT) → Fille 1` and
`✓ Staff member : Demo Staff` in the output — non-production only.

### Emergency production reset (never in normal use)

```bash
FORCE_CLEAN=true npm run prisma:seed:clean
```

---

## Verifying with Prisma Studio

```bash
npm run prisma:studio
```

Open `http://localhost:5555` and check:

| Table | Expected after clean seed |
|---|---|
| `chairs` | 5 rows, all `status=IDLE`, `isOnline=false` |
| `chair_detection_configs` | 5 rows (one per chair), `isActive=true` |
| `pricing_plans` | 3 rows (20/30/40 min), all `isActive=true` |
| `pricing_rules` | 1 row, `isActive=true`, `roundingMode=NEXT_PLAN` |
| `app_settings` | 3 rows (timezone, sync_interval_ms, default_currency) |
| `chair_sessions` | 0 rows after clean |
| `chair_events` | 0 rows after clean |
| `shifts` | 0 rows after clean |
