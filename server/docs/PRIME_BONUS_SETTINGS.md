# Prime & Bonus Settings — Dream Care

Settings API for managing commission rules, shift types, and target bonus rules.
All endpoints require authentication (`DREAM_CARE_AUTH` cookie or `Authorization: Bearer` header).

Base path: `/api/settings/prime`

---

## A. Shift Types

Shift types define the time windows used for target bonus calculation (e.g. Matin, Soir, Journée).

### GET /api/settings/prime/shift-types

Returns all shift types ordered by `sortOrder`.

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "matin",
      "label": "Matin",
      "startTime": "10:00",
      "endTime": "15:00",
      "isActive": true,
      "sortOrder": 1,
      "createdAt": "2026-06-08T12:00:00.000Z"
    }
  ]
}
```

### POST /api/settings/prime/shift-types

Creates a new shift type. Returns `409` if `name` already exists.

**Body**
```json
{
  "name": "nuit",
  "label": "Nuit",
  "startTime": "22:00",
  "endTime": "06:00",
  "isActive": true,
  "sortOrder": 4
}
```

| Field | Required | Rules |
|---|---|---|
| `name` | yes | max 50 chars, must be unique |
| `label` | no | max 100 chars |
| `startTime` | yes | `HH:mm` format |
| `endTime` | yes | `HH:mm` format |
| `isActive` | no | default `true` |
| `sortOrder` | no | non-negative integer, default `0` |

### PATCH /api/settings/prime/shift-types/:shiftTypeId

Updates any subset of mutable fields on an existing shift type (all fields optional).
Returns `404` if not found.

**Body** (all fields optional)
```json
{
  "label": "Nuit tardive",
  "isActive": false
}
```

---

## B. Commission Rules

Commission rules determine how much a staff member earns per eligible session, based on the session's pricing plan.

**Key rules:**
- Only one active commission rule per `pricingPlanId` at a time.
- Creating an active rule automatically deactivates all existing active rules for the same plan (`validTo = now`).
- Changing `type` or `value` via PATCH deactivates the old rule and creates a new version — preserving the historical audit trail.
- Changing only `isActive` via PATCH updates in place.

### GET /api/settings/prime/commission-rules

Returns all commission rules (active + historical) ordered by `isActive desc`, `validFrom desc`.

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "pricingPlanId": "uuid",
      "pricingPlanName": "30 min",
      "pricingPlanPrice": 30,
      "type": "PERCENTAGE",
      "value": 10,
      "isActive": true,
      "validFrom": "2026-06-08T12:00:00.000Z",
      "validTo": null,
      "createdAt": "2026-06-08T12:00:00.000Z"
    }
  ]
}
```

### POST /api/settings/prime/commission-rules

Creates a new commission rule. If `isActive: true`, all existing active rules for the same `pricingPlanId` are deactivated first.

**Body**
```json
{
  "pricingPlanId": "uuid",
  "type": "PERCENTAGE",
  "value": 10,
  "isActive": true
}
```

| Field | Required | Rules |
|---|---|---|
| `pricingPlanId` | yes | must be a valid UUID, plan must exist |
| `type` | yes | `PERCENTAGE` or `FIXED_AMOUNT` |
| `value` | yes | ≥ 0; if `PERCENTAGE`, must be ≤ 100 |
| `isActive` | no | default `true` |

### PATCH /api/settings/prime/commission-rules/:ruleId

Updates a commission rule. Returns `404` if not found.

**Two-path behavior:**

| What changed | What happens |
|---|---|
| Only `isActive` | Update in place; if deactivating, sets `validTo = now` |
| `type` or `value` (with or without `isActive`) | Old rule deactivated (`validTo = now`), new rule created with new values |

**Body** (all fields optional)
```json
{
  "type": "FIXED_AMOUNT",
  "value": 5,
  "isActive": true
}
```

---

## C. Target Bonus Rules

Bonus rules define a one-time reward when a shift's `grossRevenue` meets a threshold.

**Key rules:**
- Non-cumulative: only the single rule with the **highest `targetAmount ≤ grossRevenue`** applies.
- Rules are scoped to a `shiftTypeId` — no `shiftType` on the shift means `targetBonus = 0`.
- Creating an active rule with the same `(shiftTypeId, targetAmount)` automatically deactivates the previous rule at that threshold.
- Changing `targetAmount` or `bonusAmount` via PATCH triggers deactivate+create (same audit pattern as commission rules).

### GET /api/settings/prime/target-bonus-rules

Returns all target bonus rules (active + historical) ordered by `isActive desc`, `targetAmount asc`.

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "shiftTypeId": "uuid",
      "shiftTypeLabel": "Matin",
      "targetAmount": 500,
      "bonusAmount": 50,
      "isActive": true,
      "validFrom": "2026-06-08T12:00:00.000Z",
      "validTo": null,
      "createdAt": "2026-06-08T12:00:00.000Z"
    }
  ]
}
```

### POST /api/settings/prime/target-bonus-rules

Creates a new target bonus rule. If `isActive: true`, any existing active rule for the same `(shiftTypeId, targetAmount)` is deactivated first.

**Body**
```json
{
  "shiftTypeId": "uuid",
  "targetAmount": 750,
  "bonusAmount": 75,
  "isActive": true
}
```

| Field | Required | Rules |
|---|---|---|
| `shiftTypeId` | yes | must be a valid UUID, shift type must exist |
| `targetAmount` | yes | positive number (MAD) |
| `bonusAmount` | yes | ≥ 0 (MAD) |
| `isActive` | no | default `true` |

### PATCH /api/settings/prime/target-bonus-rules/:ruleId

Updates a target bonus rule. Returns `404` if not found.

**Two-path behavior:**

| What changed | What happens |
|---|---|
| Only `isActive` | Update in place; if deactivating, sets `validTo = now` |
| `targetAmount` or `bonusAmount` | Old rule deactivated, new rule created |

**Body** (all fields optional)
```json
{
  "bonusAmount": 80
}
```

---

## D. Prime Settings Summary

### GET /api/settings/prime/summary

Returns a full snapshot of all prime-related configuration in a single call.
Useful for the frontend Settings → Primes tab to load everything in parallel.

**Response**
```json
{
  "shiftTypes": [ ... ],
  "pricingPlans": [
    {
      "id": "uuid",
      "name": "30 min",
      "durationSeconds": 1800,
      "priceAmount": 30,
      "currency": "MAD",
      "isActive": true,
      "sortOrder": 2
    }
  ],
  "commissionRules": [ ... ],
  "targetBonusRules": [ ... ],
  "defaults": {
    "commissionExample": "...",
    "targetBonusExample": "..."
  }
}
```

---

## Audit Trail

Every mutating operation (`POST`, `PATCH`) writes a `SettingsAuditLog` row with:
- `entityType`: `ShiftType`, `CommissionRule`, or `ShiftTargetBonusRule`
- `entityId`: the affected record's UUID
- `action`: `CREATE` or `UPDATE`
- `oldValue` / `newValue`: JSON snapshots of changed fields
- `userId`: from `req.user.id` (authenticated user), falling back to the first OWNER if unavailable

---

## Implementation Status

- [x] `prime-settings.types.ts` — Zod schemas for all 3 entity types
- [x] `prime-settings.service.ts` — all CRUD methods with deactivate+create patterns
- [x] `prime-settings.controller.ts` — 9 routes (GET/POST/PATCH × 3 entities + GET summary)
- [x] `settings.controller.ts` — sub-router mounted at `/prime`
- [ ] Frontend Settings → Primes tab (future session)
- [ ] Auto-recalculate shift prime on shift close (future session)
