# Production database migrations — Dream Care

## Règles absolues

1. **Production = `prisma migrate deploy` uniquement** (déjà dans `fly.toml` → `release_command`).
2. **Jamais** `prisma migrate reset` en production.
3. **Jamais** supprimer ou éditer manuellement `_prisma_migrations` sans procédure écrite + backup.
4. **Jamais** rejouer à la main un fichier `migration.sql` déjà appliqué.
5. **Backup Neon (ou dump) obligatoire** avant toute intervention SQL manuelle.

## Déploiement normal

```bash
# Sur la machine de release (Fly release_command le fait déjà) :
cd server
npx prisma migrate deploy
npx prisma generate
```

`migrate deploy` n’exécute que les migrations **pas encore** présentes dans `_prisma_migrations`. Une migration déjà appliquée n’est **pas** rejouée.

## Migration cash `20260826140000_add_cash_accounts`

### Historique des DROP

Le fichier contient en tête :

```sql
DROP TABLE IF EXISTS "cash_movements" CASCADE;
DROP TABLE IF EXISTS "cash_accounts" CASCADE;
DROP TYPE IF EXISTS "CashMovementType" CASCADE;
```

**Cause :** première tentative d’apply avait échoué après création du type `CashMovementType` (FK uuid vs text). Les DROP ont servi de nettoyage one-shot pour réappliquer proprement.

**Statut :** migration **déjà appliquée** en production. Via `migrate deploy`, ces DROP **ne s’exécutent plus**.

### Pourquoi on ne réécrit PAS le fichier SQL

Modifier un `migration.sql` déjà appliqué change le checksum Prisma → `migrate deploy` échoue sur les environnements déjà migrés. On **ne modifie pas** l’historique appliqué.

### Danger réel restant

Les DROP sont dangereux **uniquement** si quelqu’un :

- exécute le SQL à la main sur une DB avec des données cash, ou
- lance `prisma migrate reset` / force-reset.

Alors `CASCADE` supprimerait `cash_accounts`, `cash_movements` et le type enum (données ledger perdues).

### Migrations futures

Toute évolution cash doit être **strictement additive** (ALTER / CREATE INDEX / CREATE TABLE). Aucun `DROP … CASCADE` sur `cash_accounts` / `cash_movements` / `CashMovementType` sauf procédure de decommission signée + backup.

## Commandes INTERDITES en production

```bash
npx prisma migrate reset
npx prisma migrate reset --force
npx prisma db push --force-reset
# Exécuter manuellement le SQL d'une migration déjà appliquée
# DELETE / TRUNCATE sur _prisma_migrations
# DROP TABLE cash_accounts / cash_movements
```

## Local / staging

- Local : `prisma migrate dev` OK sur DB jetable.
- Staging : même règle que prod si la DB contient des données réelles → `migrate deploy` + backup.

## Références

- `server/fly.toml` — `release_command = "npx prisma migrate deploy"`
- `server/prisma/migrations/20260826140000_add_cash_accounts/README.md`
- `server/docs/DATA_MAINTENANCE.md`
- `server/docs/CASH_CUTOVER.md` — soldes d’ouverture (INITIAL_BALANCE), procédure opérateur
