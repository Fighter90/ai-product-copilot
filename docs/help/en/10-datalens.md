---
title: DataLens
section: Integrations
order: 10
summary: What Yandex DataLens is, CSV dataset connection, the dataset catalog, first chart and dashboard, alerts and webhooks.
---

# DataLens

The cabinet integrates with **Yandex DataLens** — Yandex's BI service for charts and dashboards — through ready CSV datasets and a webhook receiver. The DataLens page in the cabinet (`/app/datalens`) is the bridge: it serves the datasets and manages the update loop.

![DataLens screenshot](/screenshots/16-datalens.png)
_The DataLens page: dataset catalog, export links and the "Request update" button._

## What DataLens is good for here

The cabinet's own dashboards answer the standard questions. DataLens is the tool when you need:

- custom chart combinations the cabinet does not have;
- a shareable dashboard for people without cabinet accounts;
- multi-dataset views (for example, B2B amounts next to online channel dynamics).

## Step-by-step: connecting CSV data

The connection type in DataLens is **Files**:

1. Sign in to [datalens.ru](https://datalens.ru) with a Yandex account.
2. Create a **Connection** → choose **Files**.
3. Download the datasets you need from the cabinet's DataLens page (CSV, UTF-8 with BOM). Use the `from` / `to` parameters or the UI controls to limit the period.
4. Upload the files into the Files connection and save it.
5. Create a **Dataset** on top of the connection, then **Charts** and a **Dashboard**.

Technical export endpoint (sign-in required):
`GET /api/integrations/datalens/export/{datasetId}?from=YYYY-MM-DD&to=YYYY-MM-DD`

## Dataset catalog

| Dataset id         | Contents                                                                               | Key fields                                                   | Period                     |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| `channels_daily`   | Channels by day: visits, users, bounce rate, avg duration, KPI-goal orders, conversion | `date`, `channel`, `visits`, `orders`, `conversion_rate`     | ranged                     |
| `utm_daily`        | UTM combinations by day: visits, users, orders                                         | `date`, `utm_source`, `utm_medium`, `utm_campaign`, `orders` | ranged                     |
| `pages_daily`      | Entry pages by day: visits, users, bounce rate, orders                                 | `date`, `page`, `visits`, `bounce_rate`                      | ranged                     |
| `geo_device_daily` | Country × device by day: visits, users, orders                                         | `date`, `country`, `device`, `orders`                        | ranged                     |
| `b2b_deals`        | B2B deals: company, tickets, stage, amount, dates                                      | `company`, `tickets`, `stage`, `amount_rub`, `date_paid`     | full snapshot (not ranged) |

All ranged datasets are one row per day per dimension combination — ideal for DataLens line charts and pivot tables. Note that B2B is a manual table and updates only when a deal is edited in the cabinet.

## Building your first chart and dashboard

1. In DataLens, open your dataset (for example `channels_daily`).
2. Drag `date` to X and `visits` to Y — a line chart appears.
3. Add `channel` to the color/series slot to split lines per channel.
4. Duplicate the chart with `orders` instead of `visits` for the money view.
5. Create a **Dashboard**, add both charts, and set a date **selector** widget linked to the charts' `date` field.
6. Share the dashboard with your team or publish it per your DataLens access policy.

## Provisioning via the Public API

`scripts/push-datalens.mjs` builds a live DataLens dashboard on Yandex Metrika data (Public API `https://api.datalens.tech`, API version 3). Object names are in Russian, as they appear in DataLens:

| Object     | Name                        | Contents                                                                                                                                                             |
| ---------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workbook   | ProductCamp Analytics       | —                                                                                                                                                                    |
| Connection | Яндекс.Метрика 54280963     | Direct connection to counter 54280963 (DataLens refreshes the data itself)                                                                                           |
| Dataset    | Метрика — визиты по дням    | Dimensions: visit date (`date`), last significant traffic source (`traffic_source`). Measures: visits (`visits`), users (`users`), any-goal reaches (`goal_reaches`) |
| Charts     | 5 charts                    | Visits and users by day (lines), goal reaches by day (line), visits by traffic source (columns), traffic structure (donut), sources: visits, users, goals (table)    |
| Dashboard  | ProductCamp — трафик и цели | A “Period” selector (last 90 days by default) and the five charts                                                                                                    |

Running it:

1. You need access to the DataLens organisation with the `datalens.editor` role. The script takes the IAM token from `DATALENS_IAM_TOKEN`; if it is not set, it runs `yc iam create-token` itself (the token lives ≤ 12 h and is never printed).
2. Run `node scripts/push-datalens.mjs`. Options: `--workbook <id>` (or `DATALENS_WORKBOOK_ID`) to target a specific workbook; `DATALENS_ORG_ID` for another organisation (defaults to the ProductCamp organisation).
3. The Metrika OAuth token is needed only to create the connection or with `--update-connection` (refresh the token of the existing connection). The script reads it from `METRIKA_OAUTH_TOKEN` or `YANDEX_OAUTH_TOKEN` in `.env`.
4. At the end it prints a table of objects (created / updated / reused) with their ids, plus links to the workbook and the dashboard.

Re-running never creates duplicates: the workbook is looked up by title, everything else by name inside the workbook. Existing charts and the dashboard are overwritten with the configuration from the script; the dataset is rebuilt only if its fields differ from the expected ones (force it with `--rebuild-dataset`). Manual edits to these charts or the dashboard in the DataLens UI are overwritten on the next run — save your variant under a different name to keep it.

What the API cannot do: the Public API has no Files connection type, so the cabinet's CSV datasets (see above) can only be uploaded through the DataLens UI.

## Alerts and webhooks

DataLens charts can send **alerts** (a metric crosses a threshold) to an arbitrary URL. The cabinet receives them:

![Admin integrations screenshot](/screenshots/20-admin-integrations.png)
_The webhook token lives in Admin → Integrations — copy it from here into the DataLens alert URL._

- URL: `POST /api/integrations/datalens/webhook/{token}`
- The `{token}` is generated in **Admin → Integrations** — that is where you copy it from when filling the alert URL in DataLens.
- Incoming notifications appear in the cabinet (the bell icon) and in the integration log, so a DataLens alert and a cabinet notification arrive in one place.

## "Request update" flow

Datasets are CSV snapshots of the daily database — they age between syncs. If your DataLens dashboard looks stale:

1. Press **Request update** on the cabinet's DataLens page (sends `POST /api/integrations/datalens/request`).
2. Administrators get the notification and run a sync (or confirm the 3-hour schedule covers it).
3. After the sync, re-download the CSV files and refresh the Files connection in DataLens — DataLens does not pull files automatically, so the last step is manual by design.

## Use cases

- **Hook up a DataLens dashboard** — download all four ranged datasets once, build the connection, and reproduce the cabinet's KPI view as a shareable board.
- **Threshold alert for ticket pace** — create a chart of daily KPI orders in DataLens, set an alert on a minimum daily value, and point it at the cabinet webhook so the team sees it in the bell.
- **B2B + online combined view** — join `b2b_deals` with `channels_daily` aggregates in one dashboard to show total conference revenue dynamics.

## Troubleshooting

- **CSV opens with mojibake in Excel** — the files are UTF-8 with BOM; import explicitly as UTF-8 if your tool ignores the BOM.
- **Webhook alerts never arrive** — verify the token in the URL matches **Admin → Integrations**, and check the integration log for rejected calls (a wrong token is logged, not silent).
- **Dashboard shows old numbers after a sync** — DataLens caches uploaded files; re-download the CSVs and re-upload them into the Files connection.
