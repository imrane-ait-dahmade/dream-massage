# Prime Calculation — Dream Care

Technical reference for how shift prime/commission is computed.

---

## Definitions

### finalAmount

The billable amount for one session, resolved in this order:

```
finalAmount = correctedAmount   (if not null — owner override)
            ?? expectedAmount   (original machine-computed price)
            ?? 0                (safety fallback)
```

### grossRevenue

Sum of `finalAmount` for all **COMPLETED** sessions in the shift.

```
grossRevenue = Σ finalAmount  (status = COMPLETED)
```

ACTIVE sessions are **not counted**. CANCELLED sessions are **not counted**. PENDING sessions (anomaly, not yet corrected) **are counted** at their `expectedAmount` — they represent revenue the chair earned even if billing is uncertain.

---

## planCommission

The sum of per-session commissions earned by the staff member from their session activity.

### Session eligibility for commission

A session contributes commission only when ALL of the following are true:

| Check | Rule |
|---|---|
| `status` | `COMPLETED` |
| `finalAmount` | `> 0` |
| `billingStatus` | `CALCULATED` or `CORRECTED` |
| `anomalyType` | Does NOT contain `TOO_SHORT` |
| `matchedPlanId` | Not null |
| `CommissionRule` | Active rule exists for this plan, valid at `session.startedAt` |

**TOO_SHORT sessions** (`expectedAmount = 0`) never generate commission — they're excluded by both the zero-amount check and the TOO_SHORT anomaly check.

**TOO_LONG sessions with ANOMALY policy** have `billingStatus = PENDING` so they're excluded from commission until the owner corrects them (`billingStatus → CORRECTED`).

### Commission rule types

| CommissionType | Formula |
|---|---|
| `PERCENTAGE` | `finalAmount × (value / 100)`, rounded to 2 dp |
| `FIXED_AMOUNT` | `value` MAD per eligible session |

**Rule validity**: A `CommissionRule` is valid for session S when:
- `isActive = true`
- `validFrom ≤ session.startedAt`
- `validTo IS NULL OR validTo > session.startedAt`

If multiple rules satisfy validity (overlapping date ranges), the one with the highest `validFrom` is used.

### Example

```
Plan 30 min, price 30 MAD
CommissionRule: PERCENTAGE, value = 10
---
Session A: finalAmount = 30 MAD → commission = 30 × 10 / 100 = 3.00 MAD
Session B: correctedAmount = 25 MAD → commission = 25 × 10 / 100 = 2.50 MAD
Session C: billingStatus = PENDING (TOO_LONG) → commission = 0 MAD
Session D: anomalyType = TOO_SHORT → commission = 0 MAD

planCommission = 3.00 + 2.50 = 5.50 MAD
```

---

## targetBonus

A one-time bonus paid when the shift's `grossRevenue` meets a threshold.

### Rule selection

All active `ShiftTargetBonusRule` records for the shift's `shiftType` are evaluated. The single rule with the **highest `targetAmount` that is still ≤ `grossRevenue`** wins.  Rules are **non-cumulative** — only one applies per shift.

**Rule validity**: A `ShiftTargetBonusRule` is valid for shift S when:
- `isActive = true`
- `validFrom ≤ shift.startedAt`
- `validTo IS NULL OR validTo > shift.startedAt`

If no `shiftTypeId` is assigned to the shift, `targetBonus = 0`.

### Seeded defaults

| Shift type | Threshold | Bonus |
|---|---|---|
| Matin | ≥ 500 MAD | 50 MAD |
| Soir | ≥ 1 000 MAD | 100 MAD |

### Examples

```
Matin shift, grossRevenue = 600 MAD
  → Matin rule matches (500 ≤ 600) → targetBonus = 50 MAD

Soir shift, grossRevenue = 1 100 MAD
  → Soir rule matches (1000 ≤ 1100) → targetBonus = 100 MAD
    (only the Soir/highest matching rule applies)

Any shift, grossRevenue = 300 MAD
  → No rule threshold reached → targetBonus = 0 MAD
```

---

## manualBonus

Discretionary amount added by the Owner/Admin.

Each addition is a `ShiftBonusAdjustment` row (permanent audit trail). The sum of all adjustments for the shift is the `manualBonus`. Negative amounts are valid (deduction).

