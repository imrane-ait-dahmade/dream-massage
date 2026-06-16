# Auto Shift Automation

Automatically opens and closes `Shift` records based on the weekly `StaffSchedule` planning.

---

## How It Works

### Weekly Planning → Real Shifts

1. Owner configures the weekly planning via `POST /api/settings/shifts/schedule`:
   - Which `StaffMember` works on which day of the week (`dayOfWeek` 1=Mon … 7=Sun)
   - Which `ShiftType` (Matin 10:00–15:00, Soir 15:00–22:00, Journée 10:00–22:00)
   - Optional time overrides (`startTime`, `endTime` as HH:mm)

2. The auto-shift job checks every `AUTO_SHIFT_CHECK_INTERVAL_MS` (default: 60 s).

3. **Opening**: if now is within a scheduled window and no shift has been created yet for that `(staffScheduleId, businessDate)`, a real `Shift` row is created with `status=OPEN`.

4. **Closing**: if an OPEN shift has a `scheduledEndAt` that has passed, the shift is automatically closed with `status=CLOSED`.

5. Sessions that start during an OPEN shift are automatically linked to it (existing behavior, unchanged).

6. After auto-close, the owner must review the shift, enter the declared cash, and mark it REVIEWED.

---

## Validation Rules for Schedule Creation

### Always enforced

| Rule | Error |
|---|---|
| `dayOfWeek` must be 1–7 | Zod validation |
| `staffMemberId` must exist | 404 |
| If `isOff=false`, `shiftTypeId` is required | 400 |
| `endTime` must be after `startTime` | 400 |

### Only when `ALLOW_MULTIPLE_OPEN_SHIFTS=false`

| Rule | Error |
|---|---|
| No two active schedules on the same day can have overlapping time windows | 409 |

**Overlap formula**: schedule A and B overlap if `startA < endB AND startB < endA`.

**Example rejected**:
```
Fatima  Monday  Matin    10:00–15:00
Zahra   Monday  Journée  10:00–22:00   ← rejected: overlaps Matin 10:00–15:00
```

**Example allowed** (no overlap):
```
Fatima  Monday  Matin   10:00–15:00
Zahra   Monday  Soir    15:00–22:00   ← allowed: starts exactly when Matin ends
```

---

## Only One Open Shift (`ALLOW_MULTIPLE_OPEN_SHIFTS=false`)

When disabled (default):

- Only one `Shift` can have `status=OPEN` at any time.
- Enforced at runtime by a database partial unique index (`unique_open_shift`).
- The auto-shift job will log a warning and skip opening a new shift if another is already OPEN.
- `POST /api/shifts/open` will return HTTP 409 if another shift is already open.

When enabled (`ALLOW_MULTIPLE_OPEN_SHIFTS=true`):

- Multiple OPEN shifts are allowed (different staff working concurrently).
- Schedule overlap check is also disabled.
- **The `unique_open_shift` index must be dropped** if it was already applied (it prevents multiple OPEN rows).

---

## Automatic Close

When a shift's `scheduledEndAt` passes:

1. Prime summary is recalculated and saved (grossRevenue, planCommission, targetBonus, etc.).
2. Shift is updated: `status=CLOSED`, `endedAt=scheduledEndAt`, `closedAutomatically=true`, `autoCloseReason=SCHEDULE_END`.
3. `declaredCash` is left `null` — **the owner must enter it during review**.

---

## Environment Variables

Add to `server/.env`:

```env
# Auto-shift automation
AUTO_SHIFT_ENABLED=true                  # false = job disabled, no shifts auto-opened/closed
AUTO_SHIFT_CHECK_INTERVAL_MS=60000       # how often to check (ms), default 60 s
ALLOW_MULTIPLE_OPEN_SHIFTS=false         # true = multiple concurrent OPEN shifts allowed
```

Safe defaults: all three default to off/conservative if not set.

---

## Monitoring Endpoints

All endpoints are protected by auth middleware.

