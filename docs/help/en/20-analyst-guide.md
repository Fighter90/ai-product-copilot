---
title: Analyst guide
section: Basics
order: 20
summary: Every cabinet page for the Analyst role — what it shows and what each control does, plus a daily and weekly routine.
---

# Analyst guide

Analysts have the whole cabinet except “Administration”. If a page has no data, it usually needs a sync or a setting that an administrator handles (see “Common problems” at the end).

Some analytics pages (Overview, Traffic, Behaviour, Funnel & B2B, KPI, Report, History, B2B) still have Russian labels in places; the English names below follow the sidebar and the meaning of each element.

## Shared cabinet elements

- **Sidebar** — “Monitoring”, “Analytics”, “Work”; collapsible. On phones — bottom tabs and “More”.
- **Period filter** (on monitoring, analytics and Report pages): presets 7d / 14d / 30d / 90d / 1y, the “📅 Dates” button — a custom “From / To” range and “Apply” (max 365 days, start not in the future). Default — the last 14 days. Pages without the filter use the last selected period.
- **Segment** B2C / B2C+B2B / B2B — filters channels and UTM. Corporate traffic is not tagged in Metrika, so in the B2B segment a hint points to “B2B deals” and the B2B tab on “KPI & forecast”.
- **“Archived goals” checkbox** — per its tooltip, shows deleted or archived Metrika goals; off by default.
- **Header**: RU/EN language toggle, theme (🌙/☀️), notification bell, your name and role, sign-out button.
- **“→ hypothesis”** links on Overview and Traffic carry the context (segment, problem, evidence) into a hypothesis draft on the Report page.

Two data sources: **Monitoring** pages (Live, Metrika goals, pc-goals funnel, Data) query Metrika directly in real time; **Analytics** pages and the report read the local database filled by the sync (every 3 hours on the server).

## Overview (`/app`)

A period summary from the local database.

- **“Where to start”** — a three-step hint card, closable.
- **KPI strip** — paid-ticket target, applications or orders for the primary goal (with an “application ≠ payment” note when the goal is not a purchase), B2B paid, gap to target.
- **Weekly digest** — visits and goal reaches over 7 days with week-over-week change (▲/▼), number of channels, best channel.
- Charts: daily visits and applications, channel mix, top countries, device share.
- **UTM breakdown** with coverage %; below 70% a warning says part of the traffic is unattributed.
- **Top entry and exit pages**.
- **“Weak spots”** — channels with traffic but below-average conversion, each with a “→ hypothesis” link.

## Live (`/app/live`)

Live Metrika data, auto-refresh every 60 seconds.

- Control strip: “Updated N s ago”, **“Pause” / “Resume”** auto-refresh, a manual refresh ⟳ button, the **“Include test traffic”** checkbox (robots and service visits are excluded by default).
- Cards: Visits, Users, Pageviews, Bounce (%), Avg time.
- Chart “Visits by hour” (single day) or “Visits by day”.
- A “Participant funnel (pc-goals)” card with “Open →”.

If you see “Metrika is not connected”, an administrator must set the token and counter.

## Metrika goals (`/app/goals`) and goal detail

- Same control strip as Live (pause, refresh, test traffic).
- Cards: visits, number of live, sleeping, dead goals and duplicates.
- Statuses: **live** — reaches in the last 14 days; **sleeping** — none in 14 but some in 90; **dead** — none in 90 days. Δ — change vs the previous period of equal length.
- Table: Goal (a “duplicate” badge), Type, JS event, Reaches, Conversion, Previous period, Δ, 14 days, 90 days, Status. The “Status” dropdown in the table toolbar filters rows (all / live / sleeping / dead / duplicates).
- Table features (same as Data and the audit log): search, sort by clicking a header, “Columns” to show/hide, pagination, totals row, “Download CSV” (visible columns and filtered rows).
- **Clicking a row** opens `/app/goals/<ID>`: “← All goals”, Reaches / Visits / Conversion cards, a “Reaches over time” chart, tables by source, UTM source, entry page, devices, countries, and the goal conditions.

## pc-goals funnel (`/app/funnel-live`)

A live funnel of site JS events: visit → tickets → CTA → registration → cart → order.

- Each step shows the absolute number, % “from previous step” and % “from visits”.
- “Ticket tariffs” — bars per tariff Standard / Optimal / Max: picked tariff, clicked “Buy”, went to checkout.
- “Applications by role” — volunteer, speaker, C-level, partner, etc.
- If the counter lacks goals for some events, a warning lists them.
- Remember: an order ≠ a payment; payments are tracked separately (B2B deals).

## Traffic (`/app/traffic`)

- Channel visits — bars per channel plus insight chips with “→ hypothesis”.
- Channel visits vs applications — which traffic really converts.
- Source → campaign → applications flow — a UTM Sankey diagram; “⛶ fullscreen” and “✕ close”. Traffic without UTM tags is not in the flow.
- Channel table (visits, users, applications, CR) and the UTM table.
- Under each chart — “correct / caveat / advice” notes.

## Behaviour (`/app/behavior`)

- “Key observations” — automatic page findings.
- Charts: entry-page conversion, entry-page bounce, exit-page bounce.
- Entry and exit page tables (the latter when Metrika returns data).
- “Recommendations” — what to fix on pages with high bounce or low conversion.

## Funnel & B2B (`/app/funnel`)

