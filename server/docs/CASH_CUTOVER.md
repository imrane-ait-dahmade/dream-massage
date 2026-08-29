# Cutover caisses — soldes initiaux (Dream Care)

## Principe

Au passage en production du ledger, **chaque caisse physique** (Caisse 1 / Caisse 2) a un solde d’ouverture = **cash physiquement compté dans ce tiroir**.

- Cutover **par caisse physique**, pas par fille.
- **Pas** de backfill depuis `correctedAmount` / sessions / `expectedCash`.
- Les paiements **avant** cutover restent hors caisse (legacy guard).
- Les paiements **après** cutover alimentent la caisse du shift via `syncSessionPaidAmount` (attribution fille optionnelle sur le mouvement).

## Mécanisme

`POST /api/cash/accounts/:cashAccountId/initial-balance`  
Rôle : **OWNER uniquement**  
Body :

```json
{ "countedAmount": 1250, "reason": "Cutover caisse production" }
```

Crée un mouvement `INITIAL_BALANCE` (unique par caisse physique, index DB).  
`staffMemberId` est `null` (cutover au niveau du tiroir).

UI : bouton **Solde d'ouverture** sur `/caisses` (caisse vide, OWNER seulement).

## Procédure opérateur

1. Choisir **date/heure** de cutover (ex. fin de journée, caisses stables).
2. **Pause courte** des nouveaux encaissements / corrections paid si possible (quelques minutes).
3. Compter le cash de **Caisse 1** → noter le montant.
4. OWNER appelle `initial-balance` pour Caisse 1 avec ce montant.
5. Compter le cash de **Caisse 2** → noter.
6. OWNER saisit `initial-balance` pour Caisse 2.
7. Vérifier sur `/caisses` : soldes physiques = montants comptés ; total magasin = Caisse 1 + Caisse 2.
8. Faire un **paiement test** (nouvelle session sur un shift lié à une caisse, `correctedAmount` renseigné).
9. Confirmer **+montant exactement une fois** sur la bonne caisse (pas de double).
10. Reprendre l’exploitation normale.

## Interdit

- Deuxième `INITIAL_BALANCE` sur la même caisse physique
- Cutover si mouvements déjà présents (utiliser correction admin après coup)
- Backfill automatique des anciennes sessions
- Appel par ASSISTANT / fille
- Cutover « par fille » (les soldes physiques ne se filtrent pas par staff)

## Vérification legacy

`planSessionPaidSync` : si une session avait déjà un `correctedAmount` avant toute ligne ledger → **aucun crédit rétroactif**.
