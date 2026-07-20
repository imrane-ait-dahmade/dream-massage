# Déploiement sécurisé — modification de plan de session

## Prérequis

- Backup PostgreSQL production (pg_dump ou snapshot Neon)
- Migration additive déjà présente :
  `server/prisma/migrations/20260718140000_add_session_plan_change_requests/`
- Backend et frontend validés localement (`typecheck`, `test`, `build`)

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

- `CREATE TYPE SessionPlanChangeRequestStatus`
- `CREATE TABLE session_plan_change_requests`
- index + FK `RESTRICT` / `SET NULL`
- **aucun** `DROP` / `ALTER ... DROP` / rename sur tables existantes

### 3. Déployer la migration

```bash
cd server
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

### 4. Déployer le backend

Déployer la nouvelle version backend **avant** le frontend.

Smoke API (avec token Owner / Assistant) :

- `GET /api/sessions/:id` (ancien endpoint)
- `PATCH /api/sessions/:id/correction` (ancien)
- `POST /api/sessions/:id/plan-change-requests` (Assistant)
- `GET /api/session-plan-change-requests?status=PENDING` (Owner)
- `PATCH /api/sessions/:id/plan` (Owner)

### 5. Déployer le frontend

Déployer ensuite le frontend (pages `/assistant`, `/`, `/plan-change-requests`).

### 6. Smoke tests métier

1. Ouvrir une session **COMPLETED** de test
2. Compte Assistant → demander un changement de plan + raison
3. Vérifier que le plan / montant de la session n’ont **pas** changé
4. Compte Owner → `/plan-change-requests` → demande visible
5. Approuver → nouveau plan + nouveau `expectedAmount`
6. Vérifier que `correctedAmount` (si présent) est inchangé
7. Vérifier le dashboard / stats
8. Créer une 2ᵉ demande puis la refuser → session inchangée
9. Surveiller les logs serveur (erreurs 409 / 500)

### 7. Rollback applicatif

1. Redéployer l’ancienne version backend + frontend
2. **Ne pas** DROP la table `session_plan_change_requests`
3. Restaurer la base **uniquement** en cas de corruption réelle

## Checklist production

- [ ] Backup effectué et vérifié
- [ ] SQL migration relu (additif)
- [ ] `prisma migrate deploy` OK
- [ ] Anciens endpoints OK
- [ ] Demande Assistant OK (session inchangée)
- [ ] Approbation Owner OK
- [ ] Refus Owner OK
- [ ] Stats cohérentes
- [ ] Logs propres 15–30 min
