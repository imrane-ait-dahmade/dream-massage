# Authentication — dreamMassage MVP

## Overview

dreamMassage uses **JWT tokens stored in httpOnly cookies** for authentication. Only `User` accounts (OWNER or ADMIN role) can log in. `StaffMember` records have no login and never will.

## Roles

| Role | Description |
|---|---|
| `OWNER` | Full access to all routes and settings |
| `ADMIN` | Full access to all routes and settings (same as OWNER for MVP) |

## Token lifetime

JWT tokens are valid for **3 years** (`1095d`). This is intentional for an internal owner/admin application to avoid forcing daily re-logins. The trade-off is that a compromised token lives longer.

**Mitigation**: If a device is lost or a token is compromised, change `JWT_SECRET` in the server env and restart — all existing tokens become invalid immediately.

## Cookie

| Property | Value |
|---|---|
| Name | `dream_massage_token` (from `COOKIE_NAME`) |
| `httpOnly` | `true` — not readable by JavaScript |
| `sameSite` | `lax` (local dev) / `strict` (recommended prod) |
| `secure` | `false` (local dev) / `true` (production — requires HTTPS) |
| `maxAge` | 3 years |

## Routes

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Server health check |
| `POST` | `/api/auth/login` | Login — sets cookie, returns user |

### Protected (requires valid JWT cookie)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/me` | Return current user |
| `POST` | `/api/auth/logout` | Clear cookie |
| `GET` | `/api/dashboard/state` | Dashboard data |
| `*` | `/api/chairs/*` | Chair management |
| `*` | `/api/settings/*` | Settings management |
| `*` | `/api/shelly/*` | Shelly device management |
| `*` | `/api/dev/*` | Dev/simulation endpoints |

## Environment variables

```env
JWT_SECRET="long_random_secret"   # Required. Min 16 chars.
JWT_EXPIRES_IN="1095d"            # 3 years
COOKIE_NAME="dream_massage_token"
COOKIE_SECURE=false               # false local, true production
COOKIE_SAME_SITE="lax"           # lax or strict
```

Generate a strong secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Local dev credentials

```
email    : owner@example.com
password : changeme123
```

These are set by `npm run prisma:seed`. **Change before going to production.**

## Login flow

```
Browser → POST /api/auth/login { email, password }
Server  → verifies bcrypt hash, signs JWT
Server  → Set-Cookie: dream_massage_token=<jwt>; HttpOnly; SameSite=Lax
Browser → redirected to dashboard
```

All subsequent requests include the cookie automatically (same-site). No token management in JavaScript needed.

## Frontend auth guard

Every protected page checks `/api/auth/me` on mount. If the request returns 401, the user is redirected to `/login`. This is a lightweight client-side guard — the real enforcement is on the server.

## Socket.IO

Socket connections currently do **not** require authentication (the cookie is sent with `withCredentials: true` but not verified server-side).

**TODO**: Add Socket.IO `io.use()` middleware to verify the JWT cookie on connect and disconnect unauthorized clients.

## Production checklist

- [ ] Set `JWT_SECRET` to a cryptographically random 48+ byte hex string
- [ ] Set `COOKIE_SECURE=true` (requires HTTPS)
- [ ] Set `COOKIE_SAME_SITE=strict`
- [ ] Change owner password from `changeme123`
- [ ] Use HTTPS (required for `COOKIE_SECURE=true`)
- [ ] Never commit real `JWT_SECRET` to version control
