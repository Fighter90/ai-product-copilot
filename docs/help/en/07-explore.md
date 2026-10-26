---
title: Explore
section: Dashboard
order: 7
summary: Ready-made data presets with detailed tables, charts and CSV export.
---

# Explore

The Explore section (`/app/explore/:preset`) offers ready-made data cuts as detailed tables with a chart. It sits between the overview dashboards and raw exports: more detail than Overview, faster than building a report.

![Explore screenshot](/screenshots/12-explore.png)
_An Explore preset: chart on top, detailed sortable table below._

## Available presets

| Preset     | Dimension                      | Typical question                |
| ---------- | ------------------------------ | ------------------------------- |
| `sources`  | Traffic source                 | Where do visits come from       |
| `engines`  | Search engine                  | Which search engine brings more |
| `utm`      | utm_source / medium / campaign | Which campaign performed        |
| `pages`    | Entry page                     | Which pages start visits        |
| `exits`    | Exit page                      | Where do people leave           |
| `devices`  | Device + OS                    | Mobile vs desktop picture       |
| `browsers` | Browser                        | What to test the site in        |
| `geo`      | Country + city                 | Where is the audience located   |
| `referers` | Referral source                | Which sites link to us          |
| `days`     | Date                           | Day-by-day dynamics             |
| `hours`    | Hour of day                    | When the audience is active     |

Each preset page shows a chart (columns for categorical cuts, a line for `days` / `hours`), the detailed table, and the CSV export button.

## How to use

1. Pick a preset in the section sidebar (the URL changes to `/app/explore/sources`, `/app/explore/utm` and so on — presets are bookmarkable).
2. Narrow the period with the header switch; the table and chart update together.
3. Sort the table by the column you care about; use search for long lists (UTM campaigns, pages).
4. Export the current view via the CSV button for spreadsheets or DataLens files.
5. If the preset filters by a goal, pick it in the goal selector — the table then counts that goal's reaches per row.

![Goals page screenshot](/screenshots/05-goals.png)
_The goal selector draws on the same catalog as the Goals page — pick a goal here to count its reaches per row._

## When to use Explore

- **Fast one-off answers** — "which campaign brought most visits", "which devices view the site", "at what hours do we get ticket purchases" (`hours` preset with a purchase goal selected).
- **Deep dive after an anomaly** — an Overview spike → Explore `days` to locate the exact day → Explore `utm` to find the source.
- **Ad-hoc data pulls** — the CSV export is the quickest way to hand a colleague an exact cut.

For recurring, formatted deliverables use **Report** instead; for BI dashboards use **DataLens**.

## Use cases

- **"Where did my buyers come from?"** — open `sources`, select the primary goal, sort by reaches; then open `utm` and repeat the sort for campaign-level names.
- **Weekend vs weekday activity** — `days` preset over a 90-day period to see the weekly rhythm before scheduling a mailing.
- **Hour of the mailing** — `hours` preset over the last 30 days to find the hour band with peak visits and conversions.

## Troubleshooting

- **Unknown preset (404)** — the preset name in the URL is not in the whitelist above; pick the preset from the sidebar instead of editing the URL by hand.
- **Rows show "none" or dashes** — the dimension is genuinely unset for that traffic (untagged campaigns, direct visits); it is data, not a defect.
- **The chart is empty but the table has rows** — categorical presets with hundreds of rows collapse the chart; rely on the table and export in that case.
