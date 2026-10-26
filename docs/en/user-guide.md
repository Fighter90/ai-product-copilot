# User guide

> [🇷🇺 Русский](../user-guide.md) · 🇬🇧 English

How to use the ProductCamp Conversion Analytics **web cabinet** (v3). For the "Conversions &
lead-gen" track team.

> ✅ **Status: v3.0.0.** A multi-user cabinet with session login and **Administrator / Analyst**
> roles plus an action audit log. Real-time monitoring: **Live**, **Goals** (+ goal detail),
> **Live funnel**. Analytics: Traffic, Behavior, Funnel, KPI, **Explore** (presets), Report
> (DOCX/PDF + AI), History, B2B, **DataLens**. Administration: Users, AI providers
> (OpenRouter/Anthropic/YandexGPT/GigaChat), Metrika, Integrations, Audit. A RAG assistant over the
> built-in help (bottom-right corner), a Help center, **ru/en** interface, dark/light theme.

## 1. What it is and why

The tool answers one question: **where do paid tickets come from, and how do we reach 300?**
It does not replace Yandex Metrika — it turns its raw goals into a clear picture: a per-channel
breakdown, a "visit → application → payment" funnel, and hypothesis discipline.

Core principle: **an application ≠ a payment**. A Metrika goal (application) and an actual payment
are kept distinct everywhere in the UI; progress toward the 300 KPI is counted in payments only.
Every number traces back to the raw Metrika response stored in `raw_responses` (SQLite) — the
anti-hallucination invariant.

## 2. Login and roles

Open `/login` and sign in with the email/password issued by an administrator. Sessions last
7 days by default; the profile menu lets a user change their **password**, **name** and **interface
language**. Failed logins are rate-limited (5 per 15 minutes); passwords require ≥ 10 characters.

| Role              | Access                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Analyst**       | the whole cabinet: monitoring, analytics, reports, history, B2B, DataLens export, help                             |
| **Administrator** | everything + Administration: users, AI providers, Metrika, Integrations, audit log; runtime settings; data cleanup |

Permissions are enforced on the backend; admin actions and exports are written to the audit log.

## 3. Running

See [runbook.md](runbook.md); server deployment — [../deploy.md](../deploy.md). In short:
`./setup.sh` (or `pnpm install && ./init.sh && ./run.sh`) → `http://localhost:5173`. The first
administrator is created from `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env` when the users table is
empty. Without an OAuth token the analytics run on deterministic demo data (`pnpm seed`).

## 4. Cabinet UI

- **Sidebar** (collapsible) grouped into Monitoring / Analytics / Work / Administration
  (the latter — admins only). On mobile: bottom tabs + "More".
- **Top bar**: global filters, **theme** toggle (🌙/☀️), **RU/EN** language toggle,
  **notification bell** (DataLens events and analyst requests), user menu.
- **Footer**: product version (from the root `package.json`) + short git SHA of the build.
- **RAG assistant** — floating button in the bottom-right corner (see §9).
- **Help center** — `/help`.

Theme and language persist in the browser (localStorage); the language is also saved to the user
profile.

## 5. Pages

### Monitoring (real time — queried directly from Yandex Metrika, not cached)

| Page            | URL                | What it shows                                                                                                                                                                           |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**    | `/app`             | KPI strip, daily visits/applications, channel mix, weak spots — from SQLite (daily history)                                                                                             |
| **Live**        | `/app/live`        | today in real time: visits/goals, ProductCamp events, hourly dynamics                                                                                                                   |
| **Goals**       | `/app/goals`       | all counter goals: status (live/sleeping/dead), reaches over 14/90 days, duplicate goals; detail — `/app/goals/:id`                                                                     |
| **Live funnel** | `/app/funnel-live` | PC-event funnel: saw tickets → CTA click → opened registration → cart → left contacts; tickets by type (standard/optimal/max), applications by role (volunteer/speaker/C-level/partner) |

### Analytics (SQLite, daily history via `npm run sync`)

| Page         | URL                    | What it shows                                                                                                                                       |
| ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Traffic**  | `/app/traffic`         | channel bar chart, visits vs applications, channel table with CR, UTM breakdown, insights                                                           |
| **Behavior** | `/app/behavior`        | entry/exit pages: bounce/CR charts + tables, recommendations                                                                                        |
| **Funnel**   | `/app/funnel`          | "application ≠ payment": Visits → B2C applications → B2B pipeline → B2B paid; funnel by channel, loss analysis                                      |
| **KPI**      | `/app/kpi`             | progress ring toward 300 paid tickets (B2B paid + purchase goals), "What if" simulator, recommendations                                             |
| **Explore**  | `/app/explore/:preset` | quick Reporting API cuts by preset: sources, search engines, UTM, pages, devices, browsers, geo, referers, days, hours — table + chart + CSV export |

