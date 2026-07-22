# Déploiement sécurisé — modification session (plan et/ou montant payé)

## Prérequis

- Backup PostgreSQL production (pg_dump ou snapshot Neon)
- Migration additive :
  `server/prisma/migrations/20260721220000_session_modification_paid_amount/`
- Backend et frontend validés localement (`typecheck`, `test:session-plan-change`, build)

## Sémantique des montants

| Concept | Stockage | Rôle |
|---------|----------|------|
| Prix attendu | `chair_sessions.expected_amount` | Prix théorique du plan |
| Montant payé | `chair_sessions.corrected_amount` | Montant réellement encaissé (`paidAmount` métier) |

Ne jamais modifier le prix du plan catalogue pour représenter une réduction, une séance offerte ou un impayé. Utiliser `corrected_amount` (y compris `0`).

## Commandes à NE JAMAIS utiliser en production

```bash
prisma migrate reset
prisma db push --force-reset
prisma db seed
```

## Ordre de déploiement

### 1. Sauvegarde

```bash
pg_dump "$DATABASE_URL" > backup-dream-massage-$(date +%Y%m%d-%H%M).sql
# ou snapshot Neon via dashboard
```

### 2. Vérifier le SQL de migration

Contrôler que le fichier contient uniquement :

- `ALTER COLUMN ... DROP NOT NULL` sur 3 champs plan de `session_plan_change_requests`
- `ADD COLUMN original_paid_amount` / `requested_paid_amount`
- **aucun** `DROP` / rename sur `chair_sessions`
- **aucune** altération de données existantes (backfill non requis)

### 3. Déployer la migration

```bash
cd server
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

### 4. Déployer le backend

Déployer la nouvelle version backend **avant** le frontend.

Smoke API :

- `POST /api/sessions/:id/plan-change-requests` avec `{ requestedPaidAmount: 0, reason: "Séance offerte" }` (Assistant)
- `POST /api/sessions/:id/plan-change-requests` avec `{ requestedPlanId, reason }` (plan seul — rétrocompat)
- `POST /api/sessions/:id/plan-change-requests` avec les deux champs
- `POST .../approve` / `.../reject` (Owner)
- Anciens endpoints : `PATCH .../plan`, `PATCH .../correction`

### 5. Déployer le frontend

Pages `/assistant`, `/`, `/plan-change-requests`.

### 6. Smoke tests métier

1. Session COMPLETED : plan 10 min, expected 40 DH
2. Assistant → modifier **uniquement** le montant payé à **0 DH**, raison « Séance offerte »
3. Vérifier que la session n’a pas changé tant que PENDING
4. Owner → valider → `expectedAmount` inchangé, `correctedAmount = 0`
5. Demande plan-only + demande combinée + refus
6. Vérifier dashboard / stats

### 7. Rollback applicatif

1. Redéployer l’ancienne version backend + frontend
2. **Ne pas** DROP les colonnes `original_paid_amount` / `requested_paid_amount`
3. Restaurer la base **uniquement** en cas de corruption réelle

## Checklist production

- [ ] Backup effectué et vérifié
- [ ] SQL migration relu (additif)
- [ ] `prisma migrate deploy` OK
- [ ] Demande montant payé seul (0 DH) OK
- [ ] Demande plan seul OK
- [ ] Demande combinée OK
- [ ] Approbation / refus Owner OK
- [ ] Stats cohérentes
- [ ] Logs propres 15–30 min
