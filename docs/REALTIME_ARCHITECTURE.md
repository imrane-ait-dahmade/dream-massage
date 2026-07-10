# Real-Time Architecture — Dream Massage

---

## Overview (Neon egress hotfix)

```
Shelly Cloud
    │
    │  HTTP (one request, all 5 chairs)
    │  every SHELLY_POLL_INTERVAL_MS (default: 5000ms)
    ▼
┌─────────────────────────────────────┐
│         Backend Server              │
│                                     │
│  In-memory chair runtime cache      │
│       │                             │
│       ├─ compare power / status     │
│       │  (NO DB on unchanged tick)  │
│       │                             │
│       ├─ DB write ONLY on:          │
│       │  real state transitions     │
│       │  reconcile ≤ 1/min          │
│       │  power flush ≤ 1/min        │
│       ▼                             │
│  Socket.IO broadcast                │
│  (on transition OR heartbeat 60s)   │
└─────────────────────────────────────┘
```

### Key env vars

| Variable | Default | Role |
|----------|---------|------|
| `SYNC_INTERVAL_MS` | 5000 | Job loop cadence |
| `SHELLY_POLL_INTERVAL_MS` | 5000 | Shelly HTTP poll |
| `SHELLY_DB_RECONCILE_INTERVAL_MS` | 60000 | Safety DB reload |
| `POWER_METRICS_FLUSH_INTERVAL_MS` | 60000 | Persist min/max/avg |
| `DASHBOARD_CACHE_TTL_MS` | 15000 | API response cache |
| `DASHBOARD_FALLBACK_REFRESH_MS` | 60000 | Heartbeat / REST fallback |
| `DB_ERROR_BACKOFF_MAX_MS` | 60000 | Circuit breaker open window |
| `AUTO_SHIFT_CHECK_INTERVAL_MS` | 900000 | Unchanged |

### Why 5-second polling

Start confirm is 30s and stop confirm is 180s. A 5s poll still provides enough samples for debounce while cutting Neon egress by ~90% vs 1s dashboard DB reads.

---

## Shelly Cloud Polling

### One request for all 5 chairs

The Shelly Cloud API supports fetching the status of multiple devices in a single HTTP call. The backend calls this endpoint once per poll cycle. **It does not make 5 separate requests**.

### Memory-first state machine

1. Hydrate chairs + active sessions once at startup.
2. Each Shelly tick updates **memory** only.
3. Persist to Postgres only on real transitions (IDLE→MAYBE_ACTIVE, session start/end, offline, etc.).
4. Aggregate min/max/avg power in memory; flush at most once per minute.
5. Reconcile from DB at most once per minute as a safety net.

### What happens when Shelly is unreachable

1. Chair status → `OFFLINE` (DB write on transition only)
2. Active sessions are **not** closed immediately
3. On recovery, state restores from the active session if any

---

## WebSocket (Socket.IO)

Broadcasts happen on **business transitions** or a **60s heartbeat** — not every Shelly tick.

### Client behaviour

- Initial REST load once
- Socket updates with 750ms debounce
- REST fallback every 60s only if WebSocket is down
- No polling while the browser tab is hidden
- No overlapping requests; backoff 5s → 15s → 30s → 60s on errors
- On DB outage: show `Service temporairement indisponible. Nouvelle tentative automatique.` (HTTP 503)

---

## Observability

Every 5 minutes:

```
[usage-metrics] {"dbReads":N,"dbWrites":N,"apiCalls":N,"shellyTicks":N,"dbReconciliations":N,"stateTransitions":N,"cacheHits":N,"cacheMisses":N}
```

Never includes secrets, patient names, or full Shelly payloads.
