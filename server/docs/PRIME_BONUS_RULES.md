# Prime & Bonus System — Dream Care

Documentation for the prime/commission system for staff shifts.

---

## Concepts

### grossRevenue

Sum of the final billable amount for every **COMPLETED** session linked to the shift.

```
finalAmount = correctedAmount  (if not null and > 0)
            ?? expectedAmount  (fallback)
```

Sessions are excluded from `grossRevenue` when:
- `status != COMPLETED`
- `finalAmount == 0` (e.g., TOO_SHORT sessions where `expectedAmount = 0`)
- `billingStatus == PENDING` with `anomalyType` containing `TOO_SHORT`

`grossRevenue = sum(finalAmount) for all eligible sessions`

---

### planCommission

Commission earned by the staff member based on the pricing plan used in each session.

**Two rule types:**

| CommissionType | Formula |
|---|---|
| `PERCENTAGE` | `finalAmount × (value / 100)` |
| `FIXED_AMOUNT` | `value` DH per eligible session |

**Example (30-minute plan, PERCENTAGE=10%):**

| Session | finalAmount | commission |
|---|---|---|
| Session A — 30 min | 30 MAD | 3 MAD |
| Session B — 30 min, correctedAmount=25 | 25 MAD | 2.50 MAD |
| Session C — 20 min (different plan) | 20 MAD | 0 MAD (no rule for 20-min plan) |

`planCommission = 3 + 2.50 = 5.50 MAD`

**Eligibility rules:**

A session generates commission only when ALL of the following are true:
1. `status == COMPLETED`
2. `finalAmount > 0`
3. `matchedPlanId` is not null
4. An **active** `CommissionRule` exists for that `matchedPlanId` where `validFrom <= session.endedAt AND (validTo IS NULL OR validTo >= session.endedAt)`
5. The session is NOT a TOO_SHORT anomaly (`expectedAmount > 0` or `correctedAmount > 0`)

**PENDING sessions (TOO_LONG, uncorrected):** excluded from commission until corrected. The `primeSnapshot` locks in the values at shift close — re-calculation after correction requires manual `manualBonus` adjustment.

---

### targetBonus

A one-time bonus added to the shift if `grossRevenue` reaches a configured threshold.

**Rule selection:** The system evaluates all **active** `ShiftTargetBonusRule` records for the shift's `shiftTypeId`. It picks the **single rule with the highest `targetAmount` that is still ≤ grossRevenue**. Only one rule applies — they are **not cumulative**.

**Default seeded rules:**

| Shift type | targetAmount | bonusAmount |
|---|---|---|
| Matin | ≥ 500 MAD | 50 MAD |
| Soir | ≥ 1000 MAD | 100 MAD |

**Example (Soir shift, grossRevenue = 1 200 MAD):**
- Soir rule (≥1000) → matches → targetBonus = 100 MAD
- Only the Soir rule applies even if a lower-threshold Matin rule also matched.

**Example (Matin shift, grossRevenue = 600 MAD):**
- Only Matin rule exists for this shift type → targetBonus = 50 MAD

**Example (any shift, grossRevenue = 300 MAD):**
- No rule threshold reached → targetBonus = 0 MAD

`targetBonus` is 0 when:
- No `shiftTypeId` is assigned to the shift
- No active `ShiftTargetBonusRule` exists for the shift type
- `grossRevenue` is below all configured thresholds

---

### manualBonus

An optional discretionary amount added by the Owner/Admin.

Each addition is stored as a `ShiftBonusAdjustment` row (permanent audit trail).  
At shift close, `manualBonus = sum(ShiftBonusAdjustment.amount for this shift)`.  
The value can be negative (to represent a deduction).

---

### totalPrime

```
totalPrime = planCommission + targetBonus + manualBonus
```

This is the total amount paid to the staff member for the shift, on top of their base salary.

---

### netRevenue

```
netRevenue = grossRevenue - totalPrime
```

What the business keeps after paying commission and bonuses.  
Stored on `Shift` for fast reporting. Computed from `grossRevenue` and `totalPrime` at shift close.

---

