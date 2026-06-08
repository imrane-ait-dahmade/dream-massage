# Project Structure — Dream Massage

---

## Repository Layout

```
dreamMassage/                     ← Git repository root
│
├── web/                          ← Next.js frontend (React 19, Tailwind 4)
│   ├── src/
│   │   ├── app/                  ← Next.js App Router pages and layouts
│   │   ├── components/
│   │   │   ├── dashboard/        ← Dashboard-specific components (ChairCard, etc.)
│   │   │   └── ui/               ← Generic reusable UI components (Button, Badge, etc.)
│   │   └── lib/                  ← Frontend utilities (socket client, API client, formatters)
│   ├── public/
│   ├── next.config.mjs
│   └── package.json
│
├── server/                       ← Standalone Node.js backend server (port 4000)
│   ├── index.ts                  ← Server entry point (Express + Socket.IO)
│   ├── socket.ts                 ← Socket.IO setup and broadcast helpers
│   ├── prisma.ts                 ← Singleton PrismaClient instance
│   ├── config/
│   │   └── env.ts                ← Reads and validates all env variables at startup
│   ├── jobs/
│   │   └── shelly-sync.job.ts    ← Background polling loop (Shelly → state machine)
│   ├── modules/
│   │   ├── shelly/               ← HTTP client for Shelly Cloud API
│   │   ├── chairs/               ← Debounce state machine + chair REST endpoints
│   │   ├── sessions/             ← Session open/close + correction endpoints
│   │   ├── pricing/              ← Billing algorithm (expected_amount calculation)
│   │   ├── shifts/               ← Shift open/close + cash declaration endpoints
│   │   └── dashboard/            ← Assembles full dashboard state for WebSocket push
│   └── utils/
│       ├── logger.ts             ← Structured logger (level + timestamp)
│       └── time.ts               ← Timezone helpers (Africa/Casablanca)
│
├── backend/                      ← Legacy NestJS skeleton (kept, not yet replaced)
│   ├── prisma/
│   │   ├── schema.prisma         ← PostgreSQL schema (14 tables, 8 enums)
│   │   ├── seed.ts               ← Database seed script
│   │   └── migrations/           ← Applied Prisma migration history
│   ├── src/
│   │   ├── auth/                 ← JWT authentication module (login/register)
│   │   ├── users/                ← User CRUD module
│   │   └── prisma/               ← PrismaModule for NestJS DI
│   └── package.json
│
├── docs/
│   ├── DATABASE_ARCHITECTURE.md  ← Schema design, state machine, constraints
│   ├── MVP_SCOPE.md              ← Business scope and what is/isn't in MVP
│   ├── PROJECT_STRUCTURE.md      ← This file
│   └── REALTIME_ARCHITECTURE.md  ← Shelly polling + WebSocket design
│
├── .env.example                  ← All environment variable placeholders (no real values)
└── .gitignore
```

---

## Frontend — `web/`

### Why Next.js App Router

The dashboard is a mobile-first PWA. App Router gives server-side rendering, layouts, and route-level loading states out of the box — useful for the initial chair list page that must load quickly even on poor mobile connections.

### `web/src/app/`

Next.js App Router pages. Each folder under `app/` is a route segment. Pages are React Server Components by default; interactive components (WebSocket subscription, real-time updates) are `"use client"` components loaded inside server layouts.

### `web/src/components/`

Split into two sub-folders:

- `dashboard/` — components that are meaningful only within the dashboard context (e.g. `ChairCard`, `SessionTimer`, `ShiftSummary`). These may depend on dashboard-specific types.
- `ui/` — generic, context-free primitives (`Button`, `Badge`, `Card`, `Modal`). Nothing in `ui/` imports from `dashboard/`.

### `web/src/lib/`

Frontend utilities that are not React components:

- `socket.ts` — initialises the Socket.IO client and exports the socket instance
- `api.ts` — typed wrapper around `fetch` for REST calls to `NEXT_PUBLIC_API_URL`
- `formatters.ts` — duration, currency, and date formatting for display

---

## Backend — `server/`

### Why a Standalone Server Instead of Next.js API Routes

Next.js API routes run on demand (one request = one invocation). The Shelly polling loop must run continuously as a background process, and Socket.IO needs a persistent connection. These requirements do not fit the stateless serverless execution model of Next.js API routes.

The backend is a standard Node.js process: Express for REST endpoints, Socket.IO for WebSocket, and a setInterval loop for polling. It starts independently of the frontend and is the **sole source of truth** for chair state, sessions, and billing.

### `server/config/env.ts`

Reads every required environment variable at startup and throws immediately if any are missing or malformed. This prevents the server from starting in a broken state and makes misconfiguration obvious at deploy time rather than at runtime.

### `server/jobs/shelly-sync.job.ts`

The heartbeat of the system. Runs every `SYNC_INTERVAL_MS` (1000ms by default):

1. Calls `ShellyService.fetchAllChairs()` — **one HTTP request** for all 5 chairs
2. Passes each reading to `ChairStateService.processReading(chairId, watts)`
3. Persists any state changes to the `chairs` table
4. Opens or closes sessions via `SessionService` as the state machine transitions
5. Broadcasts the updated dashboard snapshot to all WebSocket clients

### Module organisation

Each module is a plain TypeScript directory with no framework coupling:

| Module | Responsibility |
|---|---|
| `shelly/` | Raw API communication — knows nothing about sessions or billing |
| `chairs/` | State machine and chair management REST |
| `sessions/` | Session lifecycle and correction REST |
| `pricing/` | Billing algorithm — pure function, no side effects |
| `shifts/` | Shift lifecycle and cash declaration REST |
| `dashboard/` | Read-only aggregation for the live dashboard snapshot |

The `pricing/` module has no controller because it is never called directly by HTTP — only by `session.service.ts` when a session closes.

---

## Prisma — `backend/prisma/`

The Prisma schema lives in `backend/prisma/` during the current migration phase. Once the NestJS `backend/` is fully replaced by the standalone `server/`, the `prisma/` directory will move to the repository root so it sits alongside `server/`.

The schema defines 14 tables and 8 enums. The `schema.prisma` file is the single authoritative source of the database structure. See `DATABASE_ARCHITECTURE.md` for the full table reference.

---

## Why Backend Is Separated from Frontend Logic

| Concern | Frontend (`web/`) | Backend (`server/`) |
|---|---|---|
| Shelly API key | ❌ Never | ✅ Env var only |
| Database access | ❌ Never | ✅ Only via Prisma |
| Business logic | ❌ Display only | ✅ All logic lives here |
| Session detection | ❌ Displays result | ✅ Detects and records |
| Billing calculation | ❌ Displays amount | ✅ Computes expected_amount |
| Auth token signing | ❌ Stores token | ✅ Signs and validates |

The frontend is intentionally thin: it receives data via WebSocket and REST, formats it for display, and sends mutations back to the backend. It contains no business rules. If the frontend is removed or replaced, all data remains correct in the database.
