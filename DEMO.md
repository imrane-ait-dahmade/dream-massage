# Dream Care — Guide de démonstration client

Ce document explique comment utiliser l'application **Dream Care** au quotidien : connexion, tableau de bord, gestion des shifts, suivi des fauteuils et interface assistante.

---

## 1. À quoi sert l'application ?

Dream Care gère automatiquement votre salon de massage (5 fauteuils) :

- **Détection automatique des séances** via les prises connectées Shelly (consommation électrique du fauteuil)
- **Calcul du chiffre d'affaires** selon vos tarifs (20 / 30 / 40 MAD)
- **Suivi en temps réel** : quel fauteuil est occupé, depuis combien de temps, combien rapporte la journée
- **Gestion des shifts** (matin / soir) avec assistante assignée, primes et réconciliation caisse

> **Important :** les assistantes **ne déclenchent rien** dans l'application. Quand un client s'installe sur un fauteuil, la séance démarre et s'arrête toute seule. Vous (propriétaire / admin) pilotez le salon depuis le tableau de bord.

---

## 2. Accès à l'application

| Environnement | URL |
|---|---|
| **Production** (recommandé pour la démo client) | `https://dreamcare-gules.vercel.app` |
| **Développement local** | `http://localhost:3000` (nécessite le serveur API sur le port 4001) |

### Connexion

1. Ouvrez l'URL dans un navigateur (Chrome, Safari, Firefox).
2. Saisissez votre **e-mail** et **mot de passe**.
3. Après connexion :
   - **Propriétaire / Admin** → tableau de bord principal (`/`)
   - **Assistante** → écran lecture seule (`/assistant`)

---

## 3. Comptes et rôles

| Rôle | Qui ? | Accès |
|---|---|---|
| **OWNER** (Propriétaire) | Vous | Tableau de bord complet + Paramètres |
| **ADMIN** | Gérant de confiance | Identique au propriétaire |
| **ASSISTANT** | Employée avec compte | Uniquement sa vue du jour (lecture seule) |

### Comptes de démonstration (environnement de test uniquement)

> ⚠️ **Ne jamais utiliser ces mots de passe en production.** Changez-les avant la mise en service réelle.

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Propriétaire | `owner@example.com` | `changeme123` |
| Assistante (ex. « Fille 1 ») | `assistant@example.com` | `assistant123` |

---

## 4. Parcours démo — une journée type

Suivez ces étapes pour voir l'application en action.

### Étape A — Préparer la journée (propriétaire)

1. Connectez-vous avec le compte **propriétaire**.
2. Cliquez sur l'icône **Paramètres** (engrenage en haut à droite).
3. Vérifiez les onglets suivants :

| Onglet | Ce qu'il faut vérifier |
|---|---|
| **Staff** | Les assistantes actives sont listées |
| **Shifts & Planning** | Le planning de la semaine est renseigné (qui travaille quel jour, matin/soir) |
| **Prix & plans** | Plans 20 min / 30 min / 40 min avec les bons montants |
| **Fauteuils** | F1 à F5 sont en ligne (icône Wi-Fi verte) |

4. Si aucun shift n'est ouvert automatiquement :
   - Onglet **Shifts & Planning** → section **Actions manuelles**
   - Sélectionnez l'assistante du jour → **Ouvrir le shift**
   - Ou cliquez **Vérifier maintenant** pour déclencher l'automatisation

### Étape B — Observer les fauteuils en temps réel

