# Data maintenance & archive

Safe hide/archive for production data — never destroy history linked to sessions, shifts, or bonuses.

## Archive model

| Field | Meaning |
|-------|---------|
| `archivedAt = null` | Visible in normal app usage |
| `archivedAt != null` | Hidden from dropdowns, planning, auto-shift |
| `archiveReason` | Optional admin note |
| `archivedById` | User who archived |

Models with archive fields: **StaffMember**, **StaffSchedule**, **ShiftType**, **Shift**, **PricingPlan**, **ChairSession**.

### Delete session (OWNER/ADMIN)

`DELETE /api/sessions/:id` — removes a session from operational views.

- **Hard delete** when no shift link, no chair events, no billing history
- **Archive** (`archivedAt`) when linked to shift, events, corrections, or calculated billing — preserved for shift prime reports

Archived sessions are hidden from dashboard, assistant, and chair lists but remain in `PrimeCalculationService` for closed-shift history.

## Backup before destructive actions

**PostgreSQL (pg_dump):**

```bash
pg_dump "$DIRECT_URL" -Fc -f backup-$(date +%Y-%m-%d).dump
```

**Neon:** create a branch/snapshot before bulk cleanup or hard delete.

Never run `pg_dump` from the frontend. Credentials stay server-side / ops shell only.

## API (Settings)

### Staff
- `GET /api/settings/staff?visibility=active|archived|all`
- `PATCH /api/settings/staff/:id/archive` — body `{ reason? }`
- `PATCH /api/settings/staff/:id/restore` — body `{ reason?, reactivateLinkedUser? }`
- `DELETE /api/settings/staff/:id` — hard delete only if no shifts/sessions/planning/user link

### Planning
- `GET /api/settings/shifts/schedule?visibility=active|archived|all`
- `PATCH /api/settings/shifts/schedule/:id/archive`
- `PATCH /api/settings/shifts/schedule/:id/restore`
- `DELETE /api/settings/shifts/schedule/:id` — archives by default
- `DELETE /api/settings/shifts/schedule/:id?hard=true` — hard delete if safe

### Shift types
- `GET /api/settings/prime/shift-types?visibility=...`
- `PATCH /api/settings/prime/shift-types/:id/archive|restore`
- `DELETE /api/settings/prime/shift-types/:id` — hard delete if safe

### Maintenance (OWNER only)
- `GET /api/settings/maintenance/backup-instructions`
- `POST /api/settings/maintenance/bulk-archive-inactive-staff` — body `{ confirmation: "ARCHIVE", reason? }`
- `POST /api/settings/maintenance/bulk-archive-orphan-schedules`

## Audit log

All archive / restore / hard delete / bulk actions write to `settings_audit_logs` with action `ARCHIVE`, `RESTORE`, `HARD_DELETE`, or `BULK_*`.

## Migration

```bash
cd server
npx prisma migrate deploy
npx prisma generate
```

Migration: `20260706140000_entity_archive_fields` — additive columns only.

**Production rules (cash ledger included):** see [`PRODUCTION_MIGRATIONS.md`](./PRODUCTION_MIGRATIONS.md).
## Sync paiements → caisse

Trigger : `ChairSession.correctedAmount` (montant réellement encaissé).

| Action | Impact caisse |
|---|---|
| Premier `null → N` | `SESSION_PAYMENT +N` |
| Replay même N | aucun |
| N → M | `CORRECTION +(M−N)` |
| `clearCorrection` → null | `REVERSAL −net` |
| Archive (soft-hide) | **aucun** (`correctedAmount` conservé) |
| Hard delete | unpaid only → aucun |
| Plan-only change | aucun |
| Paid change (plan-change flow) | sync delta |

Legacy : session déjà payée sans ligne ledger → pas de backfill (voir `planSessionPaidSync`).

Cutover soldes : [`CASH_CUTOVER.md`](./CASH_CUTOVER.md).
Never run `prisma migrate reset` against production. Never re-execute applied `migration.sql` files by hand.

## What stays visible after archive

- Old **sessions** (via `shiftId` / staff on shift)
- **Reports** and dashboard history filters
- **Settings → Archivés** tab

## What is hidden

- Staff dropdowns (dashboard, planning, manual shift open)
- Auto-shift planning scan
- New session assignment to archived staff

## Staff & planning seed (from production backup)

Idempotent master-data seed for the real roster — **no runtime/historical data**.

### What it seeds

| Table | Content |
|-------|---------|
| `staff_members` | Oumaima, Khadija (active, not archived) |
| `shift_types` | MATIN 08:00–15:00, SOIR 15:00–23:45; JOURNEE désactivé |
| `staff_schedules` | Weekly planning (JOURNEE rows expanded to MATIN+SOIR) |
| `shift_target_bonus_rules` | Matin ≥500→50 MAD, Soir ≥1000→100 MAD |
| `users` (optional) | ASSISTANT logins with **placeholder** password only |

### What it does NOT seed

- `chair_sessions`, `chair_events`, `device_logs`
- Historical `shifts`, `shift_bonus_adjustments`
- Payments, session corrections, audit trails
- Password hashes from production dumps

### Commands

```bash
cd server

# Base infrastructure (owner, chairs, pricing, default shift types)
npx prisma migrate reset --force   # dev only — wipes DB
npm run prisma:seed

# Real roster + weekly planning (safe upsert, no wipe)
npm run prisma:seed:staff-planning

# Optional: also create ASSISTANT logins (dev placeholder password)
SEED_ASSISTANT_USERS=true npm run prisma:seed:staff-planning

# Regenerate data arrays from a new dump (prints summary — does not auto-write files)
npm run extract:staff-planning -- "C:\path\to\backup.dump"
```

### Production guard

`npm run prisma:seed:staff-planning` is **blocked** when `NODE_ENV=production` unless:

```bash
ALLOW_STAFF_PLANNING_SEED=true npm run prisma:seed:staff-planning
```

The seed never calls `deleteMany` on runtime tables and never runs `migrate reset`.

### Files

- `prisma/seed-data/dream-massage-seed-data.json` — master data (no password hashes)
- `prisma/seeds/seed-from-json.ts` — upsert logic
- `prisma/seeds/seed-data.loader.ts` — JSON loader + JOURNEE→MATIN/SOIR planning transform
- `prisma/seed.ts` — main entry (`npx prisma db seed`)

### Shift hours normalization

Production dump had MATIN `10:00–15:00` and SOIR `15:00–22:00`. Seed normalizes to:

- **MATIN** `08:00–15:00`
- **SOIR** `15:00–23:45`
- **JOURNEE** `isActive=false` (FK history only); planning rows expanded to MATIN+SOIR

### Password strategy

- Owner + assistants: `changeme123` in development only
- Production: owner password never overwritten on upsert
- Assistant users skipped unless `SEED_ASSISTANT_USERS=true`
- Real production hashes are **never** read from the JSON file

### Backup files

Store `*.dump` / `*.backup` outside the repo (gitignored). Never commit production dumps.
Regenerate `prisma/seed-data/dream-massage-seed-data.json` from a new dump when roster changes.
