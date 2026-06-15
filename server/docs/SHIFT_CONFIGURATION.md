# Shift Configuration — API Reference

This document covers the shift planning and shift lifecycle features added in the
MVP backend. There are two separate concerns:

1. **Configuration** (planning, who works which day) — lives under `/api/settings/shifts/*`
2. **Real shifts** (open, operate, close) — lives under `/api/shifts/*`

---

## Concepts

### ShiftType

A named time slot that defines *when* a shift runs. Three defaults are seeded:

| name      | label    | hours       |
|-----------|----------|-------------|
| `matin`   | Matin    | 10:00–15:00 |
| `soir`    | Soir     | 15:00–22:00 |
| `journee` | Journée  | 10:00–22:00 |

ShiftTypes are managed by the owner from Settings → Primes & Bonus. They are
referenced both by `StaffSchedule` (weekly planning) and by real `Shift` rows.

### StaffMember

Staff assistants who work the chairs. They have **no login** and no access to the
app. Only the Owner/Admin manages their information.

### StaffSchedule

Weekly planning. Each row says: "On day X, member Y works shift type Z."

- **ISO weekday**: 1 = Monday … 7 = Sunday
- One active row per `(staffMemberId, dayOfWeek)` — enforced by the
  `unique_active_staff_schedule_per_day` partial index.
- A row with `isOff = true` means the member is explicitly off that day.
- Per-row `startTime`/`endTime` override the ShiftType default times (optional).
- Deactivated rows (`isActive = false`) are kept for auditing — never hard-deleted.

### Shift (real shift)

A real work period with a start/end time, linked to one `StaffMember`. Shift rows
accumulate `ChairSession` records during the shift. When the shift closes, a prime
summary is calculated and saved as a snapshot.

Only **one shift can be OPEN at a time**. This is enforced by the `unique_open_shift`
partial index and by an explicit guard in `shift.service.ts`.

---

## Configuration Endpoints (`/api/settings/shifts/*`)

All settings endpoints require authentication (Owner/Admin JWT cookie).

### Shift Types

| Method | Path                          | Description                     |
|--------|-------------------------------|---------------------------------|
| GET    | `/api/settings/shifts/types`  | List all shift types             |
| POST   | `/api/settings/shifts/types`  | Create a new shift type          |
| PATCH  | `/api/settings/shifts/types/:id` | Update a shift type           |

These routes delegate to the same `primeSettingsService` used by
`/api/settings/prime/shift-types`, so both paths operate on the same `ShiftType` table.

**POST body:**
```json
{
  "name": "string (unique slug, e.g. \"matin\")",
  "label": "string|null",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "isActive": true,
  "sortOrder": 1
}
```

**PATCH body (all fields optional):**
```json
{
  "label": "string|null",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "isActive": false,
  "sortOrder": 2
}
```

---

### Staff Schedule

| Method | Path                                | Description                            |
|--------|-------------------------------------|----------------------------------------|
| GET    | `/api/settings/shifts/schedule`     | List active schedule (all days)        |
| GET    | `/api/settings/shifts/schedule?staffMemberId=<uuid>` | Filter by one member |
| POST   | `/api/settings/shifts/schedule`     | Add/replace a schedule entry           |
| PATCH  | `/api/settings/shifts/schedule/:id` | Update a schedule entry in place       |
| DELETE | `/api/settings/shifts/schedule/:id` | Soft-delete (sets `isActive = false`)  |

**GET response shape:**
```json
{
  "days": [
    {
      "dayOfWeek": 1,
      "label": "Lundi",
      "items": [
        {
          "id": "uuid",
          "staffMemberId": "uuid",
          "staffMemberName": "Demo Staff",
          "shiftTypeId": "uuid|null",
          "shiftTypeLabel": "Matin|null",
          "startTime": "10:00|null",
          "endTime": "15:00|null",
          "isOff": false,
          "isActive": true,
          "notes": null
        }
      ]
    }
    // ... days 2–7
  ]
}
```

`startTime`/`endTime` are resolved: per-row override > ShiftType default > `null`.

