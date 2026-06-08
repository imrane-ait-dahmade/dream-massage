# Rapport du Projet — Dream Care (Gestion de Chaises Massage)

---

## Structure du Projet

```
massage-main/
├── web/        → Frontend Next.js  (ce qui est affiché à l'utilisateur)
└── backend/    → Backend NestJS    (API serveur — en cours de construction)
```

---

## Ce qu'on a déjà

### 1. Frontend — `web/` (Next.js 16 + React 19)

#### Pages existantes
| Route | Rôle |
|-------|------|
| `/login` | Connexion email/mot de passe |
| `/login2` | Connexion OAuth Shelly Cloud |
| `/dashboard` | Monitoring temps réel des appareils Shelly (IoT) |
| `/stats` | Page principale des statistiques et primes |
| `/admin` | Tableau de bord admin (utilisateurs, prix, règles) |

#### Fonctionnalités implémentées
- **Suivi des sessions** : détection automatique ON/OFF via capteurs de puissance Shelly (seuil >5W = démarrage, <3W = arrêt)
- **Statistiques** : chiffre d'affaires journalier, utilisation par chaise, sessions par durée
- **Graphiques** : courbes revenus 30 jours, camembert utilisation, barres sessions (Recharts)
- **Calcul des primes** : tranches matin/après-midi avec bonus par seuil de CA
- **Corrections manuelles** : les admins peuvent corriger le prix d'une session
- **Export Excel** : tableaux formatés exportables via ExcelJS
- **Gestion des utilisateurs** : création, modification, suppression (roles admin/user)

#### Données gérées
- **5 chaises** : F1, F2, F3, F4, F5 (mappées depuis les IDs Shelly)
- **Tarifs sessions** : 5min→20dh, 10min→40dh, 15min→60dh, 20min→80dh, 30min→100dh
- **Périodes** : Matin, Après-midi, Journée entière
- **Règles de prime** : tranches + bonus par période

#### API Routes déjà dans Next.js (`web/src/app/api/`)
| Endpoint | Fonction |
|----------|----------|
| `POST /api/logout` | Déconnexion |
| `GET /api/sessions` | Lister les sessions |
| `PUT /api/admin/sessions/override` | Correction prix session |
| `GET/POST /api/admin/users` | Gestion utilisateurs |
| `GET /api/session_pricing` | Règles de tarification |
| `GET /api/prime_rules` | Règles de primes |
| `GET /api/stats_periods` | Définitions des périodes |
| `GET /api/device_state` | État actuel des chaises |
| `GET /api/poll` | Interrogation appareils Shelly |

#### Stack Frontend
- Next.js 16, React 19, TailwindCSS 4
- Supabase (auth + base de données PostgreSQL)
- Recharts (graphiques), SWR (data fetching), ExcelJS (export)

---

### 2. Backend — `backend/` (NestJS 11)

#### État actuel
Le backend NestJS est un **squelette vide** (scaffold de base) :
- `main.js` → démarre le serveur sur le port 3000
- `app.module.js` → module racine
- `app.controller.js` → un seul endpoint `GET /` qui retourne "Hello World"
- `app.service.js` → service basique

**Aucune logique métier n'est encore implémentée dans NestJS.**

---

### 3. Base de données — Supabase (PostgreSQL)

Tables existantes (utilisées par le frontend) :
| Table | Contenu |
|-------|---------|
| `sessions` | Sessions enregistrées par chaise |
| `session_pricing` | Règles de tarification par durée |
| `prime_rules` | Règles de calcul des primes |
| `stats_periods` | Définitions des périodes horaires |
| `device_state` | État ON/OFF des chaises |
| `profiles` | Profils utilisateurs avec rôles |

---

## Ce qu'on a besoin (À faire)

### Priorité 1 — Backend NestJS (Architecture API)

Migrer les routes API de Next.js vers NestJS pour avoir une vraie séparation frontend/backend :

- [ ] **Module Auth** : login, logout, vérification JWT, rôles (admin/user)
- [ ] **Module Sessions** : CRUD sessions, filtres par date et device, correction manuelle
- [ ] **Module Devices** : état des chaises, polling Shelly, mapping IDs
- [ ] **Module Pricing** : règles de tarification, calcul automatique des buckets
- [ ] **Module Primes** : calcul des primes par période, tranches, bonus
- [ ] **Module Users** (Admin) : gestion des utilisateurs
- [ ] **Module Stats** : agrégation données pour graphiques et exports

### Priorité 2 — Intégration Supabase dans NestJS

- [ ] Connecter NestJS à Supabase (client Supabase ou Prisma)
- [ ] Protéger les routes avec Guards NestJS (JWT + rôles)
- [ ] Configurer les variables d'environnement (`backend/.env`)

### Priorité 3 — Fonctionnalités manquantes

- [ ] **Polling automatique** : job planifié (cron) pour interroger les Shelly toutes les X secondes
- [ ] **Websockets** : notifications temps réel quand une chaise démarre/s'arrête
- [ ] **Gestion des erreurs** : réponses d'erreur standardisées dans l'API
- [ ] **Logs** : historique des actions admin (corrections, créations)

### Priorité 4 — Refactoring Frontend

- [ ] Remplacer les appels `fetch('/api/...')` Next.js par des appels vers `http://localhost:3001` (NestJS)
- [ ] Changer le port NestJS à `3001` pour éviter le conflit avec Next.js (port 3000)
- [ ] Centraliser la config de l'URL de l'API dans une variable d'environnement

### Priorité 5 — Déploiement

- [ ] Dockeriser les deux services (`web/` et `backend/`)
- [ ] Fichier `docker-compose.yml` à la racine
- [ ] CI/CD pipeline

---

## Résumé Rapide

| Partie | État |
|--------|------|
| Frontend Next.js | Fonctionnel — logique métier complète |
| API Routes (Next.js) | Fonctionnel — à migrer vers NestJS |
| Backend NestJS | Vide — à construire |
| Base de données Supabase | Opérationnelle |
| Intégration Shelly IoT | Fonctionnelle côté frontend |
| Authentification | Fonctionnelle (Supabase Auth) |
| Export Excel | Fonctionnel |
| Déploiement | Non fait |

---

*Rapport généré le 2026-06-03*
