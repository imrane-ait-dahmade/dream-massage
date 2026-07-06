# Production Stabilization — dream-massage

Urgent reliability fixes for auto-shift automation, Fly.io uptime, and dashboard shift controls.

---

## What Was Fixed

| Area | Fix |
|------|-----|
| **Fly.io** | `auto_stop_machines = "off"`, `min_machines_running = 1` — server stays awake for internal cron |
| **Health** | `GET /health` returns timezone, DB connectivity, uptime |
| **Auto-shift engine** | Central `runAutoShiftCheck()` — idempotent, typed result, shop open **08:00** / close **23:45** (`Africa/Casablanca`) |
| **Scheduler** | Aligned to `:00/:15/:30/:45` in `APP_TIMEZONE`; runs once on startup |
| **External trigger** | `POST /internal/jobs/auto-shift` with `CRON_SECRET` (Bearer or `x-cron-secret`) |
| **GitHub Actions** | `.github/workflows/auto-shift.yml` every 15 min + manual dispatch |
| **Sessions** | Already link to active OPEN shift; `NO_OPEN_SHIFT` anomaly when none (no crash) |
| **Dashboard UI** | Clear empty state, last auto-check time, admin buttons: Vérifier / Ouvrir / Fermer |
| **Types** | `AutoShiftCheckResult` consistent across job, API, and frontend |

---

## Required Environment Variables

### Fly.io (`dream-massage` app secrets)

```bash
# Core
DATABASE_URL=postgresql://...
JWT_SECRET=<min 16 chars>
FRONTEND_ORIGIN=https://your-frontend.vercel.app
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
APP_TIMEZONE=Africa/Casablanca
NODE_ENV=production
PORT=8080

# Auto-shift (required for production automation)
AUTO_SHIFT_ENABLED=true
AUTO_SHIFT_SHOP_OPEN_TIME=08:00
AUTO_SHIFT_SHOP_CLOSE_TIME=23:45
ALLOW_MULTIPLE_OPEN_SHIFTS=false
CRON_SECRET=<min 16 chars random>

# Shelly (if using real devices)
SIMULATION_ENABLED=false
SHELLY_AUTH_KEY=...
SHELLY_SERVER_URL=...
SHELLY_DEVICE_F1=... # F2–F5
```

Set secrets:

```bash
cd server
fly secrets set \
  AUTO_SHIFT_ENABLED=true \
  CRON_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  APP_TIMEZONE=Africa/Casablanca \
  -a dream-massage
```

### GitHub Actions secrets

| Secret | Value |
|--------|-------|
| `APP_URL` | `https://dream-massage.fly.dev` (no trailing slash) |
| `CRON_SECRET` | Same value as Fly `CRON_SECRET` |

Optional legacy: `SHIFT_AUTOMATION_SECRET` still works if `CRON_SECRET` is unset.

### Vercel (frontend)

```
NEXT_PUBLIC_API_URL=https://dream-massage.fly.dev
```

---

## Fly Configuration

`server/fly.toml`:

- `auto_stop_machines = "off"`
- `auto_start_machines = true`
- `min_machines_running = 1`
- `release_command = "npx prisma migrate deploy"`
- Listens on `0.0.0.0:$PORT` (8080)

Deploy:

```bash
cd server
fly deploy -a dream-massage
```

---

## Safe Production Data Reset

**Always backup first.** This does not drop schema or migrations.

### 1. Backup (Neon / Postgres)

```bash
# Example with pg_dump — use your direct (non-pooler) DATABASE_URL
pg_dump "$DIRECT_URL" -Fc -f dream-massage-backup-$(date +%Y%m%d).dump
```

Or use Neon dashboard → **Branches** → create a backup branch.

### 2. Apply migrations (no data loss)

```bash
cd server
npx prisma migrate deploy
```

### 3. Reset runtime data + seed essentials

On Fly (one-off machine):

```bash
fly ssh console -a dream-massage
# Inside container:
FORCE_CLEAN=true CLEAN_RUNTIME_DATA=true npm run prisma:seed:clean
SEED_SHIFT_TABLE=true npm run prisma:seed
```

Locally:

