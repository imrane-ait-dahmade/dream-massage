# Assistant Interface — Dream Care

Read-only dashboard for massage shop assistants (`StaffMember` records with a linked login).

---

## Role model

| Role | Login | `staffMemberId` | Access |
|------|-------|-----------------|--------|
| `OWNER` | Yes | `null` | Full admin dashboard + settings |
| `ADMIN` | Yes | `null` | Same as owner (MVP) |
| `ASSISTANT` | Yes | **Required** — links to one `StaffMember` | Read-only `/assistant` only |

- **`StaffMember`** = business record (name, shifts, sessions). Physical employee.
- **`User`** = login account. Assistants have `role = ASSISTANT` and `staffMemberId` set.
- Owner/Admin users never have `staffMemberId`.

---

## Permission matrix (production)

### ASSISTANT allowed

| Layer | Resource |
|-------|----------|
| Frontend | `/assistant`, `/login` |
| API | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` |
| API | `GET /api/assistant/me`, `GET /api/assistant/today`, `GET /api/assistant/sessions` |

### ASSISTANT forbidden → 403 API / redirect `/assistant` frontend

| Layer | Resource |
|-------|----------|
| Frontend | `/`, `/settings`, `/chairs/*`, `/reports` (if added) |
| API | `/api/dashboard/*`, `/api/settings/*`, `/api/shelly/*`, `/api/dev/*` |
| API | `/api/chairs/*`, `/api/shifts/*`, `/api/sessions/*` |

Forbidden API response:

```json
{ "ok": false, "error": "Forbidden" }
```

---

## Data scoping

- **ASSISTANT**: `staffMemberId` query param is **ignored**; server always uses `req.user.staffMemberId`.
- **OWNER/ADMIN**: may pass `?staffMemberId=<uuid>` on `/api/assistant/today` and `/sessions` for preview.

---

## Assistant login validation

Login succeeds only when ALL are true for `ASSISTANT`:

1. `user.isActive === true`
2. `user.staffMemberId` is set
3. Linked `StaffMember` exists
4. `StaffMember.isActive === true`

Otherwise:

```json
{ "ok": false, "error": "Assistant account is not active" }
```

HTTP **403** (after correct password). Generic **401** for wrong credentials.

Existing JWTs are invalidated on next `GET /api/auth/me` if staff is deactivated.

---

## Dev credentials

After `npm run prisma:seed` in `server/` (non-production only):

| Field | Value |
|-------|-------|
| Email | `assistant@example.com` |
| Password | `assistant123` |
| Staff | Fille 1 |

Owner: `owner@example.com` / `changeme123`

**Never use these passwords in production.**

---

## Manual API test checklist

Replace `BASE` with your API URL (e.g. `http://localhost:4001`).

### Owner

```bash
# Login
curl -s -c cookies.txt -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"changeme123"}'

# Dashboard — expect 200
curl -s -b cookies.txt "$BASE/api/dashboard/home"

# Settings — expect 200
curl -s -b cookies.txt "$BASE/api/settings/chairs"
```

### Assistant

```bash
# Login
curl -s -c cookies-asst.txt -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"assistant@example.com","password":"assistant123"}'

# Assistant routes — expect 200
curl -s -b cookies-asst.txt "$BASE/api/assistant/me"
curl -s -b cookies-asst.txt "$BASE/api/assistant/today"

# Admin routes — expect 403
curl -s -b cookies-asst.txt "$BASE/api/settings/chairs"
curl -s -b cookies-asst.txt "$BASE/api/dashboard/home"
curl -s -b cookies-asst.txt "$BASE/api/sessions/SOME_SESSION_ID"

# Tampered staffMemberId — must still return own data only (200, own staff name)
curl -s -b cookies-asst.txt "$BASE/api/assistant/today?staffMemberId=00000000-0000-0000-0001-000000000003"
```

### Inactive staff test

1. Set linked `StaffMember.isActive = false` in DB.
2. Assistant login → **403** `Assistant account is not active`.
3. Restore `isActive = true` after test.

---

## Frontend manual tests

1. Assistant login → redirect `/assistant`.
2. Assistant opens `/settings` or `/` → redirect `/assistant`.
3. Owner login → redirect `/`.
4. Owner `/settings` still works.
5. Logout works for both roles.
6. `/assistant` page has no settings, edit, or delete controls.

---

## Security notes

1. **JWT + httpOnly cookie** (+ Bearer fallback for Safari).
2. **`requireOwnerAdmin`** on all admin route prefixes in `server/index.ts`.
3. **`requireAssistant`** on `GET /api/assistant/me`.
4. **`requireAssistantRouteAccess`** on `/today` and `/sessions`.
5. Assistant page does not subscribe to admin WebSocket dashboard.

---

## Deployment notes

- **No Prisma schema changes** required for this security fix (schema already has `ASSISTANT` + `staffMemberId`).
- **No `prisma db push`** or destructive DB commands needed.
- Deploy **server** first (middleware + auth), then **web** (AuthGuard unchanged but verify).
- After deploy: run manual API checklist above against production URL.
- To disable an assistant: set `StaffMember.isActive = false` (login blocked immediately).

---

## TODOs

- [ ] Owner UI to create/disable assistant accounts
- [ ] Socket auth on admin WebSocket
- [ ] Optional: show `netRevenue` on assistant dashboard
- [ ] Role-based differentiation between OWNER and ADMIN
