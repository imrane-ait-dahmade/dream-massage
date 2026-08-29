# Migration `20260826140000_add_cash_accounts`

## Do not re-run this SQL manually

This migration has already been applied in production via `prisma migrate deploy`.

The file still contains historical recovery statements:

```sql
DROP TABLE IF EXISTS "cash_movements" CASCADE;
DROP TABLE IF EXISTS "cash_accounts" CASCADE;
DROP TYPE IF EXISTS "CashMovementType" CASCADE;
```

They were added only to clean up a **failed first apply** (enum created, tables failed on UUID vs TEXT FK). They are **not** part of normal ongoing deploy.

### Safe path

- Production / Fly: `npx prisma migrate deploy` (skips already-applied migrations).
- Do **not** edit this `migration.sql` (checksum is recorded in `_prisma_migrations`).
- Future cash changes: new **additive** migrations only.

### Unsafe path (data loss)

Re-executing this file by hand, or `prisma migrate reset`, would drop ledger tables and destroy cash history.

See `server/docs/PRODUCTION_MIGRATIONS.md`.