```bash
cd server
FORCE_CLEAN=true npm run prisma:seed:clean
SEED_SHIFT_TABLE=true npm run prisma:seed
```

This creates:

- Owner account (`owner@example.com` — **change password in production**)
- 5 chairs, pricing plans, shift types
- Staff members + weekly schedule (when `SEED_SHIFT_TABLE=true`)

---

## Verification Checklist

### Health

```bash
curl -s https://dream-massage.fly.dev/health | jq
# Expect: ok=true, timezone=Africa/Casablanca, database=connected
```

### Manual auto-shift trigger

```bash
curl -sS -X POST https://dream-massage.fly.dev/internal/jobs/auto-shift \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" | jq
```

Expected shape:

```json
{
  "ok": true,
  "opened": false,
  "closed": false,
  "closedIds": [],
  "openFound": false,
  "activeShiftId": null,
  "message": "no changes",
  "checkedAt": "..."
}
```

### Automation at 08:00 / 23:45 (Morocco time)

1. Ensure weekly schedule has an entry for **today** (`Settings → Planning`).
2. At **07:59** — trigger check → `opened: false`.
3. At **08:00+** — trigger → `opened: true`, `activeShiftId` set.
4. At **08:15** — trigger again → no duplicate (`opened: false`).
5. At **23:45+** — trigger → `closed: true`, shift status CLOSED.

Run unit tests locally:

```bash
cd server
npm run test:shift-close
npm run test:auto-shift-check
```

### Dashboard

- Login as OWNER/ADMIN
- No shift: amber card with context + **Vérifier maintenant** / **Ouvrir shift manuellement**
- Active shift: staff name, times, **Fermer shift**
- Sessions table shows shift linkage; `Sans shift` only when truly unlinked

### GitHub Actions

Actions → **Auto Shift Check** → Run workflow → should succeed (green).

---

## Commands Summary

```bash
# Server build
cd server && npm install && npx prisma generate && npm run build

# Frontend build
cd web && npm install && npm run build

# Deploy backend
cd server && fly deploy -a dream-massage

# Logs
fly logs -a dream-massage | grep auto-shift
```

---

## Remaining Risks

| Risk | Mitigation |
|------|------------|
| No staff scheduled today | Shift won't auto-open — use manual open or fix planning |
| GitHub Actions outage | In-server aligned cron still runs while Fly machine is up |
| Ramadan / timezone edge cases | `APP_TIMEZONE=Africa/Casablanca`; verify after clock changes |
| Owner password after seed | Change `owner@example.com` password immediately after reset |
| `unique_open_shift` DB index | Only one OPEN shift when `ALLOW_MULTIPLE_OPEN_SHIFTS=false` |
| Prime snapshot at auto-close | Owner still reviews cash / declared amount manually |

---

## Data archive & backup

For safe hide/archive of staff and planning (without deleting session history), see [`server/docs/DATA_MAINTENANCE.md`](server/docs/DATA_MAINTENANCE.md).

Before hard delete or bulk cleanup in production:

```bash
pg_dump "$DIRECT_URL" -Fc -f backup-YYYY-MM-DD.dump
```

---

## Files Changed (this stabilization)

- `server/fly.toml` — keep machine awake
- `server/index.ts` — health + `/internal/jobs/auto-shift`
- `server/config/env.ts` — `CRON_SECRET`, shop open/close times
- `server/modules/shifts/auto-shift.service.ts` — `runAutoShiftCheck()`
- `server/modules/shifts/auto-shift.types.ts` — typed result
- `server/jobs/auto-shift.job.ts` — aligned scheduler
- `server/middleware/shift-automation.middleware.ts` — Bearer + headers
- `server/modules/shifts/shift-close.logic.ts` — daily 23:45 close
- `server/modules/shifts/shift.controller.ts` — `/automation/check`, admin open/close
- `server/utils/time.ts` — timezone helpers
- `.github/workflows/auto-shift.yml` — 15-min external trigger
- `web/src/components/dashboard/ShiftSummary.tsx` — admin controls
- `web/src/lib/api.ts` — shift API helpers
- `PRODUCTION_STABILIZATION.md` — this document
