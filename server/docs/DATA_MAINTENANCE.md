# Data maintenance & archive

Safe hide/archive for production data — never destroy history linked to sessions, shifts, or bonuses.

## Archive model

| Field | Meaning |
|-------|---------|
| `archivedAt = null` | Visible in normal app usage |
| `archivedAt != null` | Hidden from dropdowns, planning, auto-shift |
| `archiveReason` | Optional admin note |
| `archivedById` | User who archived |

Models with archive fields: **StaffMember**, **StaffSchedule**, **ShiftType**, **Shift**, **PricingPlan**.

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

## What stays visible after archive

- Old **sessions** (via `shiftId` / staff on shift)
- **Reports** and dashboard history filters
- **Settings → Archivés** tab

## What is hidden

- Staff dropdowns (dashboard, planning, manual shift open)
- Auto-shift planning scan
- New session assignment to archived staff
