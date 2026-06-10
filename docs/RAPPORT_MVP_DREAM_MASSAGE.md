# Rapport Technique — MVP Dream Massage

**Projet :** Dream Massage — Gestion de cabine de fauteuils massants  
**Version :** MVP (Phase 1)  
**Date :** Juin 2026  
**Auteur :** Équipe de développement Dream Massage

---

## Table des matières

1. [Présentation du projet](#1-présentation-du-projet)
2. [Architecture générale](#2-architecture-générale)
3. [Structure des dossiers](#3-structure-des-dossiers)
4. [Base de données](#4-base-de-données)
5. [Modèles de données détaillés](#5-modèles-de-données-détaillés)
6. [Énumérations](#6-énumérations)
7. [Backend — serveur temps réel](#7-backend--serveur-temps-réel)
8. [Intégration Shelly Cloud](#8-intégration-shelly-cloud)
9. [Machine à états des fauteuils](#9-machine-à-états-des-fauteuils)
10. [Calcul de prix](#10-calcul-de-prix)
11. [Système temps réel](#11-système-temps-réel)
12. [API REST](#12-api-rest)
13. [Frontend — tableau de bord](#13-frontend--tableau-de-bord)
14. [Composants de l'interface](#14-composants-de-linterface)
15. [Sécurité](#15-sécurité)
16. [Configuration de l'environnement](#16-configuration-de-lenvironnement)
17. [Mode simulation](#17-mode-simulation)
18. [Gestion des erreurs et résilience](#18-gestion-des-erreurs-et-résilience)
19. [Fonctionnalités prévues, non encore implémentées](#19-fonctionnalités-prévues-non-encore-implémentées)
20. [Dépendances principales](#20-dépendances-principales)
21. [Démarrage du projet](#21-démarrage-du-projet)

---

## 1. Présentation du projet

Dream Massage est une application de gestion pour une cabine de fauteuils massants. La boutique dispose de **cinq fauteuils** (F1 à F5), chacun équipé d'une **prise Shelly connectée** (Shelly Cloud) qui mesure la consommation électrique en temps réel.

### Objectif principal

Détecter automatiquement quand un fauteuil est utilisé (démarrage et fin de session), calculer le montant à facturer, et afficher l'état de chaque fauteuil en temps réel sur un tableau de bord accessible sur mobile.

### Fonctionnement général

1. Chaque fauteuil est branché sur une prise Shelly qui mesure la consommation en watts.
2. Le serveur backend interroge Shelly Cloud pour obtenir les valeurs de puissance en direct.
3. Une machine à états analyse chaque lecture et détecte automatiquement le début et la fin d'une session de massage.
4. Les sessions terminées sont tarifées automatiquement selon un barème configurable.
5. Le tableau de bord frontend affiche en temps réel l'état de chaque fauteuil, les statistiques du jour et le quart de travail en cours.

---

## 2. Architecture générale

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Shelly Cloud                                │
│              (API HTTP v2 — 5 prises connectées)                    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  HTTPS POST /v2/devices/api/get
                            │  (1 requête pour les 5 fauteuils)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Serveur backend (Node.js / Express)               │
│                          Port 4001                                  │
│                                                                     │
│  ┌──────────────────┐   ┌──────────────────┐   ┌─────────────────┐ │
│  │  shelly-sync.job │ → │ chair-state.     │ → │ dashboard.      │ │
│  │  (polling        │   │ service          │   │ service         │ │
│  │   toutes les     │   │ (machine à états)│   │ (lecture DB)    │ │
│  │   5 secondes)    │   └──────────────────┘   └────────┬────────┘ │
│  └──────────────────┘                                   │           │
│                                                          │ broadcast │
│  ┌──────────────────┐                          ┌────────▼────────┐ │
│  │   API REST        │                          │   Socket.IO     │ │
│  │  (Express routes) │                          │  (WebSocket)    │ │
│  └──────────────────┘                          └─────────────────┘ │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               PostgreSQL via Prisma ORM                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                            │  Socket.IO + REST
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Frontend (Next.js 16 / React 19)                   │
│                          Port 3000                                  │
│              Tableau de bord — mobile-first                         │
└─────────────────────────────────────────────────────────────────────┘
```

**Principe clé :** le frontend ne communique jamais directement avec Shelly Cloud. Toutes les lectures de puissance passent par le serveur backend, qui est le seul à posséder les clés d'authentification Shelly.

---

## 3. Structure des dossiers

```
dreamMassage/
├── server/                 ← Serveur backend Node.js / Express
│   ├── config/             ← Configuration (env, CORS)
│   ├── jobs/               ← Tâches de fond (polling Shelly, simulation, diffusion)
│   ├── modules/
│   │   ├── chairs/         ← Machine à états et types de fauteuil
│   │   ├── dashboard/      ← Lecture d'état et contrat de données
│   │   ├── pricing/        ← Calcul de tarification
│   │   ├── shelly/         ← Client HTTP Shelly Cloud
│   │   └── shifts/         ← Quarts de travail (stub — non implémenté)
│   ├── prisma/
│   │   ├── schema.prisma   ← Schéma de base de données
│   │   └── migrations/     ← Migrations SQL versionnées
│   ├── utils/              ← Logger, helpers temps
│   ├── socket.ts           ← Serveur Socket.IO
│   ├── index.ts            ← Point d'entrée, routes Express
│   └── .env                ← Variables d'environnement (jamais versionné)
│
├── web/                    ← Frontend Next.js 16
│   ├── src/
│   │   ├── app/            ← App Router Next.js (page.tsx, layout.tsx, globals.css)
│   │   ├── components/
│   │   │   └── dashboard/  ← Composants du tableau de bord
│   │   ├── hooks/          ← useDashboard (WebSocket + REST fallback)
│   │   └── lib/            ← Types TypeScript, client API, socket, helpers
│   ├── public/
│   │   └── feuteuille.jpg  ← Photo des fauteuils (ne pas renommer)
│   └── .env.local          ← Variables d'environnement frontend
│
├── backend/                ← Ancien dossier (ne pas supprimer, ne pas mélanger)
└── docs/                   ← Documentation
```

---

## 4. Base de données

**Moteur :** PostgreSQL  
**ORM :** Prisma v7 avec `@prisma/adapter-pg`  
**Convention monétaire :** tous les montants sont stockés en type `Decimal(10,2)` pour éviter les erreurs d'arrondi des nombres flottants.

### Schéma — 12 modèles

| Modèle | Table SQL | Rôle |
|---|---|---|
| `User` | `users` | Utilisateurs de l'application (propriétaire / admin) |
| `StaffMember` | `staff_members` | Employés physiques assignés aux quarts de travail |
| `Shift` | `shifts` | Quarts de travail (ouvert / fermé / contrôlé) |
| `Chair` | `chairs` | État live de chaque fauteuil |
| `ChairDetectionConfig` | `chair_detection_configs` | Seuils de détection de démarrage / arrêt |
| `PricingPlan` | `pricing_plans` | Barème de prix (durée → montant) |
| `PricingRule` | `pricing_rules` | Règle active de tarification (arrondi, délai de grâce) |
| `ChairSession` | `chair_sessions` | Sessions de massage détectées automatiquement |
| `ChairEvent` | `chair_events` | Journal d'audit des transitions d'état |
| `DeviceLog` | `device_logs` | Événements opérationnels des appareils |
| `AppSetting` | `app_settings` | Configuration dynamique clé-valeur |
| `SettingsAuditLog` | `settings_audit_logs` | Journal immuable des modifications de configuration |

### Index partiels (contraintes métier)

```sql
-- Une seule session ACTIVE par fauteuil à la fois
CREATE UNIQUE INDEX "unique_active_session_per_chair"
  ON "chair_sessions" ("chair_id") WHERE status = 'ACTIVE';

-- Une seule config de détection active par fauteuil
CREATE UNIQUE INDEX "unique_active_detection_config_per_chair"
  ON "chair_detection_configs" ("chair_id") WHERE is_active = true;

-- Une seule règle de tarification active à la fois
CREATE UNIQUE INDEX "unique_active_pricing_rule"
  ON "pricing_rules" (is_active) WHERE is_active = true;

-- Un seul quart de travail ouvert à la fois
CREATE UNIQUE INDEX "unique_open_shift"
  ON "shifts" (status) WHERE status = 'OPEN';
```

---

## 5. Modèles de données détaillés

### Modèle `Chair` — Fauteuil

Stocke à la fois l'état live (mis à jour à chaque lecture Shelly) et les horodatages de la machine à états (persistés pour reprendre correctement après un redémarrage du serveur).

| Champ | Type | Description |
|---|---|---|
| `id` | UUID | Identifiant unique |
| `name` | String | Nom court (F1–F5) |
| `displayName` | String? | Nom d'affichage optionnel |
| `shellyDeviceId` | String? | Identifiant de l'appareil Shelly Cloud |
| `status` | ChairStatus | État courant de la machine à états |
| `isOnline` | Boolean | Appareil joignable ou non |
| `isEnabled` | Boolean | Fauteuil actif dans le système |
| `currentPowerWatts` | Float? | Dernière puissance mesurée (W) |
| `currentSessionId` | String? | ID de la session ACTIVE en cours |
| `lastSyncedAt` | DateTime? | Dernier horodatage de lecture |
| `maybeActiveSince` | DateTime? | Début de la fenêtre de confirmation de démarrage |
| `maybeFinishedSince` | DateTime? | Début de la fenêtre de confirmation d'arrêt |
| `stateChangedAt` | DateTime? | Dernière transition d'état |
| `statusBeforeOffline` | ChairStatus? | État avant passage en OFFLINE |
| `offlineSince` | DateTime? | Début de la période hors ligne |
| `lastOnlineAt` | DateTime? | Dernière fois que l'appareil était joignable |

Les six champs d'horodatage de la machine à états (`maybeActiveSince`, `maybeFinishedSince`, etc.) permettent au serveur de **reprendre les fenêtres de confirmation en cours** après un redémarrage, sans perdre la progression.

### Modèle `ChairSession` — Session de massage

Représente une session détectée automatiquement. Contient six horodatages distincts pour tracer le cycle de vie complet de la détection à la facturation.

| Champ | Type | Description |
|---|---|---|
| `detectedStartAt` | DateTime? | Moment où la puissance a franchi le seuil |
| `confirmedStartAt` | DateTime? | Moment où la fenêtre de confirmation est écoulée |
| `startedAt` | DateTime? | Début officiel de la session (= detectedStartAt) |
| `lowPowerDetectedAt` | DateTime? | Moment où la puissance est tombée sous le seuil d'arrêt |
| `confirmedEndAt` | DateTime? | Moment de fin confirmée |
| `endedAt` | DateTime? | Fin officielle de la session (= lowPowerDetectedAt) |
| `durationSeconds` | Int? | Durée calculée en secondes |
| `expectedAmount` | Decimal? | Montant calculé (MAD) |
| `pricingSnapshot` | Json? | Instantané complet du barème au moment du calcul |
| `detectionSnapshot` | Json? | Configuration de détection utilisée |
| `anomalyType` | String? | Anomalie détectée (ex. : `NO_OPEN_SHIFT`) |
| `correctedByUserId` | String? | ID de l'utilisateur ayant corrigé la session |
| `correctedAt` | DateTime? | Date de la correction |

Les champs `pricingSnapshot` et `detectionSnapshot` sont des instantanés JSON immuables : même si les règles de tarification changent plus tard, l'historique reste fidèle aux conditions du moment.

### Modèle `ChairDetectionConfig` — Configuration de détection

| Champ | Valeur par défaut | Description |
|---|---|---|
| `startThresholdWatts` | 7 W | Puissance minimale pour déclencher une détection de démarrage |
| `stopThresholdWatts` | 5 W | Puissance en dessous de laquelle la fin est suspectée |
| `startConfirmSeconds` | 30 s | Durée de maintien requise pour confirmer le démarrage |
| `stopConfirmSeconds` | 180 s | Durée de maintien requise pour confirmer la fin |
| `baselinePowerWatts` | 2,1 W | Consommation de veille normale du fauteuil |

### Modèle `PricingPlan` — Barème de prix

Chaque plan associe une durée (en secondes) à un prix (en MAD). Exemple : 15 min → 30 DH, 30 min → 50 DH.

### Modèle `PricingRule` — Règle de tarification

| Champ | Description |
|---|---|
| `roundingMode` | Mode d'arrondi : `NEXT_PLAN` (plan suivant), `NEAREST_PLAN`, `EXACT_MINUTES` |
| `graceSeconds` | Délai de grâce en secondes (la session entre dans le plan si durée ≤ plan + grâce) |
| `overtimePolicy` | Comportement au-delà de tous les plans |
| `isActive` | Une seule règle active à la fois (garantie par index partiel) |

### Modèle `Shift` — Quart de travail

| Champ | Description |
|---|---|
| `staffMemberId` | Employé physique assigné |
| `openedByUserId` | Utilisateur ayant ouvert le quart |
| `closedByUserId` | Utilisateur ayant fermé le quart |
| `status` | `OPEN` / `CLOSED` / `REVIEWED` |
| `expectedCash` | Revenu attendu calculé automatiquement |
| `declaredCash` | Montant déclaré lors de la fermeture |
| `differenceCash` | Écart entre attendu et déclaré |

### Modèle `StaffMember` — Employé physique

Les employés physiques **ne se connectent pas** à l'application. Ils sont uniquement liés aux quarts de travail. Il n'y a pas de compte utilisateur pour les employés. Seuls les rôles `OWNER` et `ADMIN` ont accès à l'application.

### Modèle `ChairEvent` — Journal d'audit

Chaque transition d'état de la machine à états génère un événement `ChairEvent` avec les champs `fromStatus`, `toStatus`, `powerWatts` et `eventType`. Cela permet de reconstruire l'historique complet d'un fauteuil.

---

## 6. Énumérations

| Énumération | Valeurs |
|---|---|
| `UserRole` | `OWNER`, `ADMIN` |
| `ChairStatus` | `IDLE`, `MAYBE_ACTIVE`, `ACTIVE`, `MAYBE_FINISHED`, `OFFLINE`, `ERROR`, `MAINTENANCE` |
| `SessionStatus` | `ACTIVE`, `COMPLETED`, `UNCERTAIN`, `CANCELLED`, `ERROR` |
| `BillingStatus` | `PENDING`, `CALCULATED`, `CORRECTED`, `DISPUTED` |
| `RoundingMode` | `NEAREST_PLAN`, `NEXT_PLAN`, `EXACT_MINUTES` |
| `OvertimePolicy` | `NEXT_PLAN`, `EXTRA_MINUTE`, `ANOMALY` |
| `ShiftStatus` | `OPEN`, `CLOSED`, `REVIEWED` |
| `LogSeverity` | `INFO`, `WARNING`, `ERROR` |

---

## 7. Backend — serveur temps réel

**Technologie :** Node.js, Express 5, TypeScript, Prisma v7, Socket.IO  
**Port :** 4001

### Démarrage et arrêt

Au démarrage, le serveur :
1. Lit toutes les variables d'environnement et valide leur présence.
2. Configure Express avec CORS et le parser JSON.
3. Crée le serveur HTTP et y attache Socket.IO.
4. Lance le **job temps réel** (`startRealtimeJob`), qui tourne en boucle à intervalle régulier.
5. Écoute les signaux `SIGINT` / `SIGTERM` pour un arrêt propre.

```typescript
// Démarrage dans server/index.ts
httpServer.listen(env.PORT, () => {
  startRealtimeJob(io);
});
```

### Boucle principale (`mock-realtime.job.ts`)

La boucle s'exécute toutes les `SYNC_INTERVAL_MS` millisecondes (défaut : 1000 ms).

```
Chaque tick :
  ├─ Si SIMULATION_ENABLED=true  → processSimulationTick()
  ├─ Si Shelly configuré         → tryShellySyncTick() (throttlé à 5 s)
  │
  ├─ dashboardService.getState() ← lit la DB
  └─ io.emit('dashboard:update', state) ← diffuse à tous les clients
```

Le throttle Shelly (`SHELLY_POLL_INTERVAL_MS=5000`) évite de dépasser la limite de requêtes de l'API Shelly Cloud (HTTP 429).

---

## 8. Intégration Shelly Cloud

**Module :** `server/modules/shelly/shelly.service.ts`

### Principe

Le service Shelly envoie **une seule requête HTTP POST** à l'API Shelly Cloud pour récupérer l'état des cinq appareils simultanément. La clé d'authentification est placée dans le query-string de l'URL côté serveur — elle ne quitte jamais le processus backend.

```
POST https://<SHELLY_SERVER_URL>/v2/devices/api/get?auth_key=***
Body: { "ids": ["f1b457", "f1b3d3", ...], "select": ["status"] }
```

### Réponse Shelly

L'API renvoie un tableau JSON brut (non encapsulé). Chaque entrée contient :
- `id` : identifiant de l'appareil
- `online` : `0` ou `1` (pas un booléen)
- `status` : état de l'appareil

### Extraction de la puissance

Le service gère les appareils Gen1 et Gen2/3 de Shelly :

| Génération | Champ de puissance |
|---|---|
| Gen1 (Shelly Plug S) | `status.meters[0].power` |
| Gen2/3 (Shelly Plus/Pro) | `status['switch:0'].apower` ou `status['pm1:0'].apower` |

### Appareils configurés

| Fauteuil | ID Shelly (masqué) |
|---|---|
| F1 | f1b4*** |
| F2 | f1b3*** |
| F3 | 7c87*** |
| F4 | 7c87*** |
| F5 | 7c87*** |

---

## 9. Machine à états des fauteuils

**Module :** `server/modules/chairs/chair-state.service.ts`

### Diagramme d'états

```
                   puissance ≥ seuil_démarrage
         ┌─────────────────────────────────────────┐
         │                                         ▼
    ┌────┴─────┐    puissance ≥ seuil           ┌──────────────┐
    │   IDLE   │    ET durée ≥ startConfirm    │ MAYBE_ACTIVE │
    └──────────┘ ◄──────────────────────────── └──────────────┘
         ▲                                         │
         │                                         │ durée ≥ startConfirmSeconds
         │                                         ▼
         │                                    ┌────────┐
         │          session terminée          │ ACTIVE │
         │ ◄────────────────────────────────  └────────┘
         │                                         │
         │                                         │ puissance ≤ seuil_arrêt
         │                                         ▼
         │                                  ┌───────────────┐
         │  durée ≥ stopConfirmSeconds       │ MAYBE_FINISHED│
         └────────────────────────────────── └───────────────┘
                                                   │
                                                   │ puissance > seuil_arrêt
                                                   ▼
                                              ┌────────┐
                                              │ ACTIVE │ (rétabli)
                                              └────────┘

    Hors ligne : tout état → OFFLINE → rétabli à IDLE ou ACTIVE selon DB
```

### Description des transitions

| Transition | Déclencheur | Action |
|---|---|---|
| `IDLE → MAYBE_ACTIVE` | Puissance ≥ `startThresholdWatts` | Enregistre `maybeActiveSince` |
| `MAYBE_ACTIVE → IDLE` | Puissance retombe | Annule la détection |
| `MAYBE_ACTIVE → ACTIVE` | Durée ≥ `startConfirmSeconds` | Crée une `ChairSession` en base |
| `ACTIVE → MAYBE_FINISHED` | Puissance ≤ `stopThresholdWatts` | Enregistre `maybeFinishedSince` |
| `MAYBE_FINISHED → ACTIVE` | Puissance remonte | Annule la suspicion de fin |
| `MAYBE_FINISHED → IDLE` | Durée ≥ `stopConfirmSeconds` | Clôture la session, calcule le prix |
| `* → OFFLINE` | Appareil injoignable | Sauvegarde `statusBeforeOffline` |
| `OFFLINE → IDLE/ACTIVE` | Appareil joignable à nouveau | Reprend depuis l'état sauvegardé |

### Résilience aux redémarrages

Les champs `maybeActiveSince` et `maybeFinishedSince` sont persistés en base de données. Si le serveur redémarre pendant une fenêtre de confirmation, la machine à états reprend exactement là où elle s'est arrêtée, sans recommencer le compteur à zéro.

### Anomalie `NO_OPEN_SHIFT`

Si une session démarre sans quart de travail ouvert, le champ `anomalyType` de la session est positionné à `NO_OPEN_SHIFT`. La session est créée normalement mais sera signalée lors du bilan de quart.

---

## 10. Calcul de prix

**Module :** `server/modules/pricing/pricing.service.ts`

### Algorithme (mode `NEXT_PLAN`)

1. Récupérer la règle de tarification active et les plans actifs, triés par durée croissante.
2. Trouver le **premier plan** dont la durée satisfait : `durationSession ≤ durationPlan + graceSeconds`.
3. Si la session dépasse tous les plans, utiliser le plan le plus long.
4. Enregistrer un instantané JSON complet du barème dans `pricingSnapshot`.

### Exemple

Plans actifs : 15 min → 30 DH, 30 min → 50 DH (délai de grâce : 120 s)

| Durée de session | Plan appliqué | Montant |
|---|---|---|
| 14 min | 15 min | 30 DH |
| 16 min (hors grâce) | 30 min | 50 DH |
| 16 min 30 s (dans grâce) | 15 min | 30 DH |
| 45 min | 30 min (plus long) | 50 DH |

### Fallback

Si aucune règle ou aucun plan n'est configuré en base, le service retourne `expectedAmount = 0` avec un `pricingSnapshot` contenant `{ error: 'no_pricing_data' }`. Aucune exception n'est levée — la session est créée avec `billingStatus = PENDING`.

---

## 11. Système temps réel

### Architecture hybride WebSocket + REST

Le tableau de bord reçoit les mises à jour par deux canaux complémentaires :

| Canal | Rôle | Comportement |
|---|---|---|
| **Socket.IO (WebSocket)** | Transport principal | Diffuse `dashboard:update` à tous les clients connectés |
| **REST polling (fallback)** | Secours | Interroge `/api/dashboard/state` toutes les 10 secondes si le WebSocket est déconnecté |

**Principe de sécurité :** le WebSocket n'est **pas** la source de vérité. Il transporte uniquement les données lues depuis la base de données. La base de données est toujours la source de vérité.

### Événement diffusé

```json
{
  "serverTime": "2026-06-10T10:30:00.000Z",
  "connection": "live",
  "todayStats": {
    "expectedRevenue": 150,
    "sessionsCount": 5,
    "activeChairs": 2,
    "offlineChairs": 0
  },
  "openShift": {
    "id": "...",
    "staffMemberName": "Mohammed",
    "startedAt": "2026-06-10T09:00:00.000Z"
  },
  "chairs": [
    {
      "id": "...",
      "name": "F1",
      "displayName": null,
      "status": "ACTIVE",
      "powerWatts": 45.2,
      "isOnline": true,
      "sessionStartedAt": "2026-06-10T10:15:00.000Z",
      "elapsedSeconds": 900,
      "warning": null
    }
  ]
}
```

### CORS

La fonction `corsOriginFn` (dans `server/config/cors.ts`) permet :
- En développement : toute origine `http://localhost:*` (gère le cas où Next.js bascule sur le port 3001).
- En production : uniquement les origines listées dans `FRONTEND_ORIGIN`.

---

## 12. API REST

### Endpoints publics

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/health` | État du serveur (uptime, timestamp) |
| `GET` | `/api/dashboard/state` | État complet du tableau de bord (snapshot DB) |
| `GET` | `/api/shelly/config` | Vérification de la configuration Shelly (IDs masqués en dev) |
| `GET` | `/api/shelly/test` | Lecture live depuis Shelly Cloud (bloqué si simulation active) |

### Endpoints de développement (`NODE_ENV !== production`)

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/dev/source-status` | Source active (shelly / simulation / none) et derniers timestamps |
| `GET` | `/api/dev/simulation/status` | État du mode simulation |
| `POST` | `/api/dev/simulation/tick` | Déclenche manuellement un tick de simulation |
| `POST` | `/api/dev/chairs/:chairId/reading` | Injecte une lecture de puissance arbitraire dans la machine à états |

**Note :** il n'existe pas de routes `/api/shifts/*`. La gestion des quarts de travail n'est pas encore implémentée (voir section 19).

---

## 13. Frontend — tableau de bord

**Technologie :** Next.js 16.1.6, React 19.2.3, TypeScript, Tailwind CSS v4  
**Port :** 3000

### Stack frontend

| Technologie | Usage |
|---|---|
| **Next.js App Router** | Routage, Server Components, optimisation d'images |
| **Tailwind CSS v4** | Styles — configuration CSS uniquement (`@import "tailwindcss"`) |
| **Inter** (Google Fonts) | Police de caractères, variable `--font-inter` |
| **Socket.IO Client** | Réception des mises à jour temps réel |
| **lucide-react** | Icônes vectorielles |
| **next/image** | Affichage optimisé de la photo de fauteuil |

### Palette de couleurs

| Élément | Couleur |
|---|---|
| Fond général | `stone-50` (beige neutre chaud) |
| Cartes | `white` avec ombre et bordure `stone-100` |
| Fauteuil IDLE | Bordure et badge `emerald` |
| Fauteuil MAYBE_ACTIVE | `amber` avec animation pulse |
| Fauteuil ACTIVE | `blue` avec animation pulse |
| Fauteuil MAYBE_FINISHED | `orange` avec animation pulse |
| Fauteuil OFFLINE | `red` |
| Fauteuil MAINTENANCE | `stone` |

### Hook `useDashboard`

Le hook principal (`src/hooks/useDashboard.ts`) gère :
1. Une **requête REST initiale** au montage pour afficher les données immédiatement.
2. Une **connexion Socket.IO** pour recevoir les mises à jour temps réel.
3. Un **fallback REST** (polling toutes les 10 s) si le WebSocket se déconnecte.
4. Le statut de connexion (`connecting` / `connected` / `disconnected`) affiché dans le header.

### Minuterie locale des sessions actives

Pour chaque fauteuil `ACTIVE` ou `MAYBE_FINISHED`, une minuterie tourne localement dans le composant `ChairCard` :

```typescript
useEffect(() => {
  if (!isRunning || sessionStartedAtMs === null) return;
  const id = setInterval(() => {
    setDisplayElapsed(Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000)));
  }, 1000);
  return () => clearInterval(id);
}, [isRunning, sessionStartedAtMs]);
```

`Date.now()` est appelé dans le callback `setInterval`, jamais dans le corps du rendu, ce qui respecte la règle ESLint `react-hooks/purity` de Next.js 16.

---

## 14. Composants de l'interface

### Structure des composants

```
src/app/page.tsx              ← Page principale (DashboardPage)
src/components/dashboard/
  ├── ChairCard.tsx           ← Carte d'un fauteuil (état, puissance, timer)
  ├── ChairCardSkeleton.tsx   ← Squelette de chargement
  ├── TodayStats.tsx          ← Statistiques du jour (revenu, sessions, fauteuils actifs)
  ├── ShiftSummary.tsx        ← Résumé du quart de travail en cours
  └── ConnectionStatus.tsx    ← Bandeau de statut de connexion (mode récupération)
src/lib/
  ├── types.ts                ← Types TypeScript partagés
  ├── api.ts                  ← Client REST
  ├── socket.ts               ← Création de la connexion Socket.IO
  ├── status.ts               ← Labels et styles de statut
  └── format.ts               ← Formatage DH, durées, heures
```

### Description des composants

**`ChairCard`** : carte principale affichant pour chaque fauteuil :
- Badge de statut coloré avec point animé pour les états transitoires
- Nom du fauteuil et photo (`/public/feuteuille.jpg`)
- Puissance en watts et indicateur En ligne / Hors ligne
- Minuterie en temps réel pour les sessions actives
- Message d'avertissement si applicable

**`TodayStats`** : grille de 4 métriques du jour :
- Revenu attendu (en DH)
- Nombre de sessions
- Nombre de fauteuils actifs
- Nombre de fauteuils hors ligne

**`ShiftSummary`** : affiche le nom de l'employé et l'heure d'ouverture du quart. Si aucun quart n'est ouvert, affiche un bandeau d'avertissement orange.

**`ConnectionStatus`** : bandeau rouge "Mode récupération — mise à jour toutes les 10 s" affiché sous le header quand la connexion WebSocket est perdue.

**`LoadingScreen`** : page de chargement avec squelettes animés affichée avant la première réponse de l'API.

---

## 15. Sécurité

### Clés d'authentification Shelly

- `SHELLY_AUTH_KEY` est définie **uniquement** dans `server/.env`.
- Elle n'est jamais incluse dans les réponses d'API, les logs ou le code frontend.
- Le commentaire au sommet de `shelly.service.ts` rappelle explicitement cette contrainte.
- `GET /api/shelly/config` retourne uniquement un booléen `authKeyConfigured` et des IDs masqués en développement.

### Séparation frontend / backend Shelly

Le frontend ne connaît pas l'URL Shelly ni les identifiants d'appareils. Il ne communique qu'avec `NEXT_PUBLIC_API_URL` (backend) et `NEXT_PUBLIC_SOCKET_URL` (Socket.IO).

### Préfixe `NEXT_PUBLIC_`

Les variables d'environnement préfixées `NEXT_PUBLIC_` sont intégrées dans le bundle JavaScript envoyé au navigateur. **Seules les valeurs publiquement sûres utilisent ce préfixe.** Les clés Shelly et l'URL de la base de données ne l'utilisent jamais.

### CORS

En développement, tout `localhost:*` est autorisé pour faciliter le développement (le serveur de développement Next.js peut basculer sur le port 3001 si le port 3000 est occupé). En production, seule l'origine `FRONTEND_ORIGIN` est autorisée.

---

## 16. Configuration de l'environnement

### Variables `server/.env`

| Variable | Description | Exemple |
|---|---|---|
| `PORT` | Port du serveur backend | `4001` |
| `NODE_ENV` | Environnement | `development` |
| `DATABASE_URL` | URL de connexion PostgreSQL | `postgresql://...` |
| `FRONTEND_ORIGIN` | Origine autorisée pour CORS | `http://localhost:3000` |
| `SYNC_INTERVAL_MS` | Intervalle de la boucle temps réel | `1000` |
| `SHELLY_POLL_INTERVAL_MS` | Throttle des appels Shelly Cloud | `5000` |
| `SHELLY_AUTH_KEY` | Clé d'API Shelly (secrète) | `***` |
| `SHELLY_SERVER_URL` | Serveur Shelly Cloud régional | `shelly-165-eu.shelly.cloud` |
| `SHELLY_DEVICE_F1`–`F5` | IDs des 5 appareils Shelly | `f1b457` |
| `SIMULATION_ENABLED` | Active le mode simulation | `false` |
| `SIMULATION_FAST_MODE` | Réduit les délais de confirmation | `false` |
| `APP_TIMEZONE` | Fuseau horaire de l'application | `Africa/Casablanca` |

### Variables `web/.env.local`

| Variable | Description | Valeur |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | URL du backend | `http://localhost:4001` |
| `NEXT_PUBLIC_SOCKET_URL` | URL Socket.IO | `http://localhost:4001` |

---

## 17. Mode simulation

Le mode simulation permet de tester la machine à états sans connexion à Shelly Cloud.

### Activation

```
SIMULATION_ENABLED=true
SIMULATION_FAST_MODE=true   # Réduit startConfirmSeconds à 5 s et stopConfirmSeconds à 10 s
```

### Fonctionnement

Quand `SIMULATION_ENABLED=true`, le job temps réel appelle `processSimulationTick()` au lieu du polling Shelly. La simulation génère des lectures de puissance synthétiques selon des patterns distincts pour chaque fauteuil (F1–F5), qui passent par la même machine à états que les données réelles.

**Important :** la simulation ne doit jamais être activée en production. Elle est réservée au développement et aux tests.

---

## 18. Gestion des erreurs et résilience

### Erreurs Shelly Cloud

- Les erreurs réseau répétées ne sont loguées qu'une fois puis toutes les 5 fois (`MAX_CONSECUTIVE_LOG = 5`) pour éviter de noyer les logs.
- En cas d'échec, le serveur continue de diffuser l'état actuel de la base de données (aucun crash).

### Indisponibilité de la base de données

Si `dashboardService.getState()` échoue (base de données inaccessible), le service retourne un état vide structurellement valide (`DashboardState` avec des chiffres à zéro et un tableau de fauteuils vide) plutôt que de faire planter la boucle de diffusion.

### Redémarrage du serveur

- Les fenêtres de confirmation en cours (`maybeActiveSince`, `maybeFinishedSince`) sont persistées en base de données.
- Au redémarrage, la machine à états relit ces champs et reprend exactement là où elle s'était arrêtée.
- Les sessions ACTIVE existantes sont reconnectées au fauteuil correspondant lors de la reprise depuis OFFLINE.

### Déconnexion du frontend

Si le WebSocket se déconnecte, le hook `useDashboard` bascule automatiquement sur un polling REST toutes les 10 secondes. L'interface affiche un bandeau "Mode récupération" pour informer l'utilisateur.

### Arrêt propre du serveur

Le serveur intercepte `SIGINT` et `SIGTERM` pour :
1. Arrêter la boucle temps réel.
2. Fermer le serveur HTTP proprement.
3. Forcer la sortie après 5 secondes si la fermeture s'éternise.

---

## 19. Fonctionnalités prévues, non encore implémentées

Les éléments suivants sont **modélisés en base de données** (tables et relations créées, types Prisma générés) mais **non implémentés côté backend** dans le MVP actuel.

### Gestion des quarts de travail (Shift API)

| Fichier | État |
|---|---|
| `server/modules/shifts/shift.service.ts` | Stub — contient uniquement `export {}` |
| `server/modules/shifts/shift.controller.ts` | Stub — contient uniquement `export {}` |

**Aucune route `/api/shifts/*` n'est enregistrée dans `server/index.ts`.**

Les routes prévues (non implémentées) :
- `POST /api/shifts/open` — ouvrir un quart de travail
- `POST /api/shifts/:id/close` — fermer un quart avec déclaration de caisse
- `GET /api/shifts` — lister les quarts

Le champ `openShift` du tableau de bord affiche correctement le quart ouvert s'il est créé directement en base de données, mais l'interface de gestion des quarts (ouvrir, fermer, déclarer) n'existe pas encore.

### Authentification utilisateur

Aucun système de connexion n'est implémenté. Les routes de gestion des quarts et des corrections de sessions nécessiteront une authentification JWT (`UserRole.OWNER` ou `UserRole.ADMIN`).

### Correction manuelle des sessions

Le modèle `ChairSession` inclut les champs `correctedByUserId`, `correctedAt` et `correctedAmount` pour permettre une correction manuelle du montant facturé. Aucune route de correction n'est encore implémentée.

### Bilan de quart et réconciliation de caisse

Le modèle `Shift` contient les champs `expectedCash`, `declaredCash` et `differenceCash`. Le calcul automatique du revenu attendu et la comparaison avec le montant déclaré ne sont pas encore implémentés.

---

## 20. Dépendances principales

### Backend (`server/`)

| Paquet | Version | Usage |
|---|---|---|
| `express` | 5.x | Serveur HTTP et routage |
| `socket.io` | 4.x | WebSocket temps réel |
| `@prisma/client` | 7.x | ORM PostgreSQL |
| `@prisma/adapter-pg` | 7.x | Adaptateur PostgreSQL natif |
| `cors` | 2.x | Middleware CORS |
| `zod` | 3.x | Validation des variables d'environnement |
| `typescript` | 5.x | Compilateur TypeScript |
| `tsx` | — | Exécution TypeScript en développement |

### Frontend (`web/`)

| Paquet | Version | Usage |
|---|---|---|
| `next` | 16.1.6 | Framework React avec App Router et Turbopack |
| `react` | 19.2.3 | Bibliothèque UI |
| `socket.io-client` | 4.x | Connexion WebSocket vers le backend |
| `lucide-react` | — | Icônes vectorielles |
| `@tailwindcss/postcss` | 4.x | Tailwind CSS v4 (configuration CSS uniquement) |

---

## 21. Démarrage du projet

### Prérequis

- Node.js 20+
- PostgreSQL 14+
- Accès à un compte Shelly Cloud avec les 5 appareils configurés

### Démarrage du backend

```bash
cd server
npm install
# Configurer server/.env avec toutes les variables requises
npx prisma migrate deploy   # Appliquer les migrations
npm run dev                 # Lance le serveur sur le port 4001
```

### Démarrage du frontend

```bash
cd web
npm install
# Vérifier web/.env.local (NEXT_PUBLIC_API_URL et NEXT_PUBLIC_SOCKET_URL)
npm run dev                 # Lance le tableau de bord sur le port 3000
```

### Vérification de l'installation

1. **Backend :** `GET http://localhost:4001/health` doit retourner `{ "ok": true }`.
2. **Configuration Shelly :** `GET http://localhost:4001/api/shelly/config` doit afficher `"authKeyConfigured": true` et `"deviceIdConfigured": true` pour les 5 fauteuils.
3. **Lecture Shelly live :** `GET http://localhost:4001/api/shelly/test` doit retourner les puissances en temps réel (avec `SIMULATION_ENABLED=false`).
4. **Dashboard :** ouvrir `http://localhost:3000` — les 5 fauteuils doivent apparaître avec leur état.

---

*Rapport généré le 10 juin 2026 — MVP Dream Massage*
