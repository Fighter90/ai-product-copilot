---
title: Real-time
section: Dashboard
order: 3
summary: Live pages — today's goals, the pc-goals funnel step by step, ticket types, application roles, refresh etiquette.
---

# Real-time

The "Live" section queries the Metrika Reporting API directly, so it shows **today** without waiting for the 3-hour daily sync. Use it for operational monitoring; use daily pages for historical cuts.

## Live pages

| Page        | Route              | What it shows                                                                             |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------- |
| Live goals  | `/app/live`        | Today's reaches for all counter goals, compared with yesterday and the 14/90-day averages |
| Live funnel | `/app/funnel-live` | The pc-goals funnel from "saw tickets" to "left contacts"                                 |
| Goal detail | `/app/goals/:id`   | Per-goal breakdown: sources, devices, entry pages                                         |

![Live page screenshot](/screenshots/04-live.png)
_Live goals with today's reaches and comparison against yesterday and averages._

## Reading the delta

The delta compares **with the same time yesterday**. A negative delta early in the day is normal — you are comparing a half-day against yesterday's full day. Practical reading rules:

1. Before noon, treat a delta of −30…−50% as "no signal".
2. From 15:00–16:00 the delta becomes meaningful; yesterday's evening peak is not yet played out, so mild negative values are still expected.
3. Use the 14-day and 90-day average columns to judge the level, not just yesterday: an average smooths out one-off spikes.
4. A delta strongly above +100% usually means a launch (mailing, post, ad start) — verify in **Traffic → UTM** which campaign drove it.

## The pc-goals funnel step by step

The live funnel is built from JavaScript events sent by the pc-goals script on productcamp.ru. Each stage is one event:

| #   | Stage                 | Event        | Meaning                                    |
| --- | --------------------- | ------------ | ------------------------------------------ |
| 1   | Saw ticket block      | `price_view` | The visitor scrolled to the ticket section |
| 2   | CTA click             | `cta_click`  | Clicked a "buy ticket" button              |
| 3   | Opened registration   | `reg_open`   | Opened the registration form               |
| 4   | Opened cart           | `cart_open`  | Reached the cart / checkout step           |
| 5   | Left contacts (order) | `reg_step1`  | Submitted contacts — an order is created   |

![Live funnel screenshot](/screenshots/07-funnel-live.png)
_The pc-goals funnel: five stages from seeing the tickets to leaving contacts._

How to analyze it:

1. Start from stage 1→2. A low CTA click rate means the ticket block is not convincing or is placed badly.
2. Then check 3→4. A drop here points to friction in the registration form itself.
3. Stage 5 is the money step — everyone who left contacts is a potential ticket; compare its count with the KPI goal reaches.
4. Compare today's funnel with the daily **Funnel** page to see whether today is typical.

## Ticket types

The funnel breaks down by ticket type: **standard**, **optimal** and **max**. Each type is a separate branch of the same events, so you can see, for example, that most visitors look at standard tickets while conversions concentrate in optimal. Use this when planning promotions: if the optimal branch converts best, it deserves the louder banner.

## Application roles

Besides buying tickets, visitors can apply to the conference in four roles, each with its own event: **volunteer** (`volunteer_apply`), **speaker** (`speaker_apply`), **C-level** (`clevel_apply`) and **partner** (`partner_apply`). These applications are goals of type "action" in the counter and appear in Live goals and on the goal detail page. They do not count toward the ticket KPI, but they are part of the conference funnel.

## Test traffic

pc-goals marks sandbox and test visits (`env: test`), and the live pages filter them out automatically. If you are testing the site yourself and the numbers do not move, you are probably filtered as test traffic — that is by design.

## Refresh etiquette

Data is fetched when the page opens; the **Refresh** button re-queries Metrika. Every refresh is a real API call, so:

- once a minute is plenty — Metrika reporting data itself is not second-by-second;
- do not keep several live pages auto-refreshing in parallel tabs;
- for a wall-screen, one open Live tab with manual refresh before meetings is the intended usage.

## Use cases

- **Mailing launch control** — send the mailing, open Live goals, watch the delta and the UTM table to see the first reaches within minutes.
- **Registration form change** — the team moves the form; watch funnel stages 3→4→5 for the rest of the day.
- **Ticket-type pricing decision** — compare conversion branches for standard / optimal / max before deciding which type to promote in the next post.

## Troubleshooting

- **All zeros on Live but the site works** — check that the pc-goals script is present on productcamp.ru and that the counter is reachable; then verify in **Admin → Yandex Metrika** that the counter id matches.
- **A stage is missing or stuck at zero all day** — the event name may have changed on the site side; funnel stages are hard-coded (`price_view`, `cta_click`, `reg_open`, `cart_open`, `reg_step1`) and must match the emitted events.
- **Live differs from the daily Funnel page** — that is expected: Live is today via the Reporting API, the Funnel page is synced daily rows. Compare only closed days.
