---
title: Conversion funnel
section: Dashboard
order: 6
summary: Step-by-step funnel from visit to goal, per-stage conversion and how to act on it.
---

# Conversion funnel

The Funnel page (`/app/funnel`) runs from total visits to primary goal reaches on synced daily data. Each stage shows its absolute value and its conversion from the previous step — the classic leak map.

![Funnel screenshot](/screenshots/10-funnel.png)
_The conversion funnel with per-stage values and step-to-step conversion._

## What the stages are

| Stage        | Value                        | Typical leak meaning    |
| ------------ | ---------------------------- | ----------------------- |
| Visits       | all visits in the period     | Traffic volume baseline |
| Engaged      | visits that were not bounces | Traffic quality         |
| Deeper       | multi-page visits            | Interest in content     |
| Goal reaches | primary goal (purchases)     | The result              |

Conversion percentages are computed stage-to-stage, so a weak middle stage hides a weak entry stage. Read the funnel top-down: fix the first weak link, not the last one.

## How to analyze

1. Find the **narrowest stage** (lowest conversion) — that is where optimization starts.
2. Compare periods: switch the header period and watch how each stage moved. Funnel changes reflect site changes — a redesign, a new landing page, a form edit.
3. Cross-check with **Traffic**: a funnel that is bad only for one channel is a landing-page mismatch, not a site problem.
4. For **today** use **Live → Live funnel** (pc-goals stages), because this page only knows completed days after a sync.

## Funnel vs live funnel

![Live funnel screenshot](/screenshots/07-funnel-live.png)
_The live counterpart: pc-goals stages for today, before the daily data exists._

|          | Funnel (`/app/funnel`)             | Live funnel (`/app/funnel-live`)                                    |
| -------- | ---------------------------------- | ------------------------------------------------------------------- |
| Data     | daily rows from the local database | Metrika Reporting API, today                                        |
| Stages   | visit → engaged → deeper → goal    | pc-goals events: saw tickets → CTA → registration → cart → contacts |
| Best for | historical comparison and reports  | operational monitoring of the ticket flow                           |

The two funnels complement each other: the live one shows the mechanics of the purchase flow, the daily one shows the aggregate picture that goes into reports. When a stakeholder asks "how are sales going today", the answer is the live funnel; when they ask "how has the site been converting this month", the answer is this page.

## A five-minute funnel review

When time is short, this checklist covers the essentials:

1. Open the funnel for the last 30 days and note the weakest stage conversion.
2. Switch to the previous 30 days — did the weak stage get better or worse?
3. Open **Traffic → UTM** and check whether the weakest stage is driven by one specific campaign.
4. Decide one action: fix the page (if the leak is on-site) or fix the source (if the leak came in with the traffic).
5. Write the action down as a hypothesis on the **Report** page so the next review can confirm it.

## Use cases

- **Redesign verification** — snapshot the funnel before the redesign (see **Report**), then compare the same period length after; the stage that improved tells you what worked.
- **"Why did conversions drop this week?"** — if the drop is already at the "engaged" stage, suspect traffic quality (new cheap source); if only the last stage fell, suspect the purchase flow.
- **Monthly report insert** — export the funnel snapshot numbers into the report document instead of retyping percentages.

## Troubleshooting

- **The funnel ends at the first stage** — the primary goal may have zero reaches in the period; check the goal selection on **Goals** and the Archived goals toggle.
- **Today is missing** — daily data appears after a sync; either wait for the 3-hour schedule or run a manual sync from the admin panel.
- **Conversion above 100% on some stage** — this happens when the goal can fire several times per visit (multi-reach goals); interpret such stages as "reaches per visit" rather than a share of visitors.

## Data source and limits

The period funnel aggregates daily data (primary-goal `channel_stats` + `b2b_manual` +
`b2c_payments`) — it freezes after a sync and reflects the settled period. The live funnel
(`/app/funnel-live`) reads pc-goals ticket-funnel events via the Reporting API on the fly and
shows registration steps: registration opened → cart → registration step → payment. Stages are
labelled and coloured; each stage shows its value source (visits/goal/manual).

## Reading the B2C and B2B funnel

The dashboard funnel shows two branches: B2C (visit → goal) and the B2B deal pipeline. The
«B2B paid» column counts stage `paid` only; negotiations and invoices live in the B2B pipeline
page. The «lead ≠ payment» rule holds here too: leads are never added to paid tickets.
