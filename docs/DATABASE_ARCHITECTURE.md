# Database Architecture — Dream Massage

> **Stack:** PostgreSQL · Prisma ORM · NestJS backend  
> **Database name:** `dream_massage`  
> **Last updated:** 2026-06-08

---

## Table of Contents

1. [Business Context](#1-business-context)
2. [Why Power-Based Session Detection](#2-why-power-based-session-detection)
3. [Why Not Naive Threshold Logic](#3-why-not-naive-threshold-logic)
4. [Chair State Machine](#4-chair-state-machine)
5. [Table Reference](#5-table-reference)
6. [Pricing Calculation](#6-pricing-calculation)
7. [Why Snapshots Exist](#7-why-snapshots-exist)
8. [Cash Reconciliation](#8-cash-reconciliation)
9. [Important Constraints](#9-important-constraints)
10. [Future Optional Tables](#10-future-optional-tables)

---

## 1. Business Context

Dream Massage operates a shop with **5 massage chairs** named F1 through F5. Each chair is connected to a **Shelly smart relay** (Shelly Cloud) that measures real-time electrical power consumption in watts.

The business problem is straightforward: the owner needs to know when a chair is in use, for how long, and how much revenue that session should generate. Historically this was tracked manually, which led to missed sessions, disputed prices, and unreliable commission calculations.

The goal of this system is to make session tracking **fully automatic and auditable**:

- Sessions are opened and closed by the backend without human intervention.
- Every price is calculated deterministically from configurable rules.
- Every change to a price or configuration is logged permanently.
- Cash collected at the end of a shift can be reconciled against what the system expected.

The five chairs are the only physical assets tracked. Everything else in the schema exists to serve the reliable detection, pricing, and audit of sessions on those chairs.

---

## 2. Why Power-Based Session Detection

Massage chairs consume significantly more electrical power when running than when idle. The Shelly relay attached to each chair reports the current power draw (in watts) every few seconds via the Shelly Cloud API.

This makes power consumption a reliable, passive, and tamper-resistant signal:

- **No hardware modification required.** The Shelly device is installed at the power outlet; no changes to the chair itself.
- **No human action required.** Staff do not need to press a button, scan a card, or open an app. The session is detected automatically.
- **Cannot be forgotten or falsified.** A session that physically ran will always produce a power signature. A session that did not run will not.
- **Works across all chair models.** The threshold values in `chair_detection_configs` are configurable per chair, so different chair models with different idle/active power profiles are all supported.

The polling service reads the Shelly API on a configurable interval (stored in `app_settings` under key `shelly.pollIntervalSeconds`) and feeds each reading into the state machine described below.

---

## 3. Why Not Naive Threshold Logic

A simple approach might be:

```
if power > 7W → session is ON
if power < 7W → session is OFF
```

This fails in production for three reasons.

**Problem 1 — Motor mode changes cause false stops.**  
Massage chairs cycle through different massage programs. When transitioning between modes (e.g. from kneading to rolling), the motor briefly idles. Power drops below the stop threshold for a few seconds, then climbs back. Naive logic interprets this as: session ended, new session started. One real session becomes two or three artificial sessions, each priced separately — generating inflated revenue figures and confusing the customer.

**Problem 2 — Motor warm-up causes false starts.**  
When the relay closes and power is first applied, the chair's motor draws a brief startup spike before settling at its running power. Naive logic may trigger ACTIVE immediately on this spike, before the chair is actually in use.

**Problem 3 — No audit trail.**  
Naive logic produces a single boolean: on or off. There is no record of *when* the threshold was crossed, *how long* the power stayed there, or *which configuration values* were used. Disputes ("the chair ran for 25 minutes, why was I charged for 30?") cannot be investigated.

**The solution — debounce confirmation windows:**  
The state machine requires power to stay above the start threshold for `startConfirmSeconds` before opening a session, and to stay below the stop threshold for `stopConfirmSeconds` before closing one. Brief fluctuations during mode changes fall within these windows and are absorbed without generating false events.

All threshold values and window durations are stored in `chair_detection_configs` and are configurable per chair without a code deployment.

---

## 4. Chair State Machine

Each chair moves through a defined set of states. The current state is stored in `chairs.status` and transitions are driven by Shelly power readings on every poll cycle.

```
                     power > startThreshold
      ┌──────────────────────────────────────────────────┐
      │                                                  ▼
   IDLE                                           MAYBE_ACTIVE
      ▲                                                  │
      │                                  startConfirmSeconds elapsed
      │                                                  │
      │                                                  ▼
      │              power < stopThreshold            ACTIVE ─────────── session record open
      │         ┌──────────────────────────────────────  │
      │         ▼                                        │ power drops briefly (mode change)
      │   MAYBE_FINISHED                                 │ but recovers within stopConfirmSeconds
      │         │                                        │ → stays in ACTIVE, no false stop
      │  stopConfirmSeconds elapsed                      │
      │         │                                        │
      └─────────┘                                        │
   (session closed)                                      │

   OFFLINE ←── Shelly unreachable during poll
   ERROR   ←── Shelly returned unexpected/malformed payload
   MAINTENANCE ←── manually set by admin (chair taken out of service)
```

### State transition rules

| From | To | Condition |
|---|---|---|
| `IDLE` | `MAYBE_ACTIVE` | `currentPowerWatts > startThresholdWatts` |
| `MAYBE_ACTIVE` | `ACTIVE` | Power held above threshold for `startConfirmSeconds` |
| `MAYBE_ACTIVE` | `IDLE` | Power drops back below threshold before confirmation window expires |
| `ACTIVE` | `MAYBE_FINISHED` | `currentPowerWatts < stopThresholdWatts` |
| `MAYBE_FINISHED` | `IDLE` | Power held below threshold for `stopConfirmSeconds` → session closed |
| `MAYBE_FINISHED` | `ACTIVE` | Power recovers above threshold before confirmation window expires |
| any | `OFFLINE` | Shelly API call fails or times out |
| `OFFLINE` | previous state | Shelly API call succeeds again |
| any | `ERROR` | Shelly returns a response that cannot be parsed |
| any | `MAINTENANCE` | Admin sets chair to maintenance mode via UI |

### Timestamp fields on `chair_sessions`

Every transition relevant to the session lifecycle is recorded with a dedicated timestamp:

| Field | Meaning |
|---|---|
| `detected_start_at` | First poll where power exceeded `startThresholdWatts` |
| `confirmed_start_at` | `startConfirmSeconds` elapsed above threshold; state became ACTIVE |
| `started_at` | **Authoritative session open.** This is the timestamp used for duration and reporting. |
| `low_power_detected_at` | First poll where power dropped below `stopThresholdWatts` |
| `confirmed_end_at` | `stopConfirmSeconds` elapsed below threshold |
| `ended_at` | **Authoritative session close.** `duration_seconds` is computed from `started_at` to `ended_at`. |

---

## 5. Table Reference

### `users`

People who can log in to the system.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `email` | VARCHAR(150) | Unique — login identifier |
| `password_hash` | VARCHAR(255) | bcrypt digest; raw password never stored |
| `role` | `UserRole` enum | `OWNER`, `ADMIN`, or `ASSISTANT` |
| `is_active` | BOOLEAN | Soft-disable without deleting account |
| `last_login_at` | TIMESTAMP | Updated on every successful login |

**Roles:**
- `OWNER` — unrestricted access to all configuration, pricing, billing, and user management.
- `ADMIN` — manages daily operations: sessions, pricing, user accounts.
- `ASSISTANT` — read access plus the ability to submit manual session corrections.

---

### `chairs`

The 5 physical massage chairs connected to Shelly Cloud.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR(10) | Unique short label: `F1`, `F2`, … `F5` |
| `shelly_device_id` | VARCHAR(100) | Unique Shelly Cloud device identifier |
| `shelly_channel` | INTEGER | Relay channel on the device (default 0) |
| `status` | `ChairStatus` enum | Current state machine state |
| `is_online` | BOOLEAN | Whether the Shelly responded to the last poll |
| `current_power_watts` | DOUBLE PRECISION | Latest power reading from Shelly |
| `relay_is_on` | BOOLEAN | Whether the relay is currently closed (power applied) |
| `last_synced_at` | TIMESTAMP | Timestamp of the most recent successful poll |
| `current_session_id` | TEXT | Denormalized pointer to the open session, if any. **Not a FK.** Updated by the polling service as a fast lookup cache. The authoritative source of truth for "what session is active" is always `chair_sessions WHERE status = 'ACTIVE' AND chair_id = ?`. |
| `is_enabled` | BOOLEAN | Whether this chair participates in automatic detection |

The live-state columns (`status`, `is_online`, `current_power_watts`, `relay_is_on`, `last_synced_at`, `current_session_id`) are **overwritten on every poll** — they represent the current snapshot only. Historical values are in `session_events` and `device_logs`.

---

### `chair_detection_configs`

Power threshold configuration that drives automatic session detection. One row per chair, versioned.

| Column | Type | Notes |
|---|---|---|
| `chair_id` | UUID FK → `chairs` | Which chair this config applies to |
| `start_threshold_watts` | FLOAT | Power must **exceed** this to trigger `MAYBE_ACTIVE` (default: 7W) |
| `stop_threshold_watts` | FLOAT | Power must **drop below** this to trigger `MAYBE_FINISHED` (default: 5W) |
| `start_confirm_seconds` | INTEGER | How long power must stay above start threshold before state = ACTIVE (default: 30s) |
| `stop_confirm_seconds` | INTEGER | How long power must stay below stop threshold before session closes (default: 180s) |
| `activation_delay_seconds` | INTEGER | Grace period after relay power-on before detection begins; absorbs motor startup spike (default: 30s) |
| `baseline_power_watts` | FLOAT | Idle standby draw (informational; used by anomaly detection) |
| `is_active` | BOOLEAN | Whether this config is currently in use |
| `version` | INTEGER | Incremented when thresholds are changed |
| `valid_from` / `valid_to` | TIMESTAMP | Validity period — allows historical reconstruction |

**Only one config per chair should have `is_active = true` at any time.** When thresholds are changed, a new row is inserted and the old one's `valid_to` is set. This means any session can always be re-evaluated against the exact config that was in effect when it ran.

**Indexes:** `(chair_id, is_active)` — this is the most frequently executed query in the system (every poll cycle).

---

### `pricing_plans`

Individual price tiers. Each row maps one duration to one price.

| Column | Type | Notes |
|---|---|---|
| `name` | VARCHAR(100) | Human label, e.g. "30 minutes" |
| `duration_seconds` | INTEGER | Duration in seconds (not minutes — allows sub-minute precision if needed) |
| `price_amount` | DECIMAL(10,2) | Price in the configured currency |
| `currency` | VARCHAR(10) | Default `MAD` |
| `is_active` | BOOLEAN | Soft-retire without deleting historical references |
| `sort_order` | INTEGER | Controls display order in the admin UI |

Example data:

| name | duration_seconds | price_amount |
|---|---|---|
| 20 minutes | 1200 | 20.00 |
| 30 minutes | 1800 | 30.00 |
| 40 minutes | 2400 | 40.00 |

When a price changes (e.g. 30 minutes goes from 30 MAD to 35 MAD), the old plan is **soft-retired** (`is_active = false`) and a new row is inserted. Sessions that already reference the old plan keep their original price because `expected_amount` is stored directly on the session — they do not recompute from the plan.

---

### `pricing_rules`

The active ruleset that governs how a session duration is mapped to a plan. Only one row should have `is_active = true` at a time.

| Column | Type | Notes |
|---|---|---|
| `rounding_mode` | `RoundingMode` enum | How duration is snapped to a plan bucket |
| `grace_seconds` | INTEGER | Tolerance window before rounding is applied (default: 120s) |
| `minimum_plan_id` | UUID FK → `pricing_plans` | The cheapest plan ever assignable; prevents 0 MAD sessions |
| `overtime_policy` | `OvertimePolicy` enum | What happens when session exceeds the longest plan |
| `extra_minute_price` | DECIMAL(10,2) | Per-minute surcharge; used only when `overtime_policy = EXTRA_MINUTE` |

**`rounding_mode` values:**
- `NEAREST_PLAN` — round to the closest plan by duration (up or down)
- `NEXT_PLAN` — always round up to the next higher plan tier
- `EXACT_MINUTES` — no bucket rounding; charge is computed per minute

**`overtime_policy` values:**
- `NEXT_PLAN` — apply the next plan tier if one exists above the longest
- `EXTRA_MINUTE` — charge `extra_minute_price` for every minute past the longest plan
- `ANOMALY` — flag the session as an anomaly; do not auto-price; alert the admin

---

### `chair_sessions`

The core business record. One row per detected usage session.

| Column Group | Columns | Notes |
|---|---|---|
| Identity | `id`, `chair_id`, `shift_id` | `shift_id` is plain text until the `Shift` model is added |
| Lifecycle | `status` | `ACTIVE` → `COMPLETED` (or `UNCERTAIN` / `CANCELLED` / `ERROR`) |
| Start times | `detected_start_at`, `confirmed_start_at`, `started_at` | Full debounce trail |
| End times | `low_power_detected_at`, `confirmed_end_at`, `ended_at` | Full debounce trail |
| Duration | `duration_seconds` | Computed from `started_at` to `ended_at` at session close |
| Power stats | `start_power_watts`, `end_power_watts`, `min_power_watts`, `max_power_watts`, `avg_power_watts` | Aggregated from `session_events` at session close |
| Detection | `detection_config_id`, `detection_snapshot` | Config ID + frozen JSON copy at session open |
| Pricing | `matched_plan_id`, `expected_amount`, `corrected_amount`, `pricing_snapshot`, `billing_status` | See Pricing Calculation section |
| Corrections | `anomaly_type`, `correction_reason`, `notes` | Admin review fields |

**`billing_status` values:**
- `PENDING` — session closed but not yet priced
- `CALCULATED` — price auto-matched to a plan
- `CORRECTED` — admin overrode the calculated price
- `DISPUTED` — flagged for review

**Revenue fields:**
- `expected_amount` — auto-calculated price. **Never overwritten after it is set.**
- `corrected_amount` — admin override. Non-null only when `billing_status = CORRECTED`.
- **Effective amount** (computed in service layer) = `corrected_amount ?? expected_amount`

---

### `session_events`

Append-only log of every discrete event during a session. Never updated.

| Column | Notes |
|---|---|
| `session_id` | FK → `chair_sessions` |
| `chair_id` | Denormalized (not a FK) — enables direct chair-level queries without joining through sessions |
| `event_type` | `POWER_READING`, `STATE_TRANSITION`, `SESSION_OPENED`, `SESSION_CLOSED`, `ANOMALY_DETECTED`, `MANUAL_CORRECTION` |
| `power_watts` | Reading at the time of the event |
| `metadata` | JSONB — event-specific payload (e.g. `{ "from": "MAYBE_ACTIVE", "to": "ACTIVE" }`) |

Serves three purposes:
1. **Debug detection decisions** — which poll crossed which threshold and when.
2. **Audit state transitions** — complete trail from `IDLE` to `COMPLETED`.
3. **Power statistics source** — `min_power_watts`, `max_power_watts`, `avg_power_watts` on the session are aggregated from these rows at session close.

---

### `shifts` *(to be added)*

A shift groups sessions into a work period (e.g. morning shift, afternoon shift, full day). Shifts gate commission calculation: commission totals are only computed on `CLOSED` or `REVIEWED` shifts.

| Planned column | Notes |
|---|---|
| `id` | UUID |
| `user_id` | The staff member responsible for this shift |
| `status` | `OPEN`, `CLOSED`, `REVIEWED` |
| `started_at` / `ended_at` | Shift time boundaries |
| `expected_revenue` | Sum of effective amounts for all sessions in this shift |
| `notes` | Admin notes |

When this model is added, `chair_sessions.shift_id` (currently a plain string) will be promoted to a proper FK relation.

---

### `cash_declarations` *(to be added)*

Records the actual cash counted at the end of a shift. Compared against `shifts.expected_revenue` to produce the cash difference report.

| Planned column | Notes |
|---|---|
| `shift_id` | FK → `shifts` |
| `declared_amount` | Cash physically counted by staff |
| `expected_amount` | Copied from `shifts.expected_revenue` at declaration time |
| `difference` | `declared_amount - expected_amount` (positive = excess, negative = shortage) |
| `declared_by_user_id` | Staff member who counted the cash |
| `verified_by_user_id` | Admin who verified the count |
| `notes` | Explanation of any difference |

---

### `device_logs`

Significant technical events at the device level. **Not used for high-frequency power readings** — those belong in `session_events`. `device_logs` captures operational events only.

| Column | Notes |
|---|---|
| `chair_id` | Nullable — system-level events (auth errors, network outages) have no chair |
| `event_type` | `DEVICE_OFFLINE`, `DEVICE_RECOVERED`, `POLL_FAILED`, `UNEXPECTED_PAYLOAD`, `RELAY_COMMAND_SENT`, `AUTH_ERROR` |
| `severity` | `INFO`, `WARNING`, `ERROR` |
| `raw_data` | JSONB — unprocessed Shelly API response, for debugging unexpected payloads |

No `updated_at` — this is an immutable append-only log.

---

### `settings_audit_logs`

Immutable record written whenever a privileged entity (pricing plan, detection config, user, etc.) is created, modified, or deleted. Stores full before/after JSON values.

| Column | Notes |
|---|---|
| `entity_type` | Mirrors Prisma model name: `"PricingPlan"`, `"ChairDetectionConfig"`, etc. |
| `entity_id` | UUID of the affected row |
| `action` | `create`, `update`, `delete`, `activate`, `deactivate` |
| `old_value` | Full JSON snapshot of the row before the change |
| `new_value` | Full JSON snapshot of the row after the change |
| `user_id` | Nullable — system-initiated changes have no human actor |

No `updated_at` — immutable. Every change produces a new row; rows are never modified.

---

### `app_settings`

Key-value store for runtime configuration that the owner can change without a code deployment.

| Column | Notes |
|---|---|
| `key` | Unique, dot-notation convention: `"shelly.pollIntervalSeconds"`, `"session.maxDurationSeconds"` |
| `value` | Always stored as text; parsed according to `type` |
| `type` | Informational: `"string"`, `"number"`, `"boolean"`, `"json"` |
| `updated_by_user_id` | Last human actor; full history in `settings_audit_logs` |

Every write to `app_settings` must also write a row to `settings_audit_logs` so the full change history for any key is recoverable.

---

## 6. Pricing Calculation

When a session closes (`status` transitions to `COMPLETED`), the billing service executes the following algorithm:

```
1. Load the active PricingRule (WHERE is_active = true).

2. Load all active PricingPlans (WHERE is_active = true), ordered by duration_seconds ASC.

3. Apply grace window:
   For each plan, check:
     | session.durationSeconds - plan.durationSeconds | <= rule.graceSeconds
   If any plan is within the grace window, use that plan directly.
   Skip to step 6.

4. Apply rounding_mode to the remaining duration:
   NEAREST_PLAN  → select the plan whose durationSeconds is closest to the session duration
   NEXT_PLAN     → select the lowest plan whose durationSeconds >= session duration
   EXACT_MINUTES → skip plan matching; compute price = (durationSeconds / 60) × per-minute rate

5. Apply overtime policy if session duration exceeds the longest plan:
   NEXT_PLAN     → use the longest plan available
   EXTRA_MINUTE  → longest plan price + (overtime minutes × extra_minute_price)
   ANOMALY       → set session.anomaly_type, do not set expected_amount, alert admin

6. Apply minimum plan floor:
   If the resolved plan is cheaper than rule.minimumPlan, use minimumPlan instead.

7. Write results to chair_sessions:
   - matched_plan_id   = selected plan UUID
   - expected_amount   = resolved price (Decimal)
   - pricing_snapshot  = frozen JSON copy of the rule + plan used
   - billing_status    = CALCULATED
```

### Example

Session duration: 1920 seconds (32 minutes).
Plans: 20 min = 20 MAD, 30 min = 30 MAD, 40 min = 40 MAD.
Rule: `grace_seconds = 120`, `rounding_mode = NEXT_PLAN`.

```
Step 3 — grace check:
  |1920 - 1800| = 120 ≤ grace_seconds(120) → match 30-minute plan (1800s)

Result: expected_amount = 30.00 MAD, matched_plan = "30 minutes"
```

Without the grace window, `NEXT_PLAN` rounding would have pushed this to 40 MAD for a 32-minute session. The 2-minute grace absorbs normal timing imprecision.

---

## 7. Why Snapshots Exist

Two JSON snapshot fields are stored on every `chair_sessions` row:

### `detection_snapshot`

Written at session **open**. Contains the exact values from `chair_detection_configs` that were active when the session was detected.

```json
{
  "configId": "uuid...",
  "version": 3,
  "startThresholdWatts": 7,
  "stopThresholdWatts": 5,
  "startConfirmSeconds": 30,
  "stopConfirmSeconds": 180,
  "activationDelaySeconds": 30,
  "validFrom": "2026-05-01T00:00:00Z"
}
```

**Why:** If the detection thresholds are later changed (e.g. raised from 7W to 12W), sessions from the previous month should not be re-evaluated under the new rules. Any audit or dispute can look at this snapshot to see exactly what logic was used.

### `pricing_snapshot`

Written at session **billing time**. Contains the exact plan and rule values used to calculate the price.

```json
{
  "ruleId": "uuid...",
  "roundingMode": "NEXT_PLAN",
  "graceSeconds": 120,
  "minimumPlanId": "uuid...",
  "overtimePolicy": "ANOMALY",
  "matchedPlan": {
    "id": "uuid...",
    "name": "30 minutes",
    "durationSeconds": 1800,
    "priceAmount": "30.00",
    "currency": "MAD"
  }
}
```

**Why:** If the owner raises the 30-minute price from 30 MAD to 35 MAD next month, last month's sessions must not change. The `expected_amount` column stores the computed value, and the snapshot stores the reasoning. Both are immutable after being written.

**Together these two snapshots mean:** the complete logic behind any session price — what was detected, how long it ran, what rule was applied, what plan was matched — is permanently embedded in that session row and will never be affected by future configuration changes.

---

## 8. Cash Reconciliation

The reconciliation workflow closes the loop between what the system expects and what was physically collected.

```
┌─────────────────────────────────────────────────────┐
│                    SHIFT (e.g. morning)              │
│                                                      │
│  Session F1 · 30 min → expected  30.00 MAD           │
│  Session F2 · 20 min → expected  20.00 MAD           │
│  Session F1 · 30 min → corrected 25.00 MAD  ─────── admin override
│  Session F3 · 40 min → expected  40.00 MAD           │
│                                                      │
│  Expected revenue = 30 + 20 + 25 + 40 = 115.00 MAD  │
└──────────────────────────────┬──────────────────────┘
                               │
                         Shift closes
                               │
                               ▼
┌─────────────────────────────────────────────────────┐
│                  CASH DECLARATION                    │
│                                                      │
│  declared_amount  = 110.00 MAD  (staff count)        │
│  expected_amount  = 115.00 MAD  (system total)       │
│  difference       =  -5.00 MAD  (shortage)           │
└─────────────────────────────────────────────────────┘
```

### Revenue fields

| Field | Source | Mutable? |
|---|---|---|
| `expected_amount` | Auto-calculated by billing service | No — written once, never changed |
| `corrected_amount` | Admin override | Yes — set when `billing_status = CORRECTED` |
| Effective amount | `corrected_amount ?? expected_amount` | Computed in service layer, not stored |

The `expected_revenue` on a shift is the sum of effective amounts over all `COMPLETED` sessions in that shift. When the owner or admin declares cash at shift end, that declared amount is stored in `cash_declarations` alongside the expected amount. A negative difference triggers a review; a positive difference indicates excess cash.

### Commission calculation (`prime`)

Commissions for staff are calculated against closed shift totals. Only `CLOSED` or `REVIEWED` shifts are included. The commission rules (thresholds, periods, bonus amounts) will be stored in a future `commission_rules` table linked to `shifts`.

---

## 9. Important Constraints

### Database-level constraints

| Constraint | Table | Type | Rule |
|---|---|---|---|
| `users_email_key` | `users` | UNIQUE | One account per email address |
| `chairs_name_key` | `chairs` | UNIQUE | Chair labels F1–F5 are unique |
| `chairs_shelly_device_id_key` | `chairs` | UNIQUE | One chair per Shelly device |
| `app_settings_key_key` | `app_settings` | UNIQUE | One value per setting key |
| `unique_active_session_per_chair` | `chair_sessions` | PARTIAL UNIQUE | `WHERE status = 'ACTIVE'` — only one active session per chair at a time |
| `chair_sessions_chair_id_fkey` | `chair_sessions` | FK RESTRICT | Cannot delete a chair that has sessions |
| `session_events_session_id_fkey` | `session_events` | FK RESTRICT | Cannot delete a session that has events |
| All nullable FKs (`created_by_*`, `matched_plan_id`, `user_id`) | various | FK SET NULL | Deletions of referenced rows null the FK, not cascade-delete |

### The partial unique index

The most important business constraint is:

```sql
CREATE UNIQUE INDEX unique_active_session_per_chair
  ON chair_sessions (chair_id)
  WHERE status = 'ACTIVE';
```

This is a PostgreSQL partial unique index — it only applies to rows where `status = 'ACTIVE'`. A chair can have thousands of historical sessions (all fine), but **at most one row may have `status = 'ACTIVE'` for any given chair at any moment**.

This is enforced at the database level even if the service layer has a bug or two concurrent requests arrive simultaneously. It is the last line of defence against double-billing.

### Why `chair_sessions → chairs` uses `ON DELETE RESTRICT`

If a chair row were deleted, all of its session history would need to be deleted too (cascade) or nulled. Neither is acceptable — sessions are billing records. The `RESTRICT` rule means a chair that has ever had a session **cannot be deleted**. Use `is_enabled = false` to take a chair out of service, and `status = MAINTENANCE` to show it as unavailable in the UI.

---

## 10. Future Optional Tables

The following tables are not in the current schema but are planned or likely additions:

### `calibration_runs`

Records a deliberate test session used to calibrate detection thresholds for a specific chair. A technician runs the chair through all its programs while the system records the power profile. The result is used to recommend new values for `chair_detection_configs`.

| Planned column | Notes |
|---|---|
| `chair_id` | FK → `chairs` |
| `triggered_by_user_id` | Who initiated the calibration |
| `started_at` / `ended_at` | Calibration run window |
| `peak_power_watts` | Maximum observed during the run |
| `idle_power_watts` | Observed idle draw |
| `recommended_start_threshold` | Suggested value for `start_threshold_watts` |
| `recommended_stop_threshold` | Suggested value for `stop_threshold_watts` |
| `status` | `RUNNING`, `COMPLETED`, `FAILED` |

### `power_readings`

High-frequency storage of every Shelly power reading, one row per poll per chair. **Not created for MVP** because it generates approximately `5 chairs × 1 poll/5s × 86400s/day = 86,400 rows/day`. At that volume it requires a time-series strategy (partitioning by day, or a dedicated TSDB like TimescaleDB).

For MVP, the power history needed for session debugging is captured in `session_events` (which records readings during active sessions) and `device_logs` (which records readings around anomalies). Full power history can be added as a separate time-series table when the business needs it.

| Planned column | Notes |
|---|---|
| `chair_id` | FK → `chairs` |
| `power_watts` | Reading value |
| `relay_is_on` | Relay state at time of reading |
| `recorded_at` | Timestamp (primary sort key) |

**Partitioning required** before this table is created in production.

### `notifications`

Stores alerts generated by the system for delivery to users (in-app, SMS, or push).

| Planned column | Notes |
|---|---|
| `user_id` | Recipient |
| `type` | `SESSION_ANOMALY`, `DEVICE_OFFLINE`, `SHIFT_REVIEW_REQUIRED`, `CASH_SHORTAGE` |
| `payload` | JSONB — notification-specific data |
| `is_read` | Boolean |
| `sent_at` | When the notification was dispatched |

### `reports`

Pre-computed or cached report snapshots for the stats dashboard (daily revenue, utilization per chair, commission totals by period). Avoids recomputing expensive aggregations on every page load.

| Planned column | Notes |
|---|---|
| `type` | `DAILY_REVENUE`, `CHAIR_UTILIZATION`, `SHIFT_COMMISSION`, etc. |
| `period_start` / `period_end` | Time range the report covers |
| `data` | JSONB — full report payload |
| `generated_at` | When the computation ran |
| `is_stale` | Whether a new session or correction has invalidated this report since generation |

---

*Document maintained alongside `backend/prisma/schema.prisma`. When the schema changes, update this file in the same commit.*
