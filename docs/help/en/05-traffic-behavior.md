---
title: Traffic and behavior
section: Dashboard
order: 5
summary: Channels, UTM tags, geography, devices and site pages — with data-grid workflow.
---

# Traffic and behavior

These two pages answer "where does traffic come from" and "what do visitors do on the site". Both work on synced daily data and honor the header period, segment and archived-goal switches.

## Traffic

The Traffic page (`/app/traffic`) has two tabs:

### Channels

The Metrika channel summary — direct, search (organic), ads, social, email, messengers, referrals, internal transitions and "link tagged with UTM". For each channel you get visits, visitors, bounce rate, page depth, duration and goal reaches.

![Traffic screenshot](/screenshots/08-traffic.png)
_Channel summary with visits, quality metrics and goal reaches._

1. Sort by **goal reaches** to see which channels actually sell, not just bring volume.
2. Sort by **bounce rate** descending to find low-quality sources.
3. Click a row's channel to focus the table on it and compare its quality metrics against the total.

### UTM

A flat table of `utm_source / utm_medium / utm_campaign` combinations. This is the working tool for campaign analysis:

1. Use the table **search** to find your campaign by name (`utm_campaign`).
2. Sort by visits to compare campaigns by volume, or by reaches to compare them by result.
3. If a campaign shows visits but zero reaches, open the campaign page in Metrika to check landing relevance.

Interpretation notes: a large "(none)" row means untagged traffic — mostly organic and direct, which is normal; a flood of odd utm_source values usually means third-party widgets or bots. Campaign tagging rules belong to the marketing team, but the cabinet makes gaps visible.

## Behavior

The Behavior page (`/app/behavior`) shows what visitors do after arrival.

![Behavior screenshot](/screenshots/09-behavior.png)
_Geo, devices and page statistics in one view._

- **Geo & devices** — visits by country and by device type, with the mobile share. For a conference site a growing mobile share means the ticket flow must be checked on phones first.
- **Pages** — top entry pages and all pages by visits and page depth.
- **Exit pages** — where users leave. High exits on a page that contains a purchase form is a signal to check the form; high exits on a "thank you" page is normal.

## Data grids

Every table on these pages supports:

- **column sorting** — click a header;
- **search** — the input above the table filters rows (handy for long UTM lists);
- **pagination** — page through large result sets;
- **CSV export** — the button in the table header downloads the current view (the filename carries the preset and period).

Numbers follow the active interface locale: with RU selected, dates are DD.MM.YYYY and thousands are space-separated; with EN, English rules apply.

## Use cases

- **"Where did my buyers come from?"** — open the primary goal's detail page for the channel view, then **Traffic → UTM** to name the exact campaigns.
- **Compare two campaigns** — search the UTM table for both campaign names, note visits and reaches, and divide reaches by visits for each; the higher conversion wins, not the higher volume.
- **Check a suspicious traffic spike** — sort UTM by visits for the spike day, look for one dominant unknown source, then verify bounce rate; a 90%+ bounce with huge visits is bot traffic.
- **Mobile audit** — open **Behavior → devices**, note the mobile share, then walk the live funnel stages 3→4 on a phone.

## Troubleshooting

- **The UTM table is empty** — either no tagged traffic existed in the period, or the sync has not run since; check **History** and run a manual sync if needed.
- **Channel numbers differ from the Metrika report** — the cabinet uses the last-signature attribution of the daily sync; compare with the same attribution model in Metrika before alarming anyone.
- **CSV opens with broken characters in Excel** — the export is UTF-8 with BOM; if your tool still misreads it, import the file explicitly as UTF-8.
