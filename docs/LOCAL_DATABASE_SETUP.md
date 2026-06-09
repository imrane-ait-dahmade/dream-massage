# Local Database Setup — Dream Massage

Use local PostgreSQL during development for fast, offline-capable Prisma commands
without Supabase pooler latency.

---

## Step 1 — Create the database

### Option A: pgAdmin (GUI)

1. Open pgAdmin
2. In the left panel, expand **Servers → PostgreSQL → Databases**
3. Right-click **Databases** → **Create → Database...**
4. Set **Database** name to: `dream_massage`
5. Set **Owner** to: `postgres`
6. Click **Save**

### Option B: psql (CLI)

```bash
psql -U postgres -c "CREATE DATABASE dream_massage;"
```

### Option C: createdb utility

```bash
createdb -U postgres dream_massage
```

---

## Step 2 — Set DATABASE_URL in server/.env

The file should already contain:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dream_massage?schema=public"
```

**If your local Postgres uses a different password**, change the second `postgres`
in the URL. For example, if your password is `mypass`:

```env
DATABASE_URL="postgresql://postgres:mypass@localhost:5432/dream_massage?schema=public"
```

---

## Step 3 — Push schema to the database

Run all commands from inside `server/`:

```bash
cd server

# Validate schema syntax (no DB connection needed)
npx prisma validate

# Push schema to local DB (creates all tables, enums, indexes)
npx prisma db push

# Seed with owner user, 5 chairs, pricing plans, and app settings
npm run prisma:seed

# Open visual browser for the database
npx prisma studio
```

### What `prisma db push` does

- Creates all tables defined in `server/prisma/schema.prisma`
- Creates all enums (UserRole, ChairStatus, SessionStatus, etc.)
- Creates all regular indexes
- **Does NOT create partial unique indexes** — apply those manually (see below)

---

## Step 4 — Apply partial unique indexes

After `db push`, connect to the database and run these SQL statements.

**Via Supabase SQL Editor or psql:**

```sql
-- One ACTIVE session per chair at a time
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_session_per_chair
  ON chair_sessions (chair_id)
  WHERE status = 'ACTIVE';

-- One active detection config per chair
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_detection_config_per_chair
  ON chair_detection_configs (chair_id)
  WHERE is_active = true;

-- One active pricing rule globally
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_pricing_rule
  ON pricing_rules (is_active)
  WHERE is_active = true;

-- One open shift at a time
CREATE UNIQUE INDEX IF NOT EXISTS unique_open_shift
  ON shifts (status)
  WHERE status = 'OPEN';
```

**Via psql CLI:**

```bash
psql -U postgres -d dream_massage -f server/prisma/partial_indexes.sql
```

(Create that file by copying the SQL above into it.)

---

## Step 5 — Verify tables exist

**Via psql:**

```bash
psql -U postgres -d dream_massage -c "\dt"
```

Expected output (12 tables):

```
 app_settings
 chair_detection_configs
 chair_events
 chair_sessions
 chairs
 device_logs
 pricing_plans
 pricing_rules
 settings_audit_logs
 shifts
 staff_members
 users
```

**Via pgAdmin:**

Expand: `Servers → PostgreSQL → dream_massage → Schemas → public → Tables`

**Via Prisma Studio:**

```bash
cd server && npx prisma studio
```

Opens at http://localhost:5555 — all 12 models visible in the left panel.

---

## Prisma v7 note — why there is no `url` in schema.prisma

Prisma v7 removed `url = env("DATABASE_URL")` from `datasource` blocks in `schema.prisma`.
The connection URL is now configured in `server/prisma.config.ts`:

```typescript
export default defineConfig({
  datasource: {
    url: process.env['DATABASE_URL']!,  // ← reads from server/.env
  },
});
```

This means the URL is still driven by the `DATABASE_URL` environment variable —
just through the config file instead of the schema. Changing `.env` is all you need
to switch between local and Supabase.

---

## Switching back to Supabase

When ready to deploy, edit `server/.env`:

```env
# Comment out local:
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dream_massage?schema=public"

# Uncomment Supabase:
DATABASE_URL="postgresql://postgres.yfszydzplmoesmejyrsl:...@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
```

Then re-run seed if the Supabase DB needs initial data:

```bash
cd server && npm run prisma:seed
```
