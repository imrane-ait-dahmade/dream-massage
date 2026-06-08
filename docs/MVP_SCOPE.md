# MVP Scope — Dream Massage

> **Goal:** Deliver a working, production-ready management app for a 5-chair massage shop in one focused build sprint.

---

## Who Uses the App

### Owner and Admin — the only app users

The application is designed exclusively for **OWNER** and **ADMIN** accounts. They log in, manage the shop, and review all data. There are exactly two user roles.

### StaffMember — NOT an app user

A `StaffMember` is a physical employee who works the chairs. They:

- Have **no login credentials**
- Cannot access the application
- Cannot view the dashboard
- Cannot start or stop sessions
- Cannot choose pricing plans
- Cannot declare cash
- Cannot correct sessions

The only way a staff member appears in the system is as a record assigned to a `Shift` by an Owner or Admin. Their name shows up on shift reports, nothing more.

---

## Core Problem Being Solved

The owner needs to know, at any moment and historically:

1. Which chairs are in use right now
2. How long each session has been running
3. How much revenue the current shift has generated
4. Whether the cash collected matches what the system expected

All of this must happen **automatically** — no staff action required to start a session, end a session, or record revenue.

---

## What Automatic Session Detection Means

The backend polls **Shelly Cloud** (the smart relay attached to each chair) every second. It reads the current power consumption in watts for all 5 chairs in **one HTTP request**.

When a chair's power exceeds the configured start threshold and **stays above it** for a confirmation window, a session is opened automatically. When power drops below the stop threshold and **stays below it** for a longer confirmation window, the session is closed automatically. This debounce logic prevents false starts and stops from mode changes during a massage.

No staff member triggers this process. No button is pressed. The session appears and closes on its own.

---

## Expected Revenue

When a session closes, the billing service immediately calculates the expected revenue:

1. Loads the currently active `PricingRule`
2. Loads all active `PricingPlan` rows (duration → price mappings)
3. Applies grace window, rounding mode, and overtime policy
4. Writes `expected_amount` directly to the session row

`expected_amount` is immutable after it is set. If an admin overrides it, the original value stays in the record alongside the correction — both are permanent.

---

## Shifts

A **Shift** is an open work period managed by an Owner or Admin. It:

- Has one `StaffMember` assigned (the person physically working)
- Is opened by an Admin before the staff member starts
- Collects all sessions that happen during its OPEN window
- Is closed by an Admin at end of day
- At close, computes `expected_cash` (sum of all session effective amounts)
- A `CashDeclaration` records what was physically counted, producing a cash difference report

---

## What Is Included in MVP

| Feature | Status |
|---|---|
| Auto session detection from Shelly power data | ✅ MVP |
| Real-time dashboard (chair statuses, active sessions) | ✅ MVP |
| Session history with duration and expected revenue | ✅ MVP |
| Shift management (open, close, assign staff member) | ✅ MVP |
| Cash reconciliation (expected vs declared) | ✅ MVP |
| JWT authentication for Owner/Admin | ✅ MVP |
| Admin correction of session price or status | ✅ MVP |
| WebSocket real-time updates to frontend | ✅ MVP |
| Pricing plan and rule configuration | ✅ MVP |

---

## What Is NOT Included in MVP

| Feature | Reason Deferred |
|---|---|
| Staff mobile/PWA interface | Staff do not use the app |
| Customer-facing booking or display | Out of scope |
| Commission calculation | Needs business rule clarification |
| Automated reporting / export | Post-MVP |
| Push notifications / SMS alerts | Post-MVP |
| Multi-location support | Single shop only |
| Payment processing (POS integration) | Cash-only operation in MVP |
| Historical power readings (full telemetry) | High-volume; needs partitioning strategy |
| Calibration runs for threshold tuning | Post-MVP |
