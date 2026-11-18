# User Guide

> Document version: v3.4.64 (2026-11-18). Live: <https://dashboardcamp.ru>.
> Language: 🇬🇧 English (mirror: [docs/user-guide.md](../user-guide.md)).
> Companion docs: [Scenarios](scenarios.md) · [Troubleshooting](troubleshooting.md) · [Glossary](glossary.md) · [FAQ](faq.md) · [Admin Guide](admin-guide.md).

---

## Contents

1. [What it is and why](#1-what-it-is-and-why)
2. [Access and roles](#2-access-and-roles)
3. [Quick start (first 5 minutes)](#3-quick-start-first-5-minutes)
4. [Dashboard UI](#4-dashboard-ui)
5. [Monitoring](#5-monitoring)
6. [Analytics](#6-analytics)
7. [Work](#7-work)
8. [System messages and what they mean](#8-system-messages-and-what-they-mean)
9. [Rules to remember](#9-rules-to-remember)

---

## 1. What it is and why

**ProductCamp Analytics Copilot** is the analyst's workspace for the «Conversions & Leadgen» track: one tool instead of manual Metrika Excel exports, hypotheses buried in chats, and numbers that never reconcile.

The value chain:

```
Yandex.Metrika ──sync──▶ SQLite (day-by-day history)
                              │
        Dashboard ◀───────────┤  (overview, funnel, traffic, behavior, live)
                              │
   Hypotheses (problems/solutions) ┤  (kanban, ICE prioritization)
                              │
        Decisions (Decision Log) ┤  (what we decided and why)
                              │
        DOCX/PDF report ◀─────┘  (immutable snapshot, byte-deterministic)
```

Three properties that justify using this tool:

1. **Traceability.** Every number on screen traces back to the original Metrika response (`raw_responses` in SQLite). No «where did this number come from?».
2. **Report determinism.** The report renders from an immutable snapshot: one `snapshotId` → byte-identical DOCX/PDF. The file you sent can always be reproduced 1:1.
3. **Methodology.** A hypothesis without ≥3 assumptions, ≥2 verification methods, traffic-light criteria and a deadline will not save — the tool enforces the format. Decisions are recorded in the Decision Log with outcome and rationale.

## 2. Access and roles

### 2.1 Sign in

- URL: `https://dashboardcamp.ru/login`.
- Fields: **Email**, **Password** (browser autocomplete, `username/current-password`).
- Validation: empty fields and non-email formats are cut client-side («Fill in this field», «Address must contain @»).
- Failed-attempt limit: 5 in a row → temporary lock; wait or contact the admin.
- Session: HttpOnly cookie `pca_session`. Sign out via **Logout** in the sidebar; the browser Back button will not show the dashboard afterwards.

### 2.2 Roles

| Capability                                                      | Analyst          | Admin |
| --------------------------------------------------------------- | ---------------- | ----- |
| Monitoring (Overview, Live, Goals, pc-goals Funnel)             | ✅               | ✅    |
| Analytics (Traffic, Behavior, Funnel & B2B, KPI, Data)          | ✅               | ✅    |
| Report, Hypotheses, Decisions, History                          | ✅               | ✅    |
| B2B Deals, Marketing, DataLens, Help                            | ✅               | ✅    |
| Admin panel (Users, AI providers, Metrika, Integrations, Audit) | ❌ («No access») | ✅    |
| Settings (goal, SMART, deadline)                                | view-only in KPI | ✅    |

Notes:

- A direct URL to an unavailable section (e.g. `/app/settings` for an analyst) shows **«No access»** — by design, not a bug.
- Full permission matrix — the «Roles» article in Help.

### 2.3 Language and theme

- The **RU/EN** toggle in the top bar translates the whole dashboard (Metrika goal names stay as defined in Metrika — they are data).
- Theme: moon/sun button next to the language toggle. The choice is remembered.
- Language does not affect numbers: the figures are identical in both locales.

### 2.4 Mobile

Widths from 390px are supported: the sidebar collapses into a burger menu, tables scroll horizontally, charts scale. There is no page-level horizontal overflow — if you see one, it's a bug, tell the team.

## 3. Quick start (first 5 minutes)

1. Sign in (2.1).
2. **Overview** — read the hero: «On track to 300?» + SMART line + status (e.g. «Not on track at the current pace»).
3. Look at the **Weekly digest** at the bottom of Overview — 3–5 facts with numbers.
4. Scroll the **Weak spots** — the top items with 🔴 and a «→ hypothesis» button.
5. Open **Live** — what is happening on the site right now.
6. Need to report: **Report → period → Build report → Export DOCX/PDF**.

Then dive into the sections below.

## 4. Dashboard UI

### 4.1 Top bar

- **Breadcrumbs** «Metrika → funnel → hypotheses → report» — the product logic in one line.
- **Period**: `7d / 14d / 30d / 90d / 1y`, the **Dates** button (From/To calendar, «Apply»; `to < from` → validation error).
- **Segment**: `B2C+B2B` (default), `B2C`, `B2B`. Changing the segment does a full page reload — by design, so every widget recalculates. In the B2B segment the «GOAL (PAID TICKETS)» and «REMAINING TO GOAL» tiles are hidden with an explanation: Metrika goals belong to the overall flow, B2B has none.
- **Archived goals** (checkbox): show goals archived in Metrika.
- **Test traffic** (checkbox, live pages): include/exclude test visits.
- **RU/EN** — language; **moon/sun** — theme; **?** — page help; **🔔** — notifications; avatar — profile (admin: name/language/password).
- Build version — in the sidebar footer (`v3.4.64 · 76d7090 · 2026-11-18`). If the prod version changed while you work, the page shows a «New version» banner on the next request.

### 4.2 Sidebar

Three groups: **MONITORING** (Overview, Live, Metrika Goals, pc-goals Funnel), **ANALYTICS** (Traffic, Behavior, Funnel & B2B, KPI & Forecast, Data), **WORK** (Report, Hypotheses, Decisions, History, B2B Deals, Marketing, DataLens, Help). Admins also get **ADMINISTRATION**.

### 4.3 Onboarding tour

Shown once after the first sign-in. «Skip tour» — it will not return until the flag is reset (see Troubleshooting if it keeps reappearing).

## 5. Monitoring

### 5.1 Overview (`/app`)

The main summary page. Everything uses one visits source (`periodTotals`) — card, funnel and KPI figures always reconcile.

**Hero** — the answer to «On track to 300?»:

- **SMART line**: «Reach ≥300 paid tickets by 2026-11-21 — currently 0, 300 remaining (~75/day)».
- **Status**: «On track at the current pace» / «Not on track at the current pace» / «Forecast: —» (no payments yet).
- **Forecast**: expected goal date · deadline Nov 21, 2026.
- **Payment pace**: N,0/day.

**KPI tiles** (4):

| Tile             | Shows                                | Notes                                                                              |
| ---------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| VISITS           | visits in the period (all sources)   | same source as the funnel                                                          |
| B2C APPLICATIONS | reaches of the `reg_step1` goal      | «application ≠ paid ticket» badge; ⓘ explains the difference from the funnel stage |
| B2B PIPELINE     | tickets in B2B deals (manual input)  | «N deals»                                                                          |
| PAID B2B         | tickets of deals in the «paid» stage | CR 0.0–100%                                                                        |

**Charts (4)** — each has **«About this chart»** with 🟢 ok / 🔴 problem / 💡 advice:

1. «Visits and applications» — dual-axis time series.
2. «Channel mix» — stacked by source.
3. «Top countries» — geography.
4. «Device share (visits)» — donut desktop/mobile/tablet.

**Weak spots** — auto-collected list of problems with numbers: «Direct 1 774 visits · CR 0.2%», etc. Each item has **«→ hypothesis»** — prefills a new problem-hypothesis form (subject, title, ICE 5/5/5, 14-day deadline; edit or Cancel).

**Weekly digest** — 3–5 fact lines: visits 7d = 1 705 ▼3.4% WoW; applications 4 ▼42.9%; top channel: Direct 828, etc.

**Overview UTM table** — campaigns of the period with visits; the `(none)` row — direct/unmarked traffic; on top — «UTM coverage: N%» (share of marked traffic; ~31–32% is normal).

### 5.2 Live (`/app/live`)

Realtime straight from Metrika (no cache): **VISITS / VISITORS / PAGEVIEWS / BOUNCE / AVG. TIME**, «Include test traffic» checkbox, **Pause/Resume**, «Updated Ns ago». Auto-refresh every 60 seconds. Below — the pc-goals participant funnel.

### 5.3 Metrika Goals (`/app/goals`)

Counter goals table: **Goal | Type | JS event | Funnel role | Reaches | Conversion | Previous period | Δ | 14 days | 90 days | Status** (live/sleeping/archived). The «Archived goals» top-bar checkbox controls archived ones. The KPI goal row («Ecommerce: purchase») is what counts as paid tickets.

### 5.4 pc-goals Funnel (`/app/funnel-live`)

Participant funnel (who exactly reached what): Visits → Opened registration → Opened cart → Left contacts (order) → Payment. Stages with `source: none` are hidden; if the counter has no payment goal, «Payment» falls back to B2B payments of the period.

## 6. Analytics

### 6.1 Traffic (`/app/traffic`)

- **Channels** — table: visits, applications, CR per channel.
- **Sankey** «Flow: source → search system → campaign»: hover a flow for tooltips. Labels do not overlap; narrow flows get leader lines.
- **UTM table**: source/medium/campaign, visits, applications. Named campaigns (`mr_powerlifter`, `productcamp_next_earlybird_2026`…) appear on longer periods. `(none)` — direct/unmarked. On top «UTM coverage: N%».
- Tip: compare coverage on 7d/30d/90d — growing coverage means better campaign tagging.

### 6.2 Behavior (`/app/behavior`)

- Pages table: visits, **bounce %**, depth, time. The «high bounce» threshold is 50% (`BOUNCE_HIGH`); pages above it with sufficient volume land in «Problem pages» (together with low CR — `CR_LOW_PAGE_TARGET`).
- Entry/exit: which page visitors come in / leave on; «/» (home) renders on one line.
- Click-to-sort headers: DESC ↔ ASC, `aria-sort` updates (screen-reader friendly).
- The «✅ Normal» block — pages within thresholds.

### 6.3 Funnel & B2B (`/app/funnel`)

- **Conversion funnel** (ECharts): Visits → Opened registration → Opened cart → Left contacts (order) → Payment. Wide stages carry full labels (name + value + «N% of prev.»); narrow stages carry value-only labels inside/outside. Below the chart — a **text mirror** (stage list with numbers and %) — screen-reader friendly and copyable.
- **Loss analysis**: «lost from visit to application: N visits (P%)», per-stage losses, B2C/B2B separation.
- «order ≠ paid ticket» notes: stage numbers and «Paid» do not have to match (different Metrika goals).
- **Consistency**: funnel visits = Overview visits = KPI (±0%).
- Chart height ≥360px — labels fit their bands.

### 6.4 KPI & Forecast (`/app/kpi`)

- **Plan → fact (cumulative)**: the plan line to the 300 goal and actual payments.
- **Deadline: Nov 21, 2026** · SMART «Reach ≥300 paid tickets by 21 Nov 2026».
- **Forecast**: goal date at the current pace; «+N days (behind)»; **disclaimer «forecast by applications, not payments»**.
- **What-if**: the «Traffic: ±N%» slider recalculates the forecast instantly (e.g. +30% reduces the backlog). Slider to 0 returns the baseline; state is NOT saved — it's a calculator, not a plan.
- Plan window: «Apr 29, 2025 → Nov 21, 2026 · Goal: 300».

### 6.5 Data & DataLens (`/app/data`, `/app/datalens`)

- **Data**: DataGrid over the marts (channels, UTM, geo, pages) with XLSX export and virtualization.
- **DataLens**: typed CSV datasets for Yandex DataLens + team dashboard links (connection configured by the admin).

## 7. Work

### 7.1 Report (`/app/report`)

**Build**: the **«Build report»** button (period = current filter). The system builds an **immutable snapshot**: the whole period context (KPI, channels, funnel, behavior, B2B, marketing weeks, geo/devices, pages) fixed in JSON with a UUID and `generated_at`.

**Preview**: 17–18 sections with a 2-level TOC, including «Marketing» (when the period intersects filled partner weeks). Every section uses snapshot numbers, no live API calls.

**Export**:

- **Export DOCX** / **Export PDF** — downloads `productcamp-report-<snapshotId>.pdf` (EN gets an `-en` suffix).
- During preparation both buttons are disabled, the active one shows «Preparing…» (PDF renders in 12–20 s — normal).
- **Determinism**: two exports of one snapshot are byte-identical (covered by tests and sha256 audits). The file's metadata date = the snapshot's `generated_at`, not the download time.
- Download errors appear in the UI (ErrorBox above the preview).

**AI analysis** (optional): «Generate AI analysis» → stage progress (prepare → summary → sections) → structured text per report sections. Provider dropdown (auto = chain). Attribution: «generated by OpenRouter/gpt-…». The AI text does NOT enter DOCX/PDF automatically — a separate analytical layer. Usage is logged (`ai_usage`), keys stay masked (`sk-a****`).

**Hypotheses from the report**: «→ hypothesis» on snapshot weak spots prefills a problem hypothesis.

### 7.2 Hypotheses (`/app/hypotheses`)

**6-column kanban**: Draft · In check · Confirmed · Partially confirmed · Rejected · Overdue. Cards: title, kind badge, ICE number, deadline. «DRAFT N» counter above the column.

**New hypothesis** — two kinds:

- **Problem**: audience segment + observation/pain + **evidence** (quote/number + source) + why it matters now.
- **Solution**: a hypothesis in the format «{AUDIENCE} will {action}, if {condition}» + a measurable success criterion.

**Required fields (Save blocked until filled)**:

1. **≥3 assumptions** (empty rows are ignored and do not block);
2. **≥2 verification methods** (quantitative/qualitative/composite + description);
3. **Traffic-light criteria**: 🟢 success ≥X, 🟡 partial Y–X, 🔴 fail <Y;
4. **Deadline** (date);
5. The format statement and evidence — a problem requires a source.

**ICE = I × C × E (product)**: I — impact on the goal (1–5), C — confidence (1–5, evidence raises it), E — ease of verification (5 = a day, 1 = a month). A product, not a mean: you cannot «buy» confidence with impact. The number shows on the card and in the popup.

**Card**: «View» — a popup with the full content (statement, audience/action/condition, ICE breakdown, traffic light, deadline, decisions), «Edit»/«Close», Esc closes.

**«→ hypothesis»** from weak spots (Overview/Report): a deep link prefills subject/title/evidence — review and save.

**Overdue**: deadline passed with a non-terminal status → the card moves to «Overdue» automatically.

### 7.3 Decisions (`/app/decisions`)

The Decision Log — a journal of made decisions. **A decision without a record = not made.**

**New decision** — the form:

| Field                 | Req. | What to write                                                                                        |
| --------------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| Hypothesis            | ✅   | picked from the kanban (id)                                                                          |
| Date                  | ✅   | today by default                                                                                     |
| Decision (what we do) | ✅   | e.g. «scale the podcast»                                                                             |
| Method                | —    | quantitative / qualitative / composite                                                               |
| Period (days)         | —    | verification length (14 by default)                                                                  |
| Cut                   | —    | «channel: tg», «page: /b2b/»                                                                         |
| Outcome               | —    | 🟢 green / 🟡 yellow / 🔴 red                                                                        |
| Outcome rationale     | ✅   | referencing the traffic-light thresholds («CR ≥ 2% achieved»)                                        |
| Evidence              | ✅   | at least one row: quote/number + source («CR 5.4% — Metrika»)                                        |
| Findings              | —    | optional rows «finding + confidence (high/medium/low)»; empty rows are dropped and do not block Save |
| Next step             | ✅   | scale / iterate / kill                                                                               |
| Decided by            | ✅   | prefilled from the session                                                                           |

**Autonomy matrix**: the form includes a reference table «which decision who is entitled to make».

The decisions list — a table filterable by hypothesis; each decision links to its hypothesis card.

### 7.4 History (`/app/history`)

All report snapshots: **period, author, generated_at, pinned plan→fact**, the **«Current»** badge on the freshest. Click — open that snapshot's full report (read-only, same rendering as export). Deletion is manual via admin API only (REG-10: the snapshot row goes, files stay on disk).

### 7.5 B2B Deals (`/app/b2b`)

- **Kanban** by stages: LEAD → NEGOTIATION → CONTRACT → PAYMENT (drag&drop changes the stage) + a «Table» toggle.
- **New deal**: company, **tickets (integer ≥1 — otherwise an inline error)**, amount, date. A new deal lands in LEAD.
- A deal in **PAYMENT** = paid B2B tickets → they feed the «PAID B2B» tile and the report.
- Deletion — only in the «Table» tab (a confirm button «Delete deal „…" (N tickets)?»).
- All operations are audit-logged.

### 7.6 Marketing (`/app/marketing`)

The weekly partner grid: partner, week, **landing visits**, link clicks (**email**, **tg**), **site goals**, **payments**, **B2B applications**, planned B2B tickets, referral clicks. Filled weeks carry real numbers; empty ones are 0 (demo cells excluded). This table is the source of the report's **«Marketing» section** (ANA-165): weeks intersecting the period enter the report.

### 7.7 Help (`/app/help`)

- 24 articles: all pages, roles, methodology, integrations.
- **Search**: by titles and text («funnel», «marketing» — instant filter).
- **RAG assistant** (bottom-right button): answers grounded in the help text — ask «how to build a report», «what is UTM coverage».

## 8. System messages and what they mean

| Message                                                              | Where                     | What to do                                                      |
| -------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| «Fill in this field»                                                 | /login                    | empty email/password                                            |
| «Address must contain @»                                             | /login                    | not an email format                                             |
| «Wrong email or password»                                            | /login                    | check credentials; 5 failures = temporary lock                  |
| «No access»                                                          | any admin page as analyst | by design; admin panel is admin-only                            |
| «The Save button is unavailable — fill in: ✗ Title…»                 | Hypotheses                | the blockers panel lists the missing required fields            |
| «Tickets: an integer of at least 1»                                  | B2B                       | inline validation of negative/zero values                       |
| «Preparing…» (Export PDF disabled)                                   | Report                    | PDF renders in 12–20 s — wait, repeated clicks are not possible |
| «The 300 goal refers to the overall visit flow…»                     | Overview (B2B segment)    | goal tiles hidden by design — B2B has no Metrika goals          |
| «Page not found»                                                     | any URL                   | a custom 404 with a «To home» link                              |
| «Click „Build report"…»                                              | Report                    | no snapshot for the period — build one                          |
| «The report behind this link was not found…» + «Open report history» | Report with `?snapshot=`  | deleted/invalid snapshot id                                     |
| «New version» (banner)                                               | anywhere                  | prod updated — reload the page                                  |

## 9. Rules to remember

1. **Application ≠ paid ticket.** `reg_step1` is an application (a contact); a paid ticket = a B2C purchase or a B2B deal in «paid». All tiles/reports keep them apart.
2. **B2B is manual input.** Metrika cannot see the B2B pipeline; create the deal and drag it through stages.
3. **A snapshot is immutable.** A report for a period never «drifts»; a rebuild creates a new snapshot, the old one stays in History.
4. **A hypothesis without the format is not a hypothesis.** Assumptions, methods, traffic light, deadline — not bureaucracy but the condition of verifiability.
5. **A decision without a record is not made.** Outcome + rationale + next step.
6. **The forecast is by applications.** Do not confuse the goal-date forecast with a payment guarantee.
7. **Changing the segment/period recalculates everything.** The B2B segment hides goal tiles — not an error.

---

_Found an inaccuracy or a bug? File a Linear issue (team ANA) or write to the track team. The document updates with every release._