## Calculation Flow (shift close)

```
1. Query all COMPLETED sessions for shift
2. For each eligible session:
   a. finalAmount = correctedAmount ?? expectedAmount
   b. Skip if finalAmount == 0
   c. Lookup active CommissionRule for session.matchedPlanId at session.endedAt
   d. Apply PERCENTAGE or FIXED_AMOUNT formula
   e. Add to planCommission total
3. grossRevenue = sum(finalAmount for all eligible sessions)
4. Find ShiftTargetBonusRule for shift.shiftTypeId:
   - filter: isActive=true, targetAmount <= grossRevenue
   - order by targetAmount DESC
   - take first → targetBonus = rule.bonusAmount (or 0 if none)
5. manualBonus = sum(ShiftBonusAdjustment.amount for shift)
6. totalPrime = planCommission + targetBonus + manualBonus
7. netRevenue = grossRevenue - totalPrime
8. Write to Shift: grossRevenue, planCommission, targetBonus, manualBonus, totalPrime, netRevenue
9. Write primeSnapshot JSON (rules used, timestamp)
```

The `primeSnapshot` JSON locks in the exact rules and values used at calculation time. This ensures historical reports remain accurate even after rules are changed.

---

## Models

### ShiftType

Named shift template used to select the correct bonus rule.

| Field | Type | Description |
|---|---|---|
| name | String (unique) | Machine name: `matin`, `soir`, `journee` |
| label | String? | Display name: Matin, Soir, Journée |
| startTime | String | HH:mm e.g. `10:00` |
| endTime | String | HH:mm e.g. `15:00` |

### CommissionRule

| Field | Type | Description |
|---|---|---|
| pricingPlanId | FK → PricingPlan | Which plan this rule applies to |
| type | PERCENTAGE \| FIXED_AMOUNT | Calculation method |
| value | Decimal(8,4) | Rate (%) or fixed DH amount |
| isActive | Boolean | Only active rules are used in calculations |
| validFrom | DateTime | Rule start (default: creation time) |
| validTo | DateTime? | Rule end (null = still valid) |

### ShiftTargetBonusRule

| Field | Type | Description |
|---|---|---|
| shiftTypeId | FK → ShiftType | Which shift type this bonus applies to |
| targetAmount | Decimal(10,2) | Minimum grossRevenue to trigger bonus |
| bonusAmount | Decimal(10,2) | Amount paid when threshold is reached |
| isActive | Boolean | Only active rules are evaluated |

### ShiftBonusAdjustment

| Field | Type | Description |
|---|---|---|
| shiftId | FK → Shift | Which shift this adjustment belongs to |
| amount | Decimal(10,2) | Amount (positive = bonus, negative = deduction) |
| reason | Text? | Optional explanation for audit trail |

---

## Seeded Defaults

| Record | Values | isActive |
|---|---|---|
| ShiftType Matin | 10:00–15:00 | true |
| ShiftType Soir | 15:00–22:00 | true |
| ShiftType Journée | 10:00–22:00 | true |
| ShiftTargetBonusRule Matin | target=500, bonus=50 MAD | true |
| ShiftTargetBonusRule Soir | target=1000, bonus=100 MAD | true |
| CommissionRule (30-min plan, 10%) | example only | **false** |

The commission rule is seeded **inactive**. The owner must review the rate and activate it from Settings → Primes before it takes effect.

---

## Implementation Status

- [x] Schema: `ShiftType`, `CommissionRule`, `ShiftTargetBonusRule`, `ShiftBonusAdjustment` models
- [x] Schema: `Shift` extended with `shiftTypeId` + prime snapshot fields
- [x] Schema: `CommissionType` enum (`PERCENTAGE`, `FIXED_AMOUNT`)
- [x] Seed: shift types, bonus rules, example commission rule
- [ ] `prime.service.ts` — calculation service (next step)
- [ ] `shift.service.ts` — shift open/close (calls prime service at close)
- [ ] Settings endpoints for commission and bonus rules
- [ ] Frontend: Settings → Primes tab
- [ ] Frontend: PrimeRevenueCard connected to shift reports
