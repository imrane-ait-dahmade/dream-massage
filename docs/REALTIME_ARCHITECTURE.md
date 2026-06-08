# Real-Time Architecture — Dream Massage

---

## Overview

```
Shelly Cloud
    │
    │  HTTP GET (one request, all 5 chairs)
    │  every SYNC_INTERVAL_MS (default: 1000ms)
    ▼
┌─────────────────────────────────────┐
│         Backend Server              │
│         (port 4000)                 │
│                                     │
│  shelly-sync.job.ts                 │
│       │                             │
│       ▼                             │
│  ChairStateService (per chair)      │
│       │                             │
│       ▼                             │
│  PostgreSQL (source of truth)       │
│       │                             │
│       ▼                             │
│  DashboardService.buildSnapshot()   │
│       │                             │
│       ▼                             │
│  Socket.IO  ──────────────────────────────► Browser (WebSocket)
│                                     │
│  REST API (fallback) ───────────────────────► Browser (HTTP)
└─────────────────────────────────────┘
```

---

## Shelly Cloud Polling

### One request for all 5 chairs

The Shelly Cloud API supports fetching the status of multiple devices in a single HTTP call. The backend calls this endpoint once per poll cycle. **It does not make 5 separate requests** — that would multiply latency and risk hitting rate limits.

```
GET https://shelly-xx-eu.shelly.cloud/device/all_status
    Authorization: Bearer SHELLY_AUTH_KEY
```

The response contains a map of device IDs to their current state (power_watts, relay_on, online). The backend maps each device ID to the corresponding chair (`SHELLY_DEVICE_F1` → chair `F1`, etc.) using the env vars.

### Why 1-second polling

The detection confirmation windows are 30 seconds (start) and 180 seconds (stop). A 1-second poll interval ensures readings arrive faster than any threshold window, giving the debounce state machine enough samples to make accurate decisions.

If Shelly Cloud rate-limits the polling frequency, the `SYNC_INTERVAL_MS` env var can be increased without code changes. The state machine remains correct at any polling rate above ~5 seconds.

### What happens when Shelly is unreachable

If the HTTP call fails or times out:

1. The affected chair's status transitions to `OFFLINE` in the database
2. `statusBeforeOffline` is recorded so the previous state can be restored
3. `offlineSince` is written so the offline duration can be tracked
4. If a session was active, it is **not immediately closed** — it remains `ACTIVE`
5. If the device stays offline past a configurable tolerance, the session transitions to `UNCERTAIN` and requires admin review
6. When the device comes back online, `statusBeforeOffline` is restored

---

## WebSocket (Socket.IO)

### Purpose

The WebSocket connection delivers real-time dashboard updates from the server to the browser. Every time the state machine processes a Shelly reading that changes any observable state, the backend broadcasts the full dashboard snapshot to all connected clients.

### Event: `dashboard:update`

After every poll cycle that produces a state change, the server emits:

```json
{
  "event": "dashboard:update",
  "data": {
    "chairs": [
      {
        "id": "uuid",
        "name": "F1",
        "status": "ACTIVE",
        "isOnline": true,
        "currentPowerWatts": 42.5,
        "currentSession": {
          "id": "uuid",
          "startedAt": "2026-06-08T09:00:00Z",
          "elapsedSeconds": 1800,
          "expectedAmount": null
        }
      }
    ],
    "activeShift": {
      "id": "uuid",
      "staffMember": "Mohammed",
      "startedAt": "2026-06-08T08:00:00Z",
      "sessionCount": 7,
      "expectedCash": "210.00"
    },
    "serverTime": "2026-06-08T09:30:00Z"
  }
}
```

### WebSocket is NOT the source of truth

The WebSocket stream is a **delivery mechanism**, not a data store. If a message is lost, delayed, or the client reconnects:

- The frontend must call the REST fallback endpoint to rebuild its state
- The backend never relies on WebSocket state — it always reads from the database
- A missed WebSocket event causes at most a momentary stale display, not a data error

### Authentication

The Socket.IO connection requires a valid JWT. The client passes the token as a query parameter or `auth` option on connect. The server validates it before accepting the connection. Unauthenticated sockets are immediately disconnected.

---

## REST API (Fallback + Mutations)

WebSocket is for receiving. HTTP REST is for everything else:

| Operation | Method | Endpoint | Why REST |
|---|---|---|---|
| Initial page load state | `GET` | `/api/dashboard` | Client needs state on mount before WS is ready |
| Login | `POST` | `/api/auth/login` | One-time request; no stream needed |
| Correct a session | `PATCH` | `/api/sessions/:id` | Mutation; requires request/response confirmation |
| Open/close shift | `POST` | `/api/shifts` | Mutation |
| Declare cash | `POST` | `/api/shifts/:id/cash` | Mutation |
| Session history | `GET` | `/api/sessions` | Paginated list |
| Chair management | `GET/PATCH` | `/api/chairs/:id` | Low-frequency management operations |

The dashboard state from `GET /api/dashboard` is computed by the same `DashboardService.buildSnapshot()` function that drives the WebSocket broadcast. Both paths produce identical output.

---

## Security Boundary

```
Browser
  │  ← knows: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SOCKET_URL, JWT token
  │  ← never knows: DATABASE_URL, JWT_SECRET, SHELLY_AUTH_KEY, SHELLY_DEVICE_*
  │
  ▼
Backend Server
  │  ← reads: all env vars including Shelly keys
  │  ← signs and validates JWTs
  │  ← is the only process that calls Shelly Cloud
  │
  ▼
Shelly Cloud   /   PostgreSQL
```

The `NEXT_PUBLIC_` prefix on frontend env vars is a deliberate marker that these values will appear in the JavaScript bundle delivered to the browser. **Only values safe for public exposure use this prefix.** The Shelly keys and database URL must never have this prefix and must never appear in any file inside `web/`.