“Application ≠ payment”: Visits → B2C applications → B2B pipeline → B2B paid.

- Conversion funnel and funnel-loss analysis — where most is lost.
- Funnel by channel (visits vs applications), conversion by country.
- B2B deals by stage, problem pages, key observations, recommendations.

## KPI & forecast (`/app/kpi`)

- ProductCamp goals — a progress ring toward 300 paid tickets (B2B paid + purchase goals) and percent complete.
- A B2B deals table and the goal forecast.
- **“What if”**, “Forecast” tab: current orders per day, target date and deviation from the deadline. Sliders **“Traffic: +N%”** (0–50%, step 5) and **“Conversion: +N pp”** (0–5, step 0.5) instantly recompute the scenario and the Fact / Forecast / Target chart. The model is linear and ignores seasonality; the deadline is the period end plus two period lengths.
- “B2B” tab: pipeline by stage (Lead, Negotiation, Invoiced, Paid), B2B contribution to the target, deal count, amount and average ticket.
- “What to do” — recommendations toward the goal.

## Data (`/app/explore/<preset>`)

Detailed live Metrika tables. Preset tabs: Sources, Search engines, UTM tags, Entry pages, Exit pages, Devices & OS, Browsers, Geography, Referring sites, By day, By hour.

- Chart: time bars for By day / By hour, horizontal top bars for the rest.
- A table with search, sorting, columns and “Download CSV” (file named by preset and period).
- **“Goal for columns”** — which goal feeds the reaches and conversion columns (default `reg_step1`); goals are sorted by reaches.

## Report (`/app/report`)

An immutable data snapshot for a period, DOCX/PDF and AI. Buttons: build snapshot, rebuild report, “Export DOCX”, “Export PDF”, generate AI analysis; a “Hypothesis draft” card with “Remove draft”. The full pipeline and step-by-step instructions — “How reports are built” (`/help/reports-how`).

## History (`/app/history`)

Saved snapshots: Report (name from the period and a short id), Created, Period, “View”. Clicking the name or “View” opens the snapshot on the Report page without regenerating — with saved AI texts and hypotheses. The total count is shown below.

## B2B deals (`/app/b2b`)

Manual tracking of corporate sales (Metrika does not see them).

- A kanban of four stages lead → negotiation → invoiced → paid: tickets and deal count per stage.
- Totals: tickets in the pipeline and paid (counted in the 300 KPI).
- Form Company, Tickets, Stage → Add.
- “Expand full table (N)” — a side panel with all deals: change the stage via the row dropdown, delete.

## DataLens (`/app/datalens`)

- “Datasets (CSV)” — five datasets (channels, UTM, pages, geo/devices, B2B deals) with column descriptions and “Download CSV” for the current filter period; headers follow the UI language. UTF-8, comma-separated. Every export is logged.
- “Raw Metrika data directly” — how to connect the native Metrika connector in DataLens.
- “Team DataLens dashboards” — links added by an administrator.
- “Ask an administrator to connect” — a note field and the “Ask” button: administrators get a notification (up to 3 requests per hour). Details — “DataLens” (`/help/datalens`).

## Help (`/help`)

Left — contents by section, centre — the article, right — “On this page”. “Search help” searches all articles in the current language. Help is available without signing in.

## Assistant (bottom-right button)

Answers **only from the help articles**: it finds matching fragments and phrases an answer via the AI provider. Under the answer — “Sources” linking to the articles. If AI is unavailable — a “search mode” label and the best fragments. Example questions are shown in the window. Limit — 20 questions per 10 minutes (guests — 5). Questions are not stored.

## Language, theme, notifications

- RU/EN — header toggle; saved in the browser and in your profile.
- Theme — 🌙/☀️, applied instantly, charts recolour.
- Bell — notifications (e.g. DataLens replies); “Mark as read”.
- Details — “Language and theme” (`/help/prefs`).

## Daily routine (10–15 minutes)

1. Live — today's visits and goals vs yesterday. A sharp drop — check the test-traffic checkbox and tell an administrator.
2. Metrika goals — any key goals newly “dead” or “sleeping”?
3. pc-goals funnel — which step loses the most today.
4. Overview with 7d — “Weak spots”; send anything interesting “→ hypothesis”.

## Weekly routine (≈1 hour)

1. Period 7d (or 14d) → Traffic and Behaviour: which channels and pages rose or fell, UTM coverage ≥ 70%.
2. KPI & forecast — are we on track; try scenarios with the “What if” sliders.
3. B2B deals — update stages and add new deals.
4. Report → build a weekly snapshot → wait for AI hypotheses → optionally generate AI analysis → “Export DOCX”.
5. Compare with the previous snapshot in History; turn findings into hypotheses and Decision Log entries.
6. Need custom dashboards — CSV on the DataLens page.

## Common problems

| Symptom                              | What to do                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| “Metrika is not connected” on Live   | ask an administrator to set the token and counter                              |
| Analytics empty while Live works     | no sync for the period — ask an administrator to refresh data                  |
| “No access” on a page                | it is an administrator section                                                 |
| AI analysis or assistant unavailable | an administrator configures a provider (`/help/llm-keys`)                      |
| Report numbers differ from Live      | the report is a frozen snapshot from the database; Live is today's live data   |
| CSV for the wrong period             | the period comes from the filter — set it on an analytics page and re-download |
