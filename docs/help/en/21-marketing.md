---
title: Marketing & influence partners
section: Working with data
order: 21
summary: The weekly marketing grid mirroring the Google Sheet «стата»: 13 weeks, 13 metrics, value sources, manual entry, automatic Metrika sync, past-period backfill and CSV export.
---

# Marketing & influence partners

The `Cabinet → Work → Marketing` page (`/app/marketing`) is the dashboard replacement for the
Google Sheet [«Инфопартнеры ProductCamp | лето 2026», sheet «стата»](https://docs.google.com/spreadsheets/d/1GoHbMiU0GsyLI1RZIOMLdO32Gdxrj8X27KlEJ6voInE).
The same weekly grid with automatic filling of everything Metrika can compute, value history
and protection of manual edits.

## Grid structure

The grid copies the sheet 1-to-1: **13 campaign weeks** in columns, **13 metrics** in rows
split into two sections. Irregular month splits are kept exactly as in the source (e.g.
«Week 3 (Aug 15-23)» spans nine days) so dashboard and sheet numbers always match.

| Section | Metrics (in order) |
| ------- | ------------------ |
| Content marketing | Landing page visits, email link clicks, posts published (total), Telegram link clicks, site goal reaches, total leads, payments, B2B leads, planned B2B tickets |
| Influence partners | partner posts published, speaker posts published, ambassadors, referral clicks |

Weeks: Aug 1–7, 8–14, 15–23, 24–30 · Aug 31–Sep 6, 7–13, 14–20, 21–27 · Sep 28–Oct 4, 5–11,
12–18, 19–25, Oct 26–Nov 1. Hover a week header for exact dates (e.g. «2026-08-31 …
2026-09-06»).

## Value sources: manual > import > metrika

Every cell has a source shown as a coloured left border and a hover tooltip:

| Source | Colour | Meaning | Who can change it |
| ------ | ------ | ------- | ----------------- |
| `manual` | orange | entered/corrected by a person in the dashboard | any user; the sync **never** overwrites |
| `import` | sky | loaded from the Google Sheet by the import script | import may refresh; sync may not |
| `metrika` | green | recomputed by the sync from Metrika/DB data | the next sync overwrites |

Priority: **manual > import > metrika**. The sync fills only empty and metrika-sourced cells;
the import refreshes empty and metrika-sourced cells; a manual value is untouchable. The
tooltip also shows **who and when** last changed the value.

## Which metrics are computed automatically

A green dot next to a row name means «filled by the sync»:

- **Landing page visits** — sum of `channel_stats` visits for the week (all channels);
- **Site goal reaches** — sum of goal reaches for the week;
- **Payments** — confirmed money: B2C payment tickets (entered manually or imported from CSV)
  **plus** paid B2B deal tickets. The «lead ≠ payment» invariant: a lead is a Metrika goal
  reach, a payment is money;
- **B2B leads** — the number of B2B deals added during the week (by their added date).

The remaining rows (posts, email/Telegram clicks, planned tickets, ambassadors, referrals)
are content-plan facts entered manually by an analyst.

## Manual entry: how to correct a cell

1. Click a cell — it becomes editable.
2. Type a number (decimal point or comma both work).
3. **Enter** or leaving the field — save; **Esc** — cancel.
4. An invalid value (not a number or negative) is not saved — the cell text turns red.

A saved manual value survives any sync: after a full Metrika resync the analyst's edit stays.
The tooltip then shows your e-mail and the edit time. Cells with no data show a dash and can
be filled manually at any time.

## Sync and past-period backfill (admin)

The **Sync** button is visible to admins only:

1. Without parameters — recompute the syncable rows from already loaded data (fast, no
   Metrika calls).
2. To backfill past periods: first run a regular Metrika sync for the window
   (`Administration → Metrika and data`), then press Sync. A single-call programmatic option:
   `POST /api/marketing/weekly/sync {"from":"2026-08-01","to":"2026-10-25"}` — window backfill
   and recompute in one request (spends Metrika quota; use `METRIKA_REQUEST_DELAY_MS` pacing
   for a year-long window).

After the sync a message shows how many cells were updated and how many weeks remain empty.
A week with no source data at all (e.g. before the site launch) stays **empty, not zero** —
zero would mean «data exists, no events», which is false.

## Importing the real sheet data

The one-off sheet values (August–October) are already imported (112 cells, source `import`).
If the sheet changed, reload it on the server:

```bash
pnpm --filter @pca/backend marketing:import
```

A repeated import refreshes `import`- and `metrika`-cells and never touches manual ones. The
transcription lives in `code/backend/src/marketing/sheet-data.ts`.

## CSV export

The **CSV** button downloads the file in the sheet layout: rows — sections and metrics,
columns — weeks with dates, UTF-8 with BOM (opens in Excel/Google Sheets as-is). Empty cells
stay empty.

## FAQ

- **«Why is a week empty instead of 0?»** — there is no source data (usually before the site
  launch). Backfill Metrika for that period or enter the value manually.
- **«My edit disappeared after a sync»** — manual edits never disappear; check you are looking
  at the same cell — the tooltip shows source, author and time of the last change.
- **«There is no Sync button»** — you are signed in as an analyst; ask an administrator or
  enter the data manually (an equally valid workflow).
- **«Numbers do not match Metrika»** — the grid aggregates by the sheet weeks, not calendar
  weeks; compare against Metrika for the same dates (see the week header tooltip).
