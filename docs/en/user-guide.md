# User guide

> [🇷🇺 Русский](../user-guide.md) · 🇬🇧 English

How to use the ProductCamp Conversion Analytics **web cabinet** (v3). For the "Conversions &
lead-gen" track team.

> ✅ **Status: v3.4.0.** A multi-user cabinet with session login and **Administrator / Analyst**
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

The full page-by-page permission matrix is in the help: `/help/roles`. Everything each role can do is
summarised in §14 and §15 below.

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

**Getting the OAuth token:** create an app at oauth.yandex.ru with `metrika:read`
(and `metrika:write` to create goals from the admin UI), open the authorization link
from the settings, copy the `access_token` from the address bar after the redirect and
paste it into the “OAuth token” field.

**Creating and archiving goals.** Goals are created via the Management API: type
(URL / action / step / number …), name, conditions (exact / contain / start / regexp).
The API rejects condition type `js` — JS events are `action` goals with a URL condition.
New goals appear in the cabinet after the next sync (or a manual “Sync”).

**Service-traffic filter.** Robots and local visits are excluded from the sync and live
pages by default; `INCLUDE_TEST_TRAFFIC=1` returns the raw behaviour.

**Scheduled sync.** On the server the sync runs every 3 hours (`pca-sync.timer`).

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

### How the system works

Metrika → our sync (SQLite, daily cuts, every 3 hours) → two channels into DataLens:
the CSV datasets from `/app/datalens` (Files connection) and the native Metrika
connector (live data, auto-refresh). The “ProductCamp Analytics” workbook and the
Metrika connection were provisioned via the Public API (`scripts/push-datalens.mjs`).

### Setup (step by step)

