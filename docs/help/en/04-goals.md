---
title: Goals and KPI
section: Dashboard
order: 4
summary: Counter goal catalog, health flags, KPI goal selection, per-goal detail page, archived goals.
---

# Goals and KPI

Everything in the cabinet revolves around counter goals: the KPI strip, funnels, per-channel conversions and reports all count goal reaches. This article explains the goal catalog, how the primary goal is chosen and how to read a single goal's detail page.

## The Goals page

The Goals page lists every goal of counter 54280963 with its type, status and reaches for the selected period.

![Goals page screenshot](/screenshots/05-goals.png)
_The goal catalog with type, status and reach counts._

### Goal statuses

The status is computed automatically from reach history:

| Status       | Rule                                  | What it means                                                             |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------- |
| **Live**     | reaches in the last 14 days           | The goal fires regularly — keep it in dashboards                          |
| **Sleeping** | no reaches in 14 days, but some in 90 | Fires rarely; check before removing — seasonal goals look sleeping        |
| **Dead**     | 0 reaches in 90 days                  | Candidate for cleanup; a dead goal still shows in reports unless archived |

Goals whose type and conditions are identical are flagged as **duplicates** — the page shows which ids clash so you can archive the extra ones from the admin UI.

## Choosing the primary goal

The primary goal drives the KPI strip, the funnel end stage and report headlines. By default it is **auto-detected**: the cabinet picks the purchase goal (ecommerce). An administrator can pin a specific goal with the `GOAL_ID` server variable when auto-detection picks the wrong one — for example if several purchase-like goals exist.

How to verify which goal is active:

1. Open **KPI & forecast** (`/app/kpi`) — the goal name and id are shown next to the target.
2. Cross-check with **Admin → Yandex Metrika**, where the pinned `GOAL_ID` is visible to administrators.
3. If it is wrong, an administrator changes `GOAL_ID` or archives the competing goal; no code changes are needed.

## Goal detail page

Click any goal to open its detail card at `/app/goals/:id`.

![Goal detail screenshot](/screenshots/06-goal-detail.png)
_Goal detail: dynamics, conversion and breakdown by channels and devices._

The card contains:

- **Reach dynamics** — daily reaches for the selected period.
- **Conversion** — reaches relative to visits, with the period delta.
- **Channels** — which traffic sources produce reaches (the "where did my buyers come from" view).
- **Devices** — desktop / mobile / tablet split.
- **Period comparison** — the same cut for the previous period.

## KPI and the 300-ticket target

The **KPI & forecast** page (`/app/kpi`) puts the primary goal against the campaign target of **300 tickets**:

- collected tickets for the campaign period and the gap to 300;
- the required daily pace to close the gap;
- a forecast based on the recent trend.

![KPI page screenshot](/screenshots/11-kpi.png)
_KPI page: progress toward the target, pace and forecast._

## Archived goals

Old counters accumulate junk goals. Goals with ids above the archive threshold are treated as archived and excluded from KPI and catalogs. The threshold is configured via the `ARCHIVED_GOAL_ID_THRESHOLD` server variable, and administrators can also create or archive individual goals from **Admin → Yandex Metrika** (Management API). The **Archived goals** toggle in the header shows or hides them in the cabinet.

## Use cases

- **Create a new goal** — an administrator opens **Admin → Yandex Metrika**, creates the goal via the Management API form, waits for the next sync and finds it on the Goals page.
- **"Which goal should be the KPI?"** — open Goals, filter dead goals, compare live candidates on their detail pages and pin the winner with `GOAL_ID`.
- **Cleanup before a report** — archive dead and duplicate goals so the report goal table shows only meaningful rows.

## Troubleshooting

- **A new goal does not appear** — goals are fetched during a sync; run **Admin → Yandex Metrika → Sync** or wait for the 3-hour schedule.
- **KPI counts a wrong goal** — check the pinned `GOAL_ID` and the archive threshold; archived ids above the threshold are excluded even if they still get reaches.
- **Two goals show identical numbers** — they are duplicates with the same conditions; archive one from the admin UI.

## Data source and limits

The goal list comes from the Metrika catalogue at sync time (the `goals` table: id, name, type,
archive flag). Card reaches are daily series from `channel_stats`/`raw_responses`, so the card
follows the header period. Management (create/archive) is admin-only via the Metrika Management
API; analysts browse. A goal created in the Metrika UI appears here after the next sync.

## Goal types and their quirks

| Type | Fires when | Watch out for |
| ---- | ---------- | ------------- |
| URL condition | Visiting a page by mask (contain/start/regexp) | Masks break on redesigns |
| JS event | `ym(…, 'reachGoal', name)` from the site | Exact event name, no typos |
| Page views per visit | N pages in one visit | Depth, not conversion |
| Ecommerce/order | E-commerce data | The primary `GOAL_ID` candidate |

## Related pages

- **Live → Goals** — today's goal reaches (Reporting API, no sync wait).
- **Marketing** — the «site goals» grid row aggregates the same primary goal by weeks.