1. Retournez au **tableau de bord** (page d'accueil).
2. La section **Fauteuils en temps réel** affiche l'état de chaque fauteuil :

| État affiché | Signification |
|---|---|
| **Disponible** | Fauteuil libre, prêt |
| **Démarrage** | Consommation détectée, confirmation en cours |
| **Actif** | Séance en cours (timer visible) |
| **Fin possible** | Le fauteuil semble s'arrêter, confirmation en cours |
| **Hors ligne** | Pas de signal Shelly — à vérifier |

3. Cliquez sur un fauteuil pour voir le **détail** (historique, puissance, dernière synchro).

> **En salon réel :** dès qu'un client utilise un fauteuil, son statut passe à **Actif** sans action de l'assistante.

### Étape C — Suivre le chiffre d'affaires

Sur le tableau de bord, consultez :

- **Cartes résumé** : sessions du jour, CA, fauteuils actifs
- **Shift actif** : nom de l'assistante, heure d'ouverture, fin prévue
- **Graphique recettes** : évolution sur la période filtrée
- **Primes & recettes** : objectifs de bonus matin/soir
- **Tableau des sessions** : chaque séance avec durée, plan, montant

Utilisez les **filtres** (date, shift, assistante) pour affiner la vue.

### Étape D — Corriger une session si besoin

Si un montant est incorrect (erreur de durée, geste commercial) :

1. Dans le tableau des sessions, cliquez sur la session concernée.
2. Choisissez **Corriger**.
3. Saisissez le nouveau montant et un **motif** (obligatoire).
4. L'ancien montant reste visible dans l'historique ; le montant corrigé est utilisé pour le CA.

### Étape E — Fin de shift et caisse

1. À la fin de la période (ou manuellement dans **Paramètres → Shifts & Planning**), le shift se **ferme**.
2. Le système calcule le **montant attendu** (somme des séances).
3. Vous saisissez la **caisse déclarée** (espèces réellement comptées).
4. L'écart attendu / déclaré apparaît pour la réconciliation.

### Étape F — Vue assistante

1. Déconnectez-vous (icône en haut à droite).
2. Connectez-vous avec le compte **assistante**.
3. L'écran affiche **uniquement les données de cette assistante** :
   - Shift du jour
   - Sessions réalisées
   - Objectifs et primes
   - Montants (sans possibilité de modifier quoi que ce soit)

> Une assistante **ne peut pas** accéder aux Paramètres ni au tableau de bord propriétaire.

---

## 5. Tableau de bord — détail des sections

```
┌─────────────────────────────────────────────────────────┐
│  Dream Care          [Paramètres] [Connecté] [Déco]     │
├─────────────────────────────────────────────────────────┤
│  KPI : Sessions · CA · Fauteuils actifs · Alertes       │
│  Shift actif : Assist. X — ouvert 08:00 — fin 15:00     │
│  Alertes : fauteuils hors ligne, sessions hors règle    │
│  Filtres : date · shift · assistante                    │
│  Fauteuils F1 F2 F3 F4 F5  (temps réel)                 │
│  Graphique recettes                                     │
│  Primes & bonus                                         │
│  Totaux par fauteuil                                    │
│  Liste des sessions récentes                            │
└─────────────────────────────────────────────────────────┘
```

### Alertes à surveiller

| Alerte | Action recommandée |
|---|---|
| Fauteuil **hors ligne** | Vérifier l'alimentation Shelly / connexion Wi-Fi |
| Session **hors règle** | Trop courte ou trop longue — corriger ou valider manuellement |
| Sessions **sans shift actif** | Ouvrir un shift ou vérifier le planning |

---

## 6. Paramètres — guide rapide

| Onglet | Usage |
|---|---|
| **Fauteuils** | Nom, état, liaison Shelly, seuils de détection |
| **Prix & plans** | Durées et tarifs (20 / 30 / 40 min) + règle de facturation |
| **Staff** | Ajouter / archiver une assistante |
| **Système** | Fuseau horaire, devise, intervalle de synchro |
| **Primes & Bonus** | Seuils de CA pour bonus matin et soir |
| **Shifts & Planning** | Planning hebdomadaire + ouverture/fermeture manuelle |
| **Sessions** | Durée minimale, tolérance (grace), politique dépassement |
| **Utilisateurs & Accès** | Créer des comptes admin ou assistante |
| **Maintenance** | Outils de maintenance (réservé admin) |

---

## 7. Tarification — comment le montant est calculé

Plans par défaut :

| Durée | Prix |
|---|---|
| 20 minutes | 20 MAD |
| 30 minutes | 30 MAD |
| 40 minutes | 40 MAD |

**Règle « plan suivant »** : la durée réelle est arrondie au plan immédiatement supérieur, avec **2 minutes de tolérance**.

Exemples :

| Durée réelle | Facturé |
|---|---|
| Moins de 3 min | Anomalie (0 MAD, à valider) |
| 20 min | 20 MAD |
| 22 min (dans la tolérance) | 20 MAD |
| 23 min | 30 MAD |
| 35 min | 40 MAD |
| Plus de 42 min | Anomalie « trop long » |

---

## 8. Shifts et planning automatique

- **Matin** : généralement 08:00 → 15:00  
- **Soir** : généralement 15:00 → 23:45  

Le système ouvre et ferme les shifts **automatiquement** selon le planning hebdomadaire (vérification toutes les 15 minutes).

| Situation | Que faire |
|---|---|
| Shift non ouvert à l'heure prévue | Paramètres → Shifts → **Vérifier maintenant** |
| Urgence (assistante absente) | Fermer le shift manuellement, en ouvrir un autre |
| Fin de journée | Le shift se ferme ; saisir la caisse déclarée |

---

## 9. Primes et bonus

Des **bonus** peuvent s'ajouter si le CA du shift atteint un seuil :

| Période | Exemple de règle |
|---|---|
| **Matin** | ≥ 500 MAD de CA → +50 MAD de bonus |
| **Soir** | ≥ 1 000 MAD de CA → +100 MAD de bonus |

Les cartes **Primes & recettes** du tableau de bord montrent si l'objectif est atteint.

---

## 10. Checklist avant démo client

- [ ] Application accessible (URL production ou locale)
- [ ] Compte propriétaire fonctionnel
- [ ] Au moins un shift ouvert (ou planning du jour configuré)
- [ ] Fauteuils Shelly en ligne (statut **Connecté** en haut à droite)
- [ ] Compte assistante de test disponible (optionnel)
- [ ] Un fauteuil en utilisation réelle ou simulée pour montrer le passage **Disponible → Actif**

---

## 11. Questions fréquentes

**L'assistante doit-elle appuyer sur un bouton pour démarrer une séance ?**  
Non. La détection est 100 % automatique via la consommation électrique.

**Puis-je modifier un tarif après coup ?**  
Oui, via **Corriger** sur une session. Le motif est enregistré.

**Que se passe-t-il si le Wi-Fi du Shelly coupe ?**  
Le fauteuil passe **Hors ligne**. Les séances en cours peuvent être affectées — rétablir la connexion dès que possible.

**Combien de shifts peuvent être ouverts en même temps ?**  
Par défaut, **un seul** shift ouvert à la fois. Configurable si plusieurs assistantes travaillent en parallèle.

**La session reste-t-il connecté longtemps ?**  
Oui — la connexion est maintenue plusieurs mois sans ressaisir le mot de passe (usage interne salon).

---

## 12. Support technique

Pour l'installation locale ou la configuration Shelly / base de données, référez-vous à la documentation technique du projet (`server/docs/`, `docs/`).

Pour une démo guidée en salon :
1. Ouvrir le tableau de bord propriétaire
2. Montrer un fauteuil qui passe en **Actif**
3. Montrer la session apparaître dans la liste avec le bon montant
4. Montrer la vue assistante en lecture seule
5. Montrer la fermeture de shift et la saisie caisse

---

*Dream Care — Gestion intelligente de salon de massage*