```
manualBonus = Σ ShiftBonusAdjustment.amount  (for this shift)
```

---

## Final formulas

```
totalPrime = planCommission + targetBonus + manualBonus
netRevenue = grossRevenue - totalPrime
```

All intermediate calculations use `Prisma.Decimal` (decimal.js) to avoid floating-point money errors. Values are converted to `number` only when serialized to JSON.

---

## Full examples

### Example 1 — Matin shift, 500 MAD gross, 10% commission on 30-min plan

```
Sessions: 5 × 30-min sessions at 30 MAD each (all CALCULATED)

grossRevenue    = 5 × 30 = 150 MAD        ← 5 sessions × 30 MAD
planCommission  = 5 × (30 × 10%) = 15 MAD
targetBonus     = 50 MAD   (Matin: 500 ≥ 500 threshold... wait, 150 < 500)
                = 0 MAD    ← threshold not met
manualBonus     = 0 MAD
totalPrime      = 15 + 0 + 0 = 15 MAD
netRevenue      = 150 - 15 = 135 MAD
```

*(With 500 MAD gross — e.g. 25 sessions × 20 MAD)*:

```
grossRevenue    = 500 MAD
planCommission  = 25 × (20 × 10%) = 50 MAD
targetBonus     = 50 MAD   (Matin: 500 ≥ 500)
manualBonus     = 0 MAD
totalPrime      = 50 + 50 + 0 = 100 MAD
netRevenue      = 500 - 100 = 400 MAD
```

### Example 2 — Soir shift, 1 000 MAD gross, 10% commission on 30-min plan

```
grossRevenue    = 1 000 MAD
planCommission  ≈ 100 MAD   (10% of 1 000)
targetBonus     = 100 MAD   (Soir: 1 000 ≥ 1 000)
manualBonus     = 0 MAD
totalPrime      = 100 + 100 = 200 MAD
netRevenue      = 1 000 - 200 = 800 MAD
```

### Example 3 — Mixed anomalies

```
grossRevenue    = 80 MAD
  ├ Session A (30 min, CALCULATED)  → finalAmount=30, commission=3
  ├ Session B (TOO_LONG, PENDING)   → finalAmount=40, commission=0
  └ Session C (TOO_SHORT)           → finalAmount=0,  commission=0

planCommission  = 3 MAD
targetBonus     = 0 MAD   (80 < 500)
manualBonus     = 20 MAD  (manual adjustment added)
totalPrime      = 3 + 0 + 20 = 23 MAD
netRevenue      = 80 - 23 = 57 MAD
```

---

## Shift.expectedCash vs Shift.grossRevenue

| Field | Meaning |
|---|---|
| `expectedCash` | Cash the staff member is expected to hand over (= grossRevenue for cash-only business) |
| `grossRevenue` | Total revenue for prime calculation |
| `declaredCash` | What the staff member actually counted and declared |
| `differenceCash` | `declaredCash - expectedCash` (cash discrepancy) |

Currently both `expectedCash` and `grossRevenue` are set to the same computed value at recalculation time. In a future multi-payment scenario (cash + card), `expectedCash` might only count cash sessions while `grossRevenue` counts all.

**TODO**: Decide whether `differenceCash` compares `declaredCash` against `grossRevenue` (full revenue) or `netRevenue` (after prime) when implementing shift close.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/shifts/:id/prime-summary` | Read-only calculation (no DB write) |
| `POST` | `/api/shifts/:id/recalculate-prime` | Calculate and persist to Shift row |
| `POST` | `/api/shifts/:id/bonus-adjustments` | Add manual adjustment + recalculate |

---

## Implementation Status

- [x] `PrimeCalculationService.calculateShiftPrimeSummary()` — pure read
- [x] `ShiftService.recalculateAndSaveShiftPrimeSummary()` — calculate + persist
- [x] `ShiftService.addBonusAdjustment()` — add adjustment + recalculate
- [x] REST endpoints registered at `/api/shifts`
- [ ] Shift open/close (`shift.service.ts` full implementation — next step)
- [ ] Auto-recalculate on shift close
- [ ] Settings UI for commission rules and bonus rules
- [ ] Frontend `PrimeRevenueCard` connected to shift report data
