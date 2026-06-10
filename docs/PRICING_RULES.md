# Pricing Rules — dreamMassage MVP

## Overview

A single `PricingRule` row (where `isActive = true`) controls how every completed session is billed. Only one rule may be active at a time.

## Fields

| Field | Default | Description |
|---|---|---|
| `roundingMode` | `NEXT_PLAN` | How duration is mapped to a plan |
| `graceSeconds` | `120` | Seconds a session may exceed a plan and still be billed at that plan |
| `minimumBillableSeconds` | `180` | Sessions shorter than this are anomalies — not billed automatically |
| `minimumPlanId` | plan 20 min | Floor plan: a valid session is billed at least this plan |
| `overtimePolicy` | `ANOMALY` | Behavior when duration exceeds all plans + grace |
| `extraMinutePrice` | `null` | Price per extra minute (EXTRA_MINUTE policy — out of scope for MVP) |

## Algorithm (NEXT_PLAN)

Plans are sorted ascending by `durationSeconds`. Plans: 20 min (1200 s), 30 min (1800 s), 40 min (2400 s).

```
1. If durationSeconds < minimumBillableSeconds:
      → TOO_SHORT  (expectedAmount = 0, billingStatus = PENDING, matchedPlanId = null)

2. Find first plan where: durationSeconds <= plan.durationSeconds + graceSeconds
      → Matched plan

3. If matched plan.durationSeconds < minimumPlan.durationSeconds:
      → Use minimumPlan instead (floor)

4. If no plan matched (duration > lastPlan + grace):
      → TOO_LONG  — behavior depends on overtimePolicy (see below)
```

## Grace window examples

| Duration | Calculation | Result |
|---|---|---|
| 60 s | 60 < 180 (min billable) | TOO_SHORT — 0 MAD, PENDING |
| 120 s | 120 < 180 | TOO_SHORT — 0 MAD, PENDING |
| 180 s | 180 ≤ 1200 + 120 | Plan 20 min — 20 MAD, CALCULATED |
| 1170 s | 1170 ≤ 1320 | Plan 20 min — 20 MAD, CALCULATED |
| 1240 s | 1240 ≤ 1320 | Plan 20 min — 20 MAD, CALCULATED |
| 1320 s | 1320 ≤ 1320 | Plan 20 min — 20 MAD, CALCULATED |
| 1350 s | 1350 > 1320, 1350 ≤ 1920 | Plan 30 min — 30 MAD, CALCULATED |
| 1860 s | 1860 ≤ 1920 | Plan 30 min — 30 MAD, CALCULATED |
| 1980 s | 1980 > 1920, 1980 ≤ 2520 | Plan 40 min — 40 MAD, CALCULATED |
| 2520 s | 2520 ≤ 2520 | Plan 40 min — 40 MAD, CALCULATED |
| 2700 s | 2700 > 2520 → TOO_LONG | See overtimePolicy |

## TOO_LONG behavior

| `overtimePolicy` | `expectedAmount` | `billingStatus` | `anomalyType` |
|---|---|---|---|
| `ANOMALY` | last plan price | `PENDING` | `TOO_LONG` |
| `NEXT_PLAN` | last plan price | `CALCULATED` | `null` |
| `EXTRA_MINUTE` | last plan price | `PENDING` | `TOO_LONG` (safe fallback — not implemented) |

## billingStatus values

| Value | Meaning |
|---|---|
| `PENDING` | Requires manual review (TOO_SHORT, TOO_LONG with ANOMALY, no pricing data) |
| `CALCULATED` | Billed automatically — safe to include in revenue |
| `CORRECTED` | Amount was manually overridden by staff |
| `DISPUTED` | Contested — excluded from revenue |

## anomalyType (comma-separated, multiple allowed)

| Code | Set when |
|---|---|
| `TOO_SHORT` | `durationSeconds < minimumBillableSeconds` |
| `TOO_LONG` | Duration exceeds all plans + grace AND `overtimePolicy = ANOMALY` |
| `NO_OPEN_SHIFT` | Session started while no shift was open |

Multiple anomalies are joined: e.g. `NO_OPEN_SHIFT,TOO_SHORT`.

## pricingSnapshot

Every session stores a `pricingSnapshot` JSON capturing the rule state at billing time:

```json
{
  "ruleId": "...",
  "roundingMode": "NEXT_PLAN",
  "graceSeconds": 120,
  "minimumBillableSeconds": 180,
  "overtimePolicy": "ANOMALY",
  "durationSeconds": 1240,
  "reason": "NORMAL",
  "matchedPlanId": "...",
  "matchedPlanName": "20 minutes",
  "matchedPlanDurationSeconds": 1200,
  "matchedPlanPrice": 20,
  "plans": [...]
}
```

`reason` is one of: `NORMAL`, `TOO_SHORT`, `TOO_LONG`.

## Revenue calculation

Dashboard revenue sums `expectedAmount` for sessions where:
- `billingStatus = CALCULATED` OR `billingStatus = CORRECTED`
- `correctedAmount ?? expectedAmount` is used as the effective amount

Sessions with `billingStatus = PENDING` (TOO_SHORT, TOO_LONG anomalies) are **excluded** from automatic revenue — their `expectedAmount` is 0 (TOO_SHORT) or the last plan price (TOO_LONG, for manual review).

## Editing the rule

`PATCH /api/settings/pricing/rule` accepts any subset of:

```json
{
  "roundingMode": "NEXT_PLAN",
  "graceSeconds": 120,
  "minimumBillableSeconds": 180,
  "minimumPlanId": "<uuid>",
  "overtimePolicy": "ANOMALY",
  "extraMinutePrice": null
}
```

Validation:
- `graceSeconds` ≥ 0
- `minimumBillableSeconds` ≥ 0
- `minimumPlanId` must be a valid UUID or null
- Invalid values return `400` with a JSON error

Old sessions are **never recalculated** — they keep their `pricingSnapshot` unchanged.
