---
title: History and B2B
section: Reports
order: 9
summary: The daily data archive — what was synced and when — and the B2B deal tracker.
---

# History and B2B

These two pages cover the "long memory" of the cabinet: History holds the synced daily series, B2B holds manually tracked partner deals.

## History

The History page (`/app/history`) shows daily series from the local database: visits, goal reaches and sync events.

![History screenshot](/screenshots/14-history.png)
_Daily archive: visits, goals and sync activity per day._

### What it is for

- **Sync audit** — "was yesterday synced? when?" The sync events (manual and scheduled, every 30 minutes) are recorded per day, so a missing row means a missing sync, not missing traffic.
- **Any-date comparison** — compare two arbitrary dates without rebuilding periods: the daily rows are the ground truth the dashboards aggregate from.
- **Gap detection before reports** — before generating a report snapshot, scan History for zero-days; a report over a range with a gap will understate results.

### How to work with it

1. Open History and set the period covering the dates in question.
2. Look for days with no data rows or no sync marker.
3. If a gap is found, run **Admin → Yandex Metrika → Sync** (administrator) — the daily rows are re-fetched and the gap closes.
4. Re-check the dashboard; if numbers still differ from Metrika, compare the same period and goal as described in [Metrics and formulas](#).

## B2B

The B2B section (`/app/b2b`) tracks partner and corporate deals: company, number of tickets, stage, amount and payment dates.

![B2B screenshot](/screenshots/15-b2b.png)
_B2B deal list with stages, ticket counts and amounts._

### Working with deals

1. **Add** a deal: company name, tickets, amount, current stage.
2. Move deals through stages by editing the record — the stage column is the pipeline (negotiation → invoice → paid).
3. Set the payment date when the deal closes; unpaid deals with a passed payment date are your follow-up list.
4. Sum the tickets of paid deals and compare with the online ticket KPI — together they form the full conference sales picture.

### Where the data lives

B2B deals are stored in the same local database but are **independent of Metrika**: nothing on this page comes from the counter, and nothing you type here is sent anywhere. The deals are also exported to DataLens via the `b2b_deals` dataset (see [DataLens](#)).

A practical consequence: the B2B page keeps working even during a Metrika outage, and its numbers never change under you because of a re-sync — deals move only when a human moves them, and the audit log records who.

## Use cases

- **"What was synced and when?"** — History is the single place to answer this; filter to the day in question and read the sync events.
- **Partner pipeline review** — sort B2B by amount, group by stage, and walk the "invoiced but unpaid" list in the weekly partner call.
- **Full sales reconciliation** — paid B2B tickets + KPI goal reaches = total tickets; reconcile against the organizer's ticket system monthly.

## Troubleshooting

- **A day is missing in History** — the sync for that day did not run or failed; an administrator should check the sync service and re-run a manual sync.
- **B2B deal disappeared after an edit** — edits are logged in **Admin → Audit**; check the log before re-entering data.
- **B2B tickets don't match the partner's word** — the page is a manual tracker; it is only as current as the last edit, and every change is attributable in the audit log.

## Report history

Every report build stores a snapshot (period, date, size) — from History you can open the
preview, export DOCX/PDF again or delete the slice. A snapshot is immutable: a rebuild creates
a new one. This protects against «the numbers changed after the report was sent».

## B2B deals

The manual-entry registry: Metrika does not see B2B, so deals are tracked here (the
`b2b_manual` table). Columns: company, tickets, amount, stage (Lead → Negotiation → Invoiced →
Paid), added/paid dates, contact. Paid tickets enter the «300 paid» KPI and the marketing grid
«payments» row.

### CSV history import

The import button accepts
`company,tickets,stage,date_added[,date_paid[,amount,email,notes]]` — for moving deals from a
CRM/sheet covering the period before the dashboard launch. Duplicates (same company + date +
tickets) are skipped — re-importing is safe. Row errors are reported with line numbers.

### Data coverage

The coverage indicator shows first/last dates of each series (b2b, b2c, Metrika) and gaps
≥ 3 days — close them with imports or a window sync so KPI and the forecast cover the full
period.
