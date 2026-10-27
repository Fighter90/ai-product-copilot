---
title: Formulas and calculations
section: Reference
order: 23
summary: How every dashboard number is computed — CR, «Paid», gap to target, forecast, ICE, weekly grid sums. With examples and source files.
---

# Formulas and calculations

Every dashboard number is deterministic: pure functions over the DB data, no randomness or
hidden multipliers. Next to each formula — the source file, so you can always verify.

## Traffic and conversions

| Value                | Formula                                        | Example                                         |
| -------------------- | ---------------------------------------------- | ----------------------------------------------- |
| **Visits in period** | Σ `channel_stats.visits` over the period dates | Oct 12–25: sum over all channels and days       |
| **Channel CR**       | `goal_reaches / visits`                        | 420 visits, 12 leads → CR = 12/420 = **2.86 %** |
| **Page CR**          | `goal_reaches / visits` from `page_stats`      | `/lp`: 14/380 = **3.68 %**                      |
| **Channel share**    | `channel visits / Σ visits`                    | podcast 420 of 680 → **61.8 %**                 |

Sources: `code/backend/src/db/repositories/metrics-repo.ts`, `code/shared/src/aggregate.ts`.
The bot filter is applied at the counter level (not on breakdowns) — otherwise rows get lost
(ANA-65).

## Funnel and KPI

| Value                | Formula                                                                                                                               | Example                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **B2C applications** | Σ primary-goal `goal_reaches` in the period                                                                                           | 30 leads                        |
| **B2B paid**         | Σ `tickets` of deals in stage `paid`                                                                                                  | 20 tickets                      |
| **Paid total**       | `b2c_payments.tickets` (per day) + Σ paid B2B deal tickets                                                                            | 12 + 20 = **32**                |
| **Gap to target**    | `max(0, target − paid)`, where «paid» = B2B paid **+ Metrika orders** if the primary goal is a payment-type goal (`goalLabel.isPaid`) | target 300, 20+47 → gap **233** |

Sources: `code/backend/src/report/snapshot-builder.ts` (lines 92–105),
`code/backend/src/routes/payments.ts` (`/payments/summary`). Invariant: **lead ≠ payment** —
B2C applications are never added to money.

## Forecast and «What if» (KPI page)

The forecast model is a linear extrapolation of the current pace:

1. **Payment pace** = paid in period / days in period.
2. **Days to deadline** = target date − today.
3. **Forecast** = paid + pace × days to deadline.
4. The «Extra traffic +N %» slider proportionally increases applications
   (`applications × (1+N/100)`), the «CR growth +N pp» slider — conversion; both recompute the
   visit → application → payment funnel.

Limitations: the forecast knows nothing about seasonality — use «What if» for scenarios, not
promises. Sources: `code/frontend/src/routes/goals.tsx`, `code/shared/src/period-totals.ts`.

## Hypotheses: ICE

```
ICE = Impact × Confidence × Ease        (each multiplier 1–10)
```

- **Impact** — how strongly the metric moves if the hypothesis is true;
- **Confidence** — how sure we are it works (Metrika data, cases, custdev);
- **Ease** — how easy it is to validate/ship.

Every multiplier requires a written rationale. The ICE table sorts by the total descending.
Sources: `code/shared/src/validation.ts`, the `/app/hypotheses` page.

## Marketing grid (weeks)

Aggregation follows the «стата» sheet weeks (not calendar weeks):

| Row            | Week formula [start … end]                                                  |
| -------------- | --------------------------------------------------------------------------- |
| landing visits | `Σ channel_stats.visits` where `date ∈ [start, end]`                        |
| site goals     | `Σ channel_stats.goal_reaches` for the same week                            |
| payments       | `Σ b2c_payments.tickets` + `Σ b2b_manual.tickets` where `date_paid` in week |
| B2B leads      | `COUNT(b2b_manual)` where `date_added` in week                              |
| the rest       | manual (analyst) or sheet import                                            |

Write rule: week totals are computed only when the window has source data — a week without
data stays empty. Sources: `code/backend/src/marketing/sync.ts`,
`marketing-repo.ts → weekTotals()`.

## Data coverage and gaps

A gap is a run of **≥ 3 calendar days** missing between neighbouring event dates inside one
series (b2b `date_added`, b2b `date_paid`, `b2c_payments` days). Example: events on Oct 9 and
Oct 19 → a 9-day gap. Check: `GET /api/payments/coverage`. Source:
`code/backend/src/data/coverage.ts`.

## Rounding and formatting

- Percentages — `Intl.NumberFormat` per locale, 1 decimal (`2.9 %` RU / `2.9%` EN).
- Numbers — thousand separators per locale; durations — `mm:ss`.
- B2B money amounts — whole rubles (`amount_rub`).

Sources: `code/frontend/src/i18n/index.ts` (`fmtNum`, `fmtPct`, `fmtDate`).