1. Sign in at [datalens.ru](https://datalens.ru).
2. Download the 5 CSVs from `/app/datalens` (period up to 365 days).
3. Connections → **Files** → upload → verify column types.
4. Build charts (line / bar / donut / funnel) and the dashboard.
5. Chart alerts → the webhook URL from “Admin → Integrations”.

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

## 12. How reports are built

Details — help `/help/reports-how` ([docs/help/en/17-reports-how.md](../help/en/17-reports-how.md)).

| Step | What happens                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Metrika sync → SQLite**: raw responses in `raw_responses` (the source of facts), aggregates by channel, UTM, geo/device, page                                                 |
| 2    | **Snapshot** for a period: KPI, channels, funnel, breakdowns, B2B, hypotheses and the Decision Log frozen under a UUID in `report_snapshots`                                    |
| 3    | **Charts**: 3 PNGs (channels, funnel, channel mix) — ECharts in headless Chrome; each with a 🟢/🔴 block from thresholds (CR 5% / 2%, 70%)                                      |
| 4    | **DOCX per GOST R 7.32-2017**: title page, contents, list of figures, unnumbered designations / introduction / executive summary, numbering from «1. КРАТКИЕ ИТОГИ», appendices |
| 5    | **PDF** — from the same snapshot via headless Chrome (`PUPPETEER_EXECUTABLE_PATH`)                                                                                              |
| 6    | **AI**: analysis (6 sections), 10 problem + 10 solution hypotheses with ICE = I×C×E (computed in code), Decision Log proposals                                                  |
| 7    | **Check**: `node scripts/verify-report-gost.mjs <docx>` → PASS / PASS-WITH-WARNINGS / FAIL                                                                                      |

Steps 3–5 never call Metrika or AI, so the numbers on screen, in DOCX and in PDF match. AI only sees
the snapshot numbers and never touches charts, traffic lights or the ICE score.

## 13. LLM provider keys

Details — help `/help/llm-keys` ([docs/help/en/18-llm-keys.md](../help/en/18-llm-keys.md)). Where:
“Administration → AI providers” (`/app/admin/ai`): Key, Model, Priority (lower goes first), extra fields,
Save, Test connection, the Enabled checkbox, 30-day usage. Keys are AES-256-GCM encrypted and masked.

| Provider   | What you need                                                      | Where to get it                                                                    |
| ---------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| YandexGPT  | API key + folder ID                                                | Yandex Cloud / AI Studio: a service account with `ai.languageModels.user`, API key |
| GigaChat   | Authorization Key + scope (`GIGACHAT_API_PERS` / `_B2B` / `_CORP`) | developers.sber.ru; the server needs the Russian Trusted Root CA certificate       |
| Anthropic  | API key (`sk-ant-…`)                                               | console.anthropic.com → API Keys                                                   |
| OpenRouter | API key (`sk-or-…`), model as `vendor/model`                       | openrouter.ai/keys                                                                 |

## 14. Administrator role — full feature set

Details — help `/help/admin-guide` ([docs/help/en/19-admin-guide.md](../help/en/19-admin-guide.md)).
Administrators get everything in §15 plus:

| Page                                     | Functions                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Users (`/app/admin/users`)               | create (temporary password shown once), change role, disable/enable (sessions end), reset password; last-admin protection    |
| AI providers (`/app/admin/ai`)           | keys for 4 providers, model, priority/fallback, folder ID / scope, Test connection, enable, 30-day usage                     |
| Metrika & data (`/app/admin/metrika`)    | counter, OAuth token, Client ID/secret, order and KPI goals; “Refresh data from Metrika”; data cleanup (type `УДАЛИТЬ`)      |
| Metrika goals (API)                      | create, archive, restore goals via `/api/admin/metrika/goals…` (needs `metrika:write`)                                       |
| Integrations (`/app/admin/integrations`) | DataLens API connection (Org ID, Workbook ID, IAM token, check), webhook URL and rotation, codes and events, dashboard links |
| Audit log (`/app/admin/audit`)           | latest 1000 entries: sign-ins, users, settings, AI, goals, DataLens; search, sorting, CSV                                    |

## 15. Analyst role — full feature set

Details — help `/help/analyst-guide` ([docs/help/en/20-analyst-guide.md](../help/en/20-analyst-guide.md)).

| Page                                           | Functions                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Overview (`/app`)                              | KPI strip, weekly digest, charts by day/channel/country/device, UTM coverage, weak spots → hypothesis      |
| Live (`/app/live`)                             | live visits and metrics by hour/day; pause, refresh, test traffic                                          |
| Metrika goals (`/app/goals`, `/app/goals/:id`) | live/sleeping/dead statuses, duplicates, filter, CSV; goal detail with dynamics and breakdowns             |
| pc-goals funnel (`/app/funnel-live`)           | funnel steps with conversions, ticket tariffs, applications by role                                        |
| Traffic (`/app/traffic`)                       | channels, visits vs applications, fullscreen UTM Sankey, channel and UTM tables                            |
| Behaviour (`/app/behavior`)                    | observations, conversion and bounce charts, entry/exit page tables, recommendations                        |
| Funnel & B2B (`/app/funnel`)                   | “application ≠ payment” funnel, losses, channels, countries, B2B by stage, problem pages                   |
| KPI & forecast (`/app/kpi`)                    | progress ring to 300, “What if” (traffic and conversion sliders), B2B tab                                  |
| Data (`/app/explore/:preset`)                  | 11 Reporting API presets, chart, table, goal-for-columns picker, CSV                                       |
| Report (`/app/report`)                         | “Build report” (snapshot, saved to History), AI hypotheses, AI analysis, Export DOCX/PDF, hypothesis draft |
| History (`/app/history`)                       | snapshot list, “View” without regenerating                                                                 |
| B2B deals (`/app/b2b`)                         | 4-stage kanban, add, change stage, delete                                                                  |
| DataLens (`/app/datalens`)                     | 5 CSV datasets, native connector guide, team dashboards, request to an administrator                       |
| Help & assistant                               | `/help` with search; the assistant answers only from the help, with sources                                |
| Language, theme, notifications                 | RU/EN, 🌙/☀️, bell                                                                                         |