### Work

| Page         | URL             | What it shows                                                                                           |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------- |
| **Report**   | `/app/report`   | period snapshot, full on-screen report, AI hypotheses and AI Decision Log, AI analysis, DOCX/PDF export |
| **History**  | `/app/history`  | saved snapshots; "View" opens a report without regenerating                                             |
| **B2B**      | `/app/b2b`      | kanban pipeline with 4 stages (lead → negotiation → invoiced → paid), full deal table                   |
| **DataLens** | `/app/datalens` | the 5 CSV datasets for Yandex DataLens, downloads per period, connection request (see §8)               |

Legacy pre-v3 URLs (`/traffic`, `/report`, `/settings`, …) redirect into the matching `/app/…`
section.

### Filters (top bar on analytics pages)

Period presets **7d / 14d / 30d / 90d / 1y** and a custom range (from → to, max 365 days);
**segment** B2C / B2C+B2B / B2B; **test traffic** toggle on live pages. Live-page filters apply to
the Reporting API request period, not to SQLite.

## 6. Administration (admins only)

- **Users** (`/app/admin/users`): create users (a one-time password is shown exactly once), change
  roles, deactivate, reset passwords. The last active admin cannot be demoted or blocked.
- **AI providers** (`/app/admin/ai`): enable **OpenRouter / Anthropic / YandexGPT / GigaChat**, set
  priority (fallback order), model, secret key and extras (YandexGPT `folderId`, GigaChat `scope`).
  "Test" performs a live check. Keys are encrypted with **AES-256-GCM** (master key `APP_SECRET`)
  and always masked in the UI; per-call statistics for the last 30 days are on the same page.
  Consumers: the report (AI analysis / hypotheses / Decision Log) and the help assistant.
- **Metrika** (`/app/admin/metrika`): OAuth token, Client ID/Secret, `COUNTER_ID`, `GOAL_ID`
  (`0` = auto-detect the purchase goal), `ORDER_GOAL_ID`, KPI target. Secrets are masked; changes
  apply **without a restart**. Also: "Sync from Metrika" and metric-data cleanup.
- **Integrations** (`/app/admin/integrations`): DataLens webhook token, recent webhook events
  (confirmation codes, alerts), dashboard links.
- **Audit** (`/app/admin/audit`): logins (incl. failures), user management, password resets,
  DataLens exports and requests — with time, user, action, target and details.

## 7. Reports and B2B

- **Report** (`/app/report`): build a snapshot → the full report opens on screen; optional
  **"Generate AI analysis"** (6 sections) goes through the AI provider chain; **Export DOCX/PDF**
  (PDF needs Chrome via `PUPPETEER_EXECUTABLE_PATH`). GOST-formatted, deterministic: one
  `snapshotId` → identical content on screen and in DOCX/PDF.
- **B2B** (`/app/b2b`): manual deal entry (Metrika does not cover the B2B pipeline) — kanban with
  4 stages plus an editable table; paid tickets count toward the 300 KPI.

## 8. DataLens

**DataLens** (`/app/datalens`) bridges the data into Yandex DataLens via a **Files connection**:
download typed CSV datasets — `channels_daily`, `utm_daily`, `pages_daily`, `geo_device_daily`,
`b2b_deals` (UTF-8 with BOM, RFC 4180, localized ru/en headers, optional `from`/`to`).
The reverse channel is a **token-protected webhook**: DataLens sends confirmation codes and alerts
to `POST /api/integrations/datalens/webhook/:token`; admins see them under Integrations and in the
bell. Analysts can request a DataLens connection (creates an admin notification). Every export is
written to the audit log.

## 9. Help and the RAG assistant

- **Help center** (`/help`) — articles from `docs/help/ru` (or `docs/help/en`): pages, goals,
  funnel, integrations; searchable.
- **Assistant** — floating button in the bottom-right corner. Answers **only from the help
  articles**: question → relevant chunks → model answer with article links. Uses the configured AI
  providers; without them it asks an administrator to enable a provider.

## 10. Language and theme

- **RU/EN toggle** in the top bar; the choice persists in the browser and in the user profile.
  Help articles and assistant answers follow the UI language.
- **Dark/light theme** toggle (🌙/☀️), applied before first paint to avoid flashing; persisted.

## 11. Principles to remember

- Every number traces back to `raw_responses` — if it doesn't, that's a bug.
- An application ≠ a payment; KPI progress counts payments only.
- Secrets (tokens, AI keys) are entered only in the admin UI or `.env`; they are always masked.
- Admin actions and exports are recorded in the audit log — it is append-only.
- New dependencies outside the fixed stack require an ADR in `docs/decisions/`.
