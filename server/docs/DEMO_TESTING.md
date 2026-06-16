# Demo Testing System

Development-only endpoints for testing business workflows without real customers or real chair usage.

## Activation

Two environment variables must both be set:

```env
NODE_ENV=development        # (or test)
DEMO_TOOLS_ENABLED=true     # default: false
SESSION_TEST_FAST_MODE=true # optional: shortens confirm windows for manual reading tests
```

All routes are registered at `/api/dev/demo/*` and require a valid auth cookie (same as production routes). They are **completely disabled in production** — the block is never executed when `NODE_ENV=production`.

## Endpoints

### GET /api/dev/demo/scenarios
Returns the list of available scenario names.

```json
{ "ok": true, "scenarios": ["normal_day", "prime_bonus_matin", ...] }
```

### POST /api/dev/demo/reset-demo-data
Deletes all runtime data: `ChairEvents`, `ChairSessions`, `ShiftBonusAdjustments`, `Shifts`.
Resets chair live state to IDLE.

Does **not** delete: users, staff members, chairs, pricing plans, pricing rules, shift types, schedules, bonus/commission rules, or app settings.

```json
{
  "ok": true,
  "chairEventsDeleted": 42,
  "chairSessionsDeleted": 15,
  "shiftBonusAdjustmentsDeleted": 0,
  "shiftsDeleted": 3
}
```

### POST /api/dev/demo/scenarios/run
Body: `{ "scenario": "<name>" }`

Runs one of the 7 scenarios and returns structured results.

### POST /api/dev/demo/chairs/:chairName/reading
Body: `{ "powerWatts": 150, "isOnline": true }`

Injects a power reading by **chair name** (e.g. `F1`, `F2`) instead of UUID.
Calls `chairStateService.processChairReading` — same path as the Shelly live poller.

### GET /api/dev/demo/test-summary
Returns current DB state: session counts, revenue totals, anomaly counts, shift counts by status, staff count, active sessions.

## Scenarios

### A. normal_day
Creates a closed MATIN shift with 3 completed sessions:
- Chair F1: 20 min → 20 MAD
- Chair F2: 30 min → 30 MAD  
- Chair F3: 20 min → 20 MAD
- Total gross: 70 MAD (below 500 MAD bonus threshold → targetBonus = 0)

**Requires:** At least 3 enabled chairs.

### B. prime_bonus_matin
Creates a closed MATIN shift with 25 × 20 MAD sessions = **500 MAD gross**.
The `bonusRuleMatin` seed rule (≥500 MAD → +50 MAD) fires.

Expected: `actualTargetBonus = 50`, `targetBonusMatched = true`

### C. prime_bonus_soir
Creates a closed SOIR shift with 25 × 40 MAD sessions = **1000 MAD gross**.
The `bonusRuleSoir` seed rule (≥1000 MAD → +100 MAD) fires.

Expected: `actualTargetBonus = 100`, `targetBonusMatched = true`

### D. anomalies_day
Creates 3 sessions to test anomaly detection:
1. **TOO_SHORT** — 60s duration (< 180s minimum), expectedAmount=0, PENDING
2. **TOO_LONG** — 3600s duration (> 40min plan + 120s grace), PENDING
3. **NO_OPEN_SHIFT** — completed session with no shiftId, CALCULATED

### E. correction_demo
Creates a single CORRECTED session: `expectedAmount=20`, `correctedAmount=25`, `billingStatus=CORRECTED`, `correctionReason="Démo correction owner"`.
Owner is set as the corrector.

### F. auto_shift_demo
Ensures a `StaffSchedule` exists for Demo Staff on today's day-of-week (creates one with startTime=00:00, endTime=23:59 if missing), then calls `autoShiftService.runAutoShiftSync()`.

**Note:** The created schedule persists and will affect real auto-shift behavior on that day of week. Delete it manually via the DB or settings UI after testing (`scheduleId` is returned in the response).

### G. full_demo_day
Convenience: runs reset → prime_bonus_matin → prime_bonus_soir → anomalies_day → correction_demo, then returns a full test summary.

## Seed dependency

All scenarios rely on data created by `npm run prisma:seed`:
- Demo Staff (`id: 00000000-0000-0000-0001-000000000001`)
- Pricing plans 20/30/40 MAD
- Shift types MATIN / SOIR with their target bonus rules
- Owner user (used as `openedByUserId` / `closedByUserId`)

If scenarios fail with "not found" errors, run the seed first.

## Typical workflow

```bash
# 1. Activate in .env
DEMO_TOOLS_ENABLED=true

# 2. Reset to clean state
POST /api/dev/demo/reset-demo-data

# 3. Run a scenario
POST /api/dev/demo/scenarios/run  { "scenario": "prime_bonus_matin" }

# 4. Check state
GET /api/dev/demo/test-summary

# 5. Run full day
POST /api/dev/demo/scenarios/run  { "scenario": "full_demo_day" }
```
