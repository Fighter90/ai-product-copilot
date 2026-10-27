---
title: Overview
section: Dashboard
order: 2
summary: The first cabinet screen — goal KPI strip, dynamics, data status and navigation.
---

# Overview

## What you see

The Overview answers the main question: "How is the campaign going?". It is the page you land on after sign-in and the page to open first every morning: the top strip shows the primary goal KPI (tickets), followed by daily dynamics, traffic sources and service indicators.

![Overview screenshot](/screenshots/03-overview.png)
_Overview with the KPI strip and daily dynamics for the selected period._

## KPI strip

- **Primary goal** — detected automatically (the purchase / ecommerce goal) or pinned by an administrator via `GOAL_ID`. Shows reaches for the period, the delta to the previous period and conversion.
- **Gap to target** — progress toward the 300-ticket campaign target: how many tickets are collected and how many remain.
- **Visits, visitors, bounce rate, duration** — the traffic health block for the same period.

The exact formulas behind every number are collected in [Metrics and formulas](#).

## Period and segments

The period switch in the header affects every cabinet page: 7 / 14 / 30 / 90 days, 1 year, or a custom range. The **B2C+B2B segment** toggle and the **Archived goals** switch also live in the header and behave the same way everywhere. Data is stored per day, so future dates in a custom range are simply empty — that is not a bug.

## Daily dynamics

The chart under the KPI strip draws visits and goal reaches per day for the selected period. Use it to spot launches: a spike after a mailing, a dip on a weekend, a flat line when a channel was turned off. Hover a point to read exact values.

![KPI page screenshot](/screenshots/11-kpi.png)
_The primary goal against the 300-ticket target — the same numbers the KPI strip summarizes._

## Sources block

A compact table of channels (direct, search, social, email, messenger, referrals) with visits and goal reaches. It is a preview — the full breakdown with UTM tags lives on **Traffic**.

## Data status

Until a sync runs, pages show empty states with a hint to run **Admin → Yandex Metrika → Sync**. After the first sync the daily rows land in the local database, and every daily-based page fills up. The sync schedule is every 3 hours (see [How the product works](#)).

### Morning routine

1. Open Overview, check the KPI strip and the gap to 300 tickets.
2. Scan the daily chart for anomalies (spikes, drops, zero days).
3. If something looks off, open **Live** for today's picture before digging into daily cuts.
4. If a number contradicts Metrika itself, check **History** for sync gaps.

The whole routine takes two minutes when data is healthy — and the same two minutes catches every sync failure before it reaches a report.

## Use cases

- **Morning stand-up answer** — "how many tickets do we have and how did yesterday go" is answered by the KPI strip plus the yesterday bar on the chart.
- **Campaign launch check** — switch the period to 7 days on the launch morning and watch the source table: the new channel should appear with growing visits.
- **Board update prep** — set a custom range from the campaign start to today and screenshot the KPI strip as the headline of your slide.

## Troubleshooting

- **KPI shows zero although tickets exist** — the primary goal may be pinned to a wrong `GOAL_ID` or the goal was archived; check **Goals** and the admin Metrika settings.
- **Yesterday is missing** — the 3-hour sync may not have covered the end of the day yet; run a manual sync or wait for the next scheduled one.
- **Numbers differ from the Metrika interface** — the cabinet deduplicates test traffic and uses daily rows; compare the same period and same goal before reporting a discrepancy.

## Data source and limits

Every Overview number reads from the dashboard's own database (`channel_stats`, `b2b_manual`,
`b2c_payments`) filled by the Metrika sync per day — pages open instantly and do not depend on
Metrika API availability. Limits: data appears after a sync (scheduled every 3 hours, «today»
lives in Live); the bot filter applies at the counter level; demo seeds are flagged and wiped
by the first real sync. Compare against Metrika with the same period and the «all visitors»
segment.

## Related pages

- **Live** — today's funnel and goals (no sync wait).
- **Traffic / Behavior** — channels, UTM, geo, devices, pages.
- **Marketing** — the weekly content/influence grid (mirrors the Google Sheet).
- **KPI & forecast** — «on track for 300?» and the What-if scenarios.