### `GET /api/shifts/automation/status`

Returns current job state:

```json
{
  "autoShiftEnabled": true,
  "intervalMs": 60000,
  "allowMultipleOpenShifts": false,
  "lastRunAt": "2026-06-16T09:05:00.000Z",
  "lastOpenCount": 1,
  "lastCloseCount": 0,
  "lastError": null
}
```

### `POST /api/shifts/automation/run`

Manually triggers one sync cycle. Returns:

```json
{ "ok": true, "opened": 1, "closed": 0 }
```

Useful during testing without waiting for the next interval tick.

---

## Testing

### 1. Start server

```bash
cd server
AUTO_SHIFT_ENABLED=true npm run dev
```

Check startup log for:
```
autoShiftEnabled  : true
autoShiftInterval : 60000ms
multipleOpenShifts: false
```

### 2. Check automation status

```bash
# After login (cookie-based auth):
curl -b cookies.txt http://localhost:4001/api/shifts/automation/status
```

### 3. Run manually

```bash
curl -X POST -b cookies.txt http://localhost:4001/api/shifts/automation/run
```

### 4. Create a schedule for today and trigger

```bash
# Get today's day of week (1=Mon ... 7=Sun)
# Get a staff member ID and shift type ID from GET /api/settings/staff and /api/settings/prime/shift-types

# Create schedule entry
curl -X POST http://localhost:4001/api/settings/shifts/schedule \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"staffMemberId":"<id>","shiftTypeId":"<id>","dayOfWeek":1,"isOff":false}'

# Trigger sync
curl -X POST -b cookies.txt http://localhost:4001/api/shifts/automation/run

# Verify shift opened
curl -b cookies.txt http://localhost:4001/api/shifts/open
```

### 5. Test overlap rejection

```bash
# Create a second schedule that overlaps with the first on the same day
# Should receive HTTP 409:
{ "ok": false, "error": "Un autre membre du staff a déjà un shift qui se chevauche ce jour-là." }
```

### 6. Test manual open conflict

```bash
curl -X POST http://localhost:4001/api/shifts/open \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"staffMemberId":"<id>"}'
# If a shift is already OPEN, returns HTTP 409
```

---

## New Schema Fields on `Shift`

| Field | Type | Description |
|---|---|---|
| `staffScheduleId` | `String?` | FK to StaffSchedule — set when auto-opened |
| `businessDate` | `String?` | YYYY-MM-DD in APP_TIMEZONE |
| `scheduledStartAt` | `DateTime?` | Planned start (UTC) |
| `scheduledEndAt` | `DateTime?` | Planned end (UTC) — triggers auto-close |
| `openedAutomatically` | `Boolean` | `true` if opened by the job |
| `closedAutomatically` | `Boolean` | `true` if closed by the job |
| `autoCloseReason` | `String?` | `SCHEDULE_END` when auto-closed |

---

## Database Index

Applied separately (see `prisma/RAW_SQL_CONSTRAINTS.md` §6):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS unique_auto_shift_per_schedule_day
  ON shifts (staff_schedule_id, business_date)
  WHERE staff_schedule_id IS NOT NULL AND business_date IS NOT NULL;
```

Prevents the job from opening duplicate shifts if it runs while the server restarts mid-window.

---

## Risks and TODOs

| Item | Notes |
|---|---|
| Midnight-spanning shifts | Not supported in MVP. `endTime` must be > `startTime` on the same calendar day. |
| Race condition on open | Service-layer check + DB index covers most cases. For high-concurrency, wrap in a DB transaction. |
| `unique_open_shift` index vs `ALLOW_MULTIPLE_OPEN_SHIFTS=true` | If you flip this flag on a live DB, drop the index manually first. |
| Cash declaration after auto-close | Owner must review each auto-closed shift, enter `declaredCash`, and mark `REVIEWED`. No automation for cash. |
| Prime on active sessions | Sessions still ACTIVE at auto-close time contribute 0 revenue to the prime snapshot (existing behavior). |