**POST body:**
```json
{
  "staffMemberId": "uuid (required)",
  "shiftTypeId":   "uuid (required unless isOff=true)",
  "dayOfWeek":     3,
  "startTime":     "HH:mm|null",
  "endTime":       "HH:mm|null",
  "isOff":         false,
  "notes":         "string|null"
}
```

Creating a new entry for a `(staffMemberId, dayOfWeek)` pair that already has an
active row will deactivate the previous row before creating the new one. The history
is preserved in `isActive = false` rows.

**PATCH body (all fields optional):**
```json
{
  "shiftTypeId": "uuid|null",
  "startTime":   "HH:mm|null",
  "endTime":     "HH:mm|null",
  "isOff":       true,
  "isActive":    false,
  "notes":       "string|null"
}
```

---

### Today Suggestions

```
GET /api/settings/shifts/today-suggestions
```

Returns the active non-off schedule entries for today's ISO weekday, resolved using
the `APP_TIMEZONE` environment variable (`Africa/Casablanca` by default).

**Response:**
```json
{
  "dayOfWeek": 3,
  "label": "Mercredi",
  "suggestions": [
    {
      "staffMemberId": "uuid",
      "staffMemberName": "Demo Staff",
      "shiftTypeId": "uuid|null",
      "shiftTypeLabel": "Matin",
      "startTime": "10:00",
      "endTime": "15:00"
    }
  ]
}
```

The frontend can use this to display a one-click "Open shift from schedule" UI.

---

## Real Shift Endpoints (`/api/shifts/*`)

All shift endpoints require authentication.

### Open a shift

```
POST /api/shifts/open
```

**Body:**
```json
{
  "staffMemberId": "uuid (required)",
  "shiftTypeId":   "uuid (optional)"
}
```

**Responses:**
- `201 Created` — `{ "shift": { ... } }`
- `400` — inactive staff member, or validation error
- `404` — staff member or shift type not found
- `409` — a shift is already open (includes the open staff member's name)

The response `shift` object includes:
```json
{
  "id": "uuid",
  "status": "OPEN",
  "startedAt": "ISO datetime",
  "staffMember": { "id": "uuid", "name": "Demo Staff" },
  "shiftType":  { "id": "uuid", "name": "matin", "label": "Matin", "startTime": "10:00", "endTime": "15:00" },
  "openedBy":   { "id": "uuid", "name": "Owner" },
  "closedBy":   null,
  "_count":     { "sessions": 0 }
}
```

---

### Get the current open shift

```
GET /api/shifts/open
```

**Response:**
```json
{ "shift": { ... } }   // shift object as above
{ "shift": null }      // if no shift is open
```

---

### Close a shift

```
POST /api/shifts/:id/close
```

**Body:**
```json
{
  "declaredCash": 1250.50
}
```

`declaredCash` is optional. When provided, `differenceCash = declaredCash - grossRevenue`
is saved to the shift row for cash reconciliation.

Before setting `status = CLOSED`, the prime summary is recalculated and persisted
as snapshot columns on the shift row.

**Responses:**
- `200 OK` — `{ "shift": { ... } }` (closed shift)
- `400` — shift is not OPEN
- `404` — shift not found

---

## Environment Variables

| Variable           | Default             | Description                              |
|--------------------|---------------------|------------------------------------------|
| `APP_TIMEZONE`     | `Africa/Casablanca` | IANA timezone for day-of-week resolution |
| `SEED_DEMO_SCHEDULE` | *(unset)*         | Set to `true` to seed one example schedule row |

---

## Partial Unique Indexes

Two raw SQL indexes are required (cannot be expressed in Prisma schema):

- `unique_open_shift` — one OPEN shift at a time
- `unique_active_staff_schedule_per_day` — one active schedule entry per `(staff_member_id, day_of_week)`

Both are applied automatically by `npm run prisma:seed` and documented in
`server/prisma/RAW_SQL_CONSTRAINTS.md`.

---

## Future work (post-MVP)

- Weekly planning calendar UI (Settings → Planning tab)
- Multi-shift days (two staff, one Matin one Soir)
- Schedule history viewer (currently stored but not exposed via API)
- Staff attendance reporting vs. planned schedule
