---
title: Glossary
section: Reference
order: 22
summary: Every dashboard term in one place — from «visit» and «lead» to sync windows, value source priorities and ICE. Each definition lists its data source and the article using it.
---

# Glossary

Terms grouped by topic. Next to each — the data source and the article where it is used.
Formulas — in [Formulas and calculations](23-formulas).

## Data and sources

| Term                    | Definition                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visit**               | A visitor session on the site. Counted by Yandex.Metrika; lands in the dashboard at sync time, per day. Source: `channel_stats.visits`.                                                                                                                                                     |
| **User**                | A unique person within the period (cookie-based). Always ≤ visits: one visitor makes several visits.                                                                                                                                                                                        |
| **Bounce rate**         | Share of visits without deep interaction. Stored as `bounce_rate` (0…1) per channel/page.                                                                                                                                                                                                   |
| **Channel**             | Traffic source per the Metrika classification: `Direct traffic`, `Search engine traffic`, `Social network traffic`, `Ad traffic`, `Recommendation system traffic`, `Message traffic`, `Link traffic`, `Saved page traffic`, `Internal traffic`, `Not defined`. Names are localised (RU/EN). |
| **UTM tag**             | Campaign parameters `utm_source / utm_medium / utm_campaign` in the link. Collected into `utm_stats` — shows which post brought the traffic.                                                                                                                                                |
| **Goal**                | A Metrika event counted as a conversion (e.g. ticket order). The catalogue is stored in `goals`; the primary goal is the `GOAL_ID` setting, the order goal — `ORDER_GOAL_ID`.                                                                                                               |
| **Goal reach**          | How many times the goal fired in the period. Stored per day and channel (`goal_reaches`) — these are the funnel «leads».                                                                                                                                                                    |
| **pc-goals**            | Counter-level event goals (registration, cart open, etc.) powering the Live pages (`/app/live`, `/app/funnel-live`) funnel stages.                                                                                                                                                          |
| **Sync**                | Loading Metrika data for a date window into the dashboard DB. Overwrites only the window (snapshot → reload → restore on failure); manual data (B2B, payments, marketing grid) is untouched.                                                                                                |
| **Sync window**         | The date range [from … to] a sync reloads. History outside the window is preserved — a «last 14 days only» situation cannot happen.                                                                                                                                                         |
| **Metrika quota (429)** | API rate limits. On quota exhaustion the sync snapshots the window and restores it; enable `METRIKA_REQUEST_DELAY_MS` pacing for large windows.                                                                                                                                             |

## Funnel and KPI

| Term                     | Definition                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Lead**                 | A primary-goal reach (registration, `GOAL_ID`). NOT a payment.                                                                      |
| **Payment**              | Confirmed money: B2C payments (`b2c_payments`) + paid B2B deals (`b2b_manual`, stage `paid`). Formula — in [Formulas](23-formulas). |
| **«Lead ≠ payment»**     | The product's core invariant: a Metrika goal reach is intent, not money. They are never added into one number.                      |
| **KPI target (300)**     | The paid-ticket plan (the `KPI_TARGET` setting, default 300). Drives «on track for 300?», the progress ring and the forecast.       |
| **Gap to target**        | `max(0, target − paid)`. What is subtracted depends on the primary goal type (see Formulas).                                        |
| **B2B paid**             | Sum of tickets of deals in stage `paid`. Pipeline stages: `lead` → `negotiation` → `invoiced` → `paid`.                             |
| **B2C applications**     | Primary-goal reaches in the period — the B2C funnel leads.                                                                          |
| **Forecast (What if)**   | Estimated KPI achievement by the deadline with changed traffic/conversion — sliders on the KPI page recompute the outcome.          |
| **CR (conversion rate)** | `goal_reaches / visits`. Shown per channel, page, UTM.                                                                              |

## Hypotheses and decisions

| Term                                 | Definition                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Hypothesis**                       | A testable assumption in the Diamond template: subject → action → barrier → solution → condition. Stored in `hypotheses`.      |
| **Hidden assumptions**               | Statements that must hold for the hypothesis to work (behavior/market/tech) — at least 3.                                      |
| **Validation methods**               | Quantitative and synthetic ways to validate (A/B, interviews, Metrika analysis) — at least 2.                                  |
| **ICE**                              | Prioritisation: Impact × Confidence × Ease, each multiplier requiring a written rationale.                                     |
| **Traffic light (green/yellow/red)** | Validation outcome against the criteria set at creation.                                                                       |
| **Decision Log**                     | The decision journal: hypothesis → conclusion, quote/number, source. A decision records the outcome and closes the hypothesis. |
| **Kanban**                           | The hypothesis board by status: Backlog → In validation → Confirmed / Partial / Rejected (+ Expired).                          |

## Marketing grid

| Term             | Definition                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grid (стата)** | The weekly marketing table on `/app/marketing` — the Google Sheet replacement. 13 weeks × 13 metrics. Article: [Marketing & influence partners](21-marketing). |
| **Value source** | `manual` (entered by a person) > `import` (loaded from the sheet) > `metrika` (computed by the sync). Manual values are never overwritten.                     |
| **Backfill**     | Loading data for the period before the sync existed: the Metrika window (`POST /api/sync`) + historical B2B import (`POST /api/b2b/import`).                   |
| **Empty week**   | A week with no source data. Shown empty (not zero): «no data» ≠ «zero events».                                                                                 |

## Admin and system

| Term            | Definition                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Counter**     | The site identifier in Metrika (`COUNTER_ID`, prod — 54280963). Analyst access to counters is restricted by the admin.                                    |
| **OAuth token** | The Metrika API access token, set by the admin in `Administration → Metrika`; stored encrypted (AES-256-GCM).                                             |
| **Roles**       | `admin` (everything + users/settings/sync) and `analyst` (data, reports, hypotheses, manual entry). Direct admin-API requests from an analyst return 403. |
| **Audit log**   | `audit_log`: who did what and when (login, users, settings, sync, keys). View: `Administration → Audit`.                                                  |
| **Snapshot**    | A frozen slice of report data at build time; DOCX/PDF and the on-screen preview render from it.                                                           |
| **DataLens**    | Yandex BI. The dashboard serves CSV datasets (`/api/integrations/datalens/export/...`); the workbook is assembled by `scripts/datalens-api.mjs`.          |
| **Demo data**   | Seed rows flagged `is_demo`; fully wiped by the first successful sync.                                                                                    |
