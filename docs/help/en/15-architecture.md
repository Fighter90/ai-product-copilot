---
title: How the product works
section: Basics
order: 15
summary: Architecture for analysts — layers, data flow, real-time vs daily data, roles, security and schedules. No code.
---

# How the product works

You do not need this article to use the cabinet — you need it to **trust** it: where numbers come from, when they are fresh, who can see what, and what happens on each click.

## The layers

The product has four layers, each with one job:

![Overview screenshot](/screenshots/03-overview.png)
_Everything you see is the client layer drawing data delivered by the API._

| Layer                 | Job                                           | Examples of what lives here                               |
| --------------------- | --------------------------------------------- | --------------------------------------------------------- |
| **Client (React)**    | Draws every screen you see                    | dashboards, tables, charts, the header switches           |
| **API (Fastify)**     | Serves data to the client, enforces roles     | `/api/...` requests behind every page                     |
| **Database (SQLite)** | Stores synced daily data and your own records | daily visits, goals, B2B deals, snapshots, users          |
| **Sources**           | External systems the cabinet reads from       | Yandex Metrika (counter 54280963), DataLens, AI providers |

One more process runs beside the application: the **sync job** (scheduled via systemd), which pulls data from Metrika into the database every **30 minutes**.

## What happens when you open a page

1. The client asks the API for the page's data, passing your session, the header period, segment and goal settings.
2. The API checks your role: analyst or administrator — a rejected role returns 403 before any data leaves the server.
3. The API reads the **local database** (fast, always available) or — for Live pages — queries the **Metrika Reporting API** directly.
4. The client draws tables and charts; nothing is computed in the browser beyond formatting.

Two consequences: dashboards remain fast even for long periods (the heavy aggregation happened at sync time), and if Metrika is temporarily down, all daily pages keep working — only Live pages would be affected.

## Where data lives

| Data                                                   | Where                        | How it arrives                |
| ------------------------------------------------------ | ---------------------------- | ----------------------------- |
| Daily visits, channels, UTM, geo/devices, pages, exits | SQLite (database)            | 3-hour sync from Metrika      |
| Goal catalog and reaches per day                       | SQLite                       | same sync                     |
| Today's numbers                                        | Metrika Reporting API        | fetched live, not stored      |
| B2B deals, snapshots, hypotheses, decisions            | SQLite                       | entered by you in the cabinet |
| Users, settings, AI provider keys                      | SQLite                       | admin UI                      |
| Help texts                                             | markdown files on the server | deployed with the product     |

The database is the single source for reports and DataLens exports; Metrika remains the source of truth for raw traffic.

## Real-time vs daily data

|              | Daily pages                       | Live pages                      |
| ------------ | --------------------------------- | ------------------------------- |
| Source       | local database                    | Metrika Reporting API           |
| Freshness    | up to 30 minutes old              | current                         |
| Availability | always (works if Metrika is down) | requires Metrika                |
| Use for      | analysis, reports, comparisons    | operational monitoring of today |

Rule of thumb: **decide** on daily data, **watch** on live data. Comparing a live number to a daily number for the same day will show differences until the day is complete and synced.

## Roles, point by point

Role checks exist in two places — the interface (admin sections are hidden for analysts) and the API (403 on every admin endpoint) — so hiding alone is never the protection.

| Action                                             | Analyst | Administrator |
| -------------------------------------------------- | ------- | ------------- |
| View dashboards, Live, goals, Explore              | yes     | yes           |
| Generate reports, snapshots, DOCX/PDF              | yes     | yes           |
| Work with B2B deals, DataLens exports              | yes     | yes           |
| Ask the assistant, run AI analysis                 | yes     | yes           |
| Create/edit users                                  | no      | yes           |
| Configure AI providers (read/write keys)           | no      | yes           |
| Metrika settings, manual sync, goal create/archive | no      | yes           |
| Integrations (webhook token), audit log            | no      | yes           |

Every sign-in, settings change and admin action is written to the **audit log**, which even administrators cannot edit — that is what makes shared admin access safe.

![Admin audit screenshot](/screenshots/21-admin-audit.png)
_The audit log: the immutable accountability layer behind the roles table._

## Secret encryption

AI provider API keys are never stored in plain text: they are encrypted with AES-256-GCM using the server's master secret (`APP_SECRET`). The API answers always mask keys — a full key is never sent back to any client, including administrators. DataLens webhook tokens are separate credentials, generated and rotated in **Admin → Integrations**.

## Schedules

The sync process is managed from the admin panel, where its last result is visible:

![Admin Metrika screenshot](/screenshots/19-admin-metrika.png)
_Admin → Yandex Metrika: the control point of the 3-hour sync and manual re-syncs._

| Process              | Schedule                          | What it does                                                      |
| -------------------- | --------------------------------- | ----------------------------------------------------------------- |
| Metrika sync         | every 30 minutes (systemd)        | pulls daily rows: goals, channels, UTM, geo/devices, pages, exits |
| Session lifetime     | 7 days                            | then sign-in again                                                |
| Assistant rate limit | 20 questions / 10 min per address | protects the AI provider quota                                    |
| Backups              | per deployment policy             | the SQLite file is a single file — copying it is the backup       |

The practical meaning of the 3-hour sync: morning numbers for "yesterday" are complete, but "today" belongs to the Live pages until the day closes.

## The DataLens path

DataLens integration reads from the same database: the export endpoint produces CSV files from daily tables, and webhook calls from DataLens alerts arrive at a token-protected endpoint whose events surface in the cabinet bell. Nothing in DataLens can write back into the cabinet — the data flow is one-directional by design.

## Use cases

- **"Can I trust this number?"** — locate it in the "Where data lives" table; if it is daily data, check **History** for the sync that produced it.
- **Planning a Live wall-screen** — understand it depends on Metrika availability; daily dashboards are the fallback when Metrika is down.
- **Security review** — walk the roles table and the secret-encryption section; both describe enforced behavior, not conventions.

## Troubleshooting

- **Everything is empty on daily pages but Live works** — the sync has not produced rows yet; an administrator should run a manual sync and check the systemd job.
- **Admin API returns 403 for an analyst script** — by design; automation needs an administrator account and must still respect the audit trail.
- **A restored backup shows old B2B deals** — deals live only in the database file; restore the newest copy and re-enter only what happened after it.
