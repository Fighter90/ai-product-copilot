# Data model (SQLite)

> 🇬🇧 English · [🇷🇺 Русский](../data-model.md). Source of truth — the migrations in
> `code/backend/src/db/migrations/001..011`. Access goes only through the repositories
> (`code/backend/src/db/repositories/`). History accumulates **per day** (see ADR-007).
> DB: `data/productcamp.sqlite` (gitignored, path overridable with `DB_PATH`), `better-sqlite3`,
> WAL + `PRAGMA foreign_keys=ON`. Migrations are applied on start and by
> `pnpm --filter @pca/backend exec tsx src/db/cli-migrate.ts`; applied names are tracked in
> `_migrations`.

## Migrations

| Migration                  | Version | Adds                                                                                                             |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `001_init.sql`             | v1      | `goals`, `raw_responses`, `channel_stats`                                                                        |
| `002_hypotheses.sql`       | v1      | `hypotheses` (methodology format, generated `ice_score`)                                                         |
| `003_b2b_manual.sql`       | v1      | `b2b_manual`                                                                                                     |
| `004_snapshots.sql`        | v1      | `report_snapshots`                                                                                               |
| `005_decisions.sql`        | v1      | `decisions` (Decision Log)                                                                                       |
| `006_utm_stats.sql`        | v2      | `utm_stats`                                                                                                      |
| `007_geo_device_stats.sql` | v2      | `geo_device_stats`                                                                                               |
| `008_page_stats.sql`       | v2      | `page_stats` (entry pages)                                                                                       |
| `009_exit_page_stats.sql`  | v2      | `exit_page_stats`                                                                                                |
| `010_auth_settings_ai.sql` | v3.0.0  | `users`, `sessions`, `audit_log`, `app_settings`, `ai_providers`, `ai_usage`, `datalens_events`, `notifications` |
| `011_demo_marks.sql`       | v3.1.0  | `is_demo` on `hypotheses` and `decisions` (rows created by the CLI seeder)                                       |

## Table overview

| Table              | Purpose                                       | Key / history                                              |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------- |
| `goals`            | Metrika goals (seeded on sync)                | PK `id`                                                    |
| `raw_responses`    | raw Stat API responses (traceability / cache) | UNIQUE `(query_hash, date_from, date_to)` — idempotent     |
| `channel_stats`    | normalized metrics per channel                | PK `(date, channel, utm_source, utm_medium, utm_campaign)` |
| `utm_stats`        | breakdown by UTM source/medium/campaign       | PK `(date, utm_source, utm_medium, utm_campaign)`          |
| `geo_device_stats` | breakdown by country + device type            | PK `(date, country, device)`                               |
| `page_stats`       | entry page behavior (`ym:s:startURL`)         | PK `(date, page)`                                          |
| `exit_page_stats`  | exit page behavior (`ym:s:exitURL`)           | PK `(date, page)`                                          |
| `hypotheses`       | methodology hypotheses (manual)               | PK `id`; `ice_score` GENERATED                             |
| `b2b_manual`       | manual B2B pipeline                           | PK `id`; stages lead/negotiation/invoiced/paid             |
| `report_snapshots` | immutable data snapshots for reports          | PK `id` (ulid)                                             |
| `decisions`        | Decision Log                                  | PK `id`; FK → `hypotheses`; `number` UNIQUE                |
| `users`            | cabinet users (v3)                            | PK `id`; `email` UNIQUE (NOCASE); roles admin/analyst      |
| `sessions`         | server-side sessions (v3)                     | PK `token_hash` (sha256); FK → `users` ON DELETE CASCADE   |
| `audit_log`        | action log (v3)                               | PK `id`; index on `at`                                     |
| `app_settings`     | admin runtime settings, override `.env` (v3)  | PK `key`; secrets AES-256-GCM                              |
| `ai_providers`     | AI providers and their keys (v3)              | PK `id` ∈ openrouter/anthropic/yandexgpt/gigachat          |
| `ai_usage`         | AI call log (v3)                              | PK `id`                                                    |
| `datalens_events`  | DataLens webhook events (v3)                  | PK `id`; last 500 rows kept                                |
| `notifications`    | notifications (bell in the cabinet, v3)       | PK `id`; `audience` ∈ admin/all; `read_by` JSON            |
| `_migrations`      | applied migrations                            | PK `name`                                                  |

> **Where AI hypotheses and the AI Decision Log live (since v2.7.0).** AI-generated hypotheses and
> decisions are NOT stored in `hypotheses`/`decisions` but inside the snapshot JSON payload
> (`report_snapshots.payload.generatedHypotheses` / `.generatedDecisions`). The `hypotheses` and
> `decisions` tables remain for the manual methodology and API backward compatibility.

---

## Metrika metrics (daily)

All metric tables accumulate history **per day** via the `date` column: a repeated sync appends new
dates (`INSERT … ON CONFLICT`) without overwriting earlier ones. Metrika percentages
(`bounce_rate`, `conversion_rate`) are stored as a **fraction 0–1**.

### `goals`

| Column        | Type    | Description                       |
| ------------- | ------- | --------------------------------- |
| `id`          | INTEGER | Metrika goal id (PK)              |
| `name`        | TEXT    | goal name                         |
| `type`        | TEXT    | goal type (e.g. `e_purchase`)     |
| `is_b2b`      | BOOLEAN | B2B goal flag (default 0)         |
| `is_archived` | BOOLEAN | archived/deleted goal (default 0) |
| `synced_at`   | TEXT    | last sync time                    |

The primary KPI goal is determined by `classifyGoal`/`selectPrimaryGoal` (`@pca/shared`): reaches
of a "purchase" goal count as **payments**.

### `raw_responses`

| Column       | Type    | Description                                                           |
| ------------ | ------- | --------------------------------------------------------------------- |
| `id`         | INTEGER | PK (AUTOINCREMENT)                                                    |
| `endpoint`   | TEXT    | Stat API endpoint                                                     |
| `query_hash` | TEXT    | hash of the request parameters                                        |
| `date_from`  | TEXT    | period start                                                          |
| `date_to`    | TEXT    | period end                                                            |
| `payload`    | JSON    | the **raw** Metrika response — the anti-hallucination source of truth |
| `fetched_at` | TEXT    | fetch time                                                            |

UNIQUE `(query_hash, date_from, date_to)` → a repeated request is idempotent (cache); index
`idx_raw_query (query_hash, date_from)`. Every dashboard/report number can be rebuilt from here.

### `channel_stats`

| Column                                       | Type         | Description                          |
| -------------------------------------------- | ------------ | ------------------------------------ |
| `date`                                       | TEXT         | date (daily history)                 |
| `channel`                                    | TEXT         | traffic channel                      |
| `utm_source` / `utm_medium` / `utm_campaign` | TEXT         | UTM (part of the PK; may be NULL)    |
| `visits` / `users`                           | INTEGER      | visits / users                       |
| `bounce_rate` / `avg_duration`               | REAL         | bounce rate (0–1) / average duration |
| `goal_reaches` / `conversion_rate`           | INTEGER/REAL | goal reaches / CR (0–1)              |

> **Per-channel aggregation (v2.6.0).** The traffic query uses a single dimension
> `ym:s:lastTrafficSource` (no split by search engine), `attribution=lastsign`. On write,
> visits/users/applications are summed per channel — one row per `(date, channel, utm…)`, so the
> dashboard totals match Yandex Metrika after a re-sync.

### `utm_stats`, `geo_device_stats`, `page_stats`, `exit_page_stats`

Separate tables for different breakdowns — **intentionally not merged** with `channel_stats`:
summing different aggregations would double-count visits. Missing dimension values are normalized
to `(none)`. Each table has `date` as part of the PK.

| Table              | Dimension columns                          | Metrics                                                   |
| ------------------ | ------------------------------------------ | --------------------------------------------------------- |
| `utm_stats`        | `utm_source`, `utm_medium`, `utm_campaign` | visits, users, goal_reaches, conversion_rate              |
| `geo_device_stats` | `country`, `device`                        | visits, users, goal_reaches, conversion_rate              |
| `page_stats`       | `page` (startURL)                          | visits, users, bounce_rate, goal_reaches, conversion_rate |
| `exit_page_stats`  | `page` (exitURL)                           | visits, users, bounce_rate, goal_reaches, conversion_rate |

> ⚠️ `exit_page_stats` is often empty on live data — `ym:s:exitURL` is not supported by the Stat
> API (an API limitation, not a bug).

---

## Methodology

### `hypotheses`

Hypothesis format "{subject} {action} {solution}, if {condition}" plus methodology fields:

| Column                                          | Description                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `id`                                            | PK                                                                           |
| `diamond_phase`                                 | `define` / `develop` (CHECK)                                                 |
| `kind`                                          | `problem` / `solution` (CHECK)                                               |
| `subject` / `action` / `solution` / `condition` | statement components                                                         |
| `title`, `description`                          | title / description                                                          |
| `parent_id`                                     | FK → `hypotheses.id` (solution → problem)                                    |
| `hidden_assumptions`                            | JSON, **≥3** assumptions across 3 categories (checked in the repository)     |
| `validation_methods`                            | JSON, **≥2** validation methods                                              |
| `impact` / `confidence` / `ease`                | 1–10 (CHECK) + `*_rationale`                                                 |
| `ice_score`                                     | **GENERATED** `impact * confidence * ease` (product, ADR-005)                |
| `green/yellow/red_criteria`                     | traffic-light outcome criteria                                               |
| `deadline_days` / `deadline_at`                 | verification deadline                                                        |
| `evidence`                                      | JSON, traceability to `raw_responses`                                        |
| `status`                                        | draft/in_progress/green/yellow/red/expired (CHECK)                           |
| `is_demo`                                       | 1 = created by the CLI seeder (migration 011); the report shows a DEMO badge |
| `created_at` / `updated_at`                     | timestamps                                                                   |

Indexes: `(diamond_phase, kind, status)`, `(ice_score DESC)`.

### `decisions` (Decision Log)

| Column                                           | Description                                      |
| ------------------------------------------------ | ------------------------------------------------ |
| `id`                                             | PK                                               |
| `number`                                         | UNIQUE, format `DL-NNN`                          |
| `hypothesis_id`                                  | **FK → `hypotheses.id`**                         |
| `date`                                           | decision date                                    |
| `method`                                         | synthetic/live/quantitative/market/mixed (CHECK) |
| `scope`, `period_days`                           | scope and verification period                    |
| `findings`, `evidence`                           | JSON; `evidence` — **≥1** required               |
| `outcome`                                        | green/yellow/red (CHECK)                         |
| `outcome_rationale`                              | outcome rationale                                |
| `next_step`, `responsible`, `next_deadline`      | next step                                        |
| `previous_decision_id`, `spawned_hypothesis_ids` | iteration links (FK → `decisions.id`, JSON)      |
| `decided_by`, `participants`                     | who decided                                      |
| `exported_md_path`                               | path to an exported markdown file (optional)     |
| `is_demo`                                        | 1 = created by the CLI seeder (migration 011)    |
| `created_at` / `updated_at`                      | timestamps                                       |

Indexes: `(hypothesis_id)`, `(date DESC)`.

### `b2b_manual`

| Column                    | Description                                  |
| ------------------------- | -------------------------------------------- |
| `id`                      | PK                                           |
| `company`                 | company                                      |
| `tickets`                 | number of tickets                            |
| `stage`                   | lead / negotiation / invoiced / paid (CHECK) |
| `amount_rub`              | amount, RUB (optional)                       |
| `contact_email`, `notes`  | contact / notes (optional)                   |
| `date_added`, `date_paid` | dates                                        |

Paid tickets (`stage='paid'`) count toward the 300 KPI and the Goals progress.

### `report_snapshots`

| Column                   | Description                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | PK (ulid)                                                                                                                                                             |
| `generated_at`           | build time                                                                                                                                                            |
| `date_from` / `date_to`  | snapshot period                                                                                                                                                       |
| `payload`                | JSON — the whole `ReportSnapshot` (KPI, channels, breakdowns, funnel, b2bSummary, `goalLabel`, optional `aiNarrative` / `generatedHypotheses` / `generatedDecisions`) |
| `docx_path` / `pdf_path` | paths to generated files (optional)                                                                                                                                   |

A snapshot is **immutable**: one `id` → the same DOCX/PDF/screen content (determinism; no
`Date.now()`/LLM calls in the render path). Chart PNGs and the AI narrative are generated once and
read from the snapshot.

---

## Cabinet, settings and integrations (migration 010, v3.0.0)

### `users`

| Column                         | Type    | Description                                        |
| ------------------------------ | ------- | -------------------------------------------------- |
| `id`                           | INTEGER | PK (AUTOINCREMENT)                                 |
| `email`                        | TEXT    | UNIQUE, case-insensitive (`COLLATE NOCASE`)        |
| `name`                         | TEXT    | display name                                       |
| `role`                         | TEXT    | `admin` / `analyst` (CHECK)                        |
| `password_hash`                | TEXT    | scrypt (`scrypt$N$saltB64$hashB64`), salt embedded |
| `is_active`                    | INTEGER | 1 = may sign in; deactivation instead of deletion  |
| `locale`                       | TEXT    | `ru` (default) / `en` — saved UI language          |
| `created_at` / `last_login_at` | TEXT    | timestamps                                         |

The first administrator is created on start from `ADMIN_EMAIL`/`ADMIN_PASSWORD` when the table is
empty (`ensureBootstrapUsers`); `DEMO_USERS=1` adds a demo admin and a demo analyst. "Last admin"
protection: demoting/deactivating the only active admin is rejected (409).

### `sessions`

| Column                      | Type    | Description                                                          |
| --------------------------- | ------- | -------------------------------------------------------------------- |
| `token_hash`                | TEXT    | PK — **sha256** of the cookie token (the token itself is not stored) |
| `user_id`                   | INTEGER | FK → `users.id` ON DELETE CASCADE                                    |
| `created_at` / `expires_at` | TEXT    | creation/expiry time (`SESSION_DAYS`, 7 days by default)             |
| `ip` / `user_agent`         | TEXT    | sign-in metadata (optional)                                          |

Index `(user_id)`. Expiry is checked on every request (guard in `auth/auth.ts`); logout deletes
the row; password reset and deactivation delete all sessions of the user.

### `audit_log`

| Column                   | Type           | Description (example actions)                                                                                                                                 |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | INTEGER        | PK                                                                                                                                                            |
| `at`                     | TEXT           | ISO time; index `idx_audit_at`                                                                                                                                |
| `user_id` / `user_email` | INTEGER / TEXT | who (`user_id` is NULL for failed sign-ins)                                                                                                                   |
| `action`                 | TEXT           | `auth.login`, `auth.login_failed`, `users.create/update/reset_password`, `settings.update`, `ai.provider_update`, `metrika.goal_created`, `datalens.check`, … |
| `target`                 | TEXT           | action target (e.g. user email, dataset id, goal id)                                                                                                          |
| `details`                | TEXT           | JSON details (optional; secrets are never written)                                                                                                            |

Read under Administration → Audit (`GET /api/admin/audit`, up to 1000 rows).

### `app_settings`

Runtime settings editable by an admin without a restart (they override `.env`):

| Column                      | Type    | Description                                         |
| --------------------------- | ------- | --------------------------------------------------- |
| `key`                       | TEXT    | PK, one of the allowed keys (below)                 |
| `value`                     | TEXT    | value; for secrets — `iv:tag:ciphertext` (base64)   |
| `is_secret`                 | INTEGER | 1 = decrypt with the `APP_SECRET` key (AES-256-GCM) |
| `updated_at` / `updated_by` | TEXT    | who changed it and when                             |

Allowed keys (`SETTING_KEYS` in `settings/app-settings.ts`):

| Key                                        | Secret | Purpose                                                                                                             |
| ------------------------------------------ | :----: | ------------------------------------------------------------------------------------------------------------------- |
| `YANDEX_OAUTH_TOKEN`                       |   ✅   | Metrika OAuth token                                                                                                 |
| `YANDEX_CLIENT_ID`                         |        | OAuth app id                                                                                                        |
| `YANDEX_CLIENT_SECRET`                     |   ✅   | OAuth app secret                                                                                                    |
| `METRIKA_BACKUP_CLIENT_ID`                 |        | backup-account OAuth app id (ANA-107)                                                                               |
| `METRIKA_BACKUP_CLIENT_SECRET`             |   ✅   | backup-account OAuth app secret                                                                                     |
| `METRIKA_BACKUP_OAUTH_TOKEN`               |   ✅   | backup-account token — independent daily quota; used on 429 `quota_requests_by_uid`                                 |
| `COUNTER_ID`                               |        | Metrika counter                                                                                                     |
| `GOAL_ID` / `ORDER_GOAL_ID`                |        | KPI goal / "Order" goal for live pages                                                                              |
| `KPI_TARGET`                               |        | target number of payments (default 300)                                                                             |
| `EVENT_DATE`                               |        | KPI deadline date (YYYY-MM-DD); empty → heuristic                                                                   |
| `DATALENS_WEBHOOK_TOKEN`                   |   ✅   | webhook receiver token                                                                                              |
| `DATALENS_LINKS`                           |        | team DataLens dashboard links (one per line)                                                                        |
| `DATALENS_ORG_ID` / `DATALENS_WORKBOOK_ID` |        | DataLens Public API organization / workbook                                                                         |
| `DATALENS_IAM_TOKEN`                       |   ✅   | Yandex Cloud IAM token for the DataLens API                                                                         |
| `TEST_TRAFFIC_PATTERNS`                    |        | reserved for custom test-traffic patterns (the sync currently uses the built-in filter, see `INCLUDE_TEST_TRAFFIC`) |

`get(key)` returns: DB value → `.env` value (seed) → `''`; placeholders `YOUR_*_HERE` count as
empty. If a secret cannot be decrypted (wrong/rotated `APP_SECRET`), the value behaves as unset and
the log gets one error per key (the value is never printed). Changing the token/counter rebuilds the
cached Metrika client without a restart (`onSettingsChange`).

### `ai_providers`

| Column                                                | Type                  | Description                                                       |
| ----------------------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `id`                                                  | TEXT                  | PK: `openrouter` / `anthropic` / `yandexgpt` / `gigachat` (CHECK) |
| `enabled`                                             | INTEGER               | 1 = part of the chain (default 0)                                 |
| `priority`                                            | INTEGER               | traversal order (lower first, default 100)                        |
| `model`                                               | TEXT                  | selected model (e.g. `anthropic/claude-sonnet-4.5`)               |
| `secret_enc`                                          | TEXT                  | **AES-256-GCM** provider key (`iv:tag:ciphertext`, base64)        |
| `extra_json`                                          | TEXT                  | extra fields: `folderId` (YandexGPT), `scope` (GigaChat)          |
| `updated_at` / `updated_by`                           | TEXT                  | who configured it and when                                        |
| `last_test_at` / `last_test_ok` / `last_test_message` | TEXT / INTEGER / TEXT | result of the "Test connection" button                            |

Chain: `LlmService.complete` walks the enabled providers in `priority` order; a failure → the next
one. `.env` keys (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `YANDEX_AI_API_KEY`,
`GIGACHAT_AUTH_KEY`) are only an initial seed for an empty table.

### `ai_usage`

AI call log (30-day statistics under Administration → AI providers):

| Column                         | Type    | Description                            |
| ------------------------------ | ------- | -------------------------------------- |
| `id`                           | INTEGER | PK                                     |
| `at`                           | TEXT    | call time                              |
| `provider` / `model`           | TEXT    | provider and model                     |
| `purpose`                      | TEXT    | e.g. `help-assistant`, report sections |
| `user_email`                   | TEXT    | who triggered the call (optional)      |
| `ok`                           | INTEGER | 1 = success                            |
| `input_chars` / `output_chars` | INTEGER | request / response size                |
| `ms`                           | INTEGER | duration                               |
| `error`                        | TEXT    | error text (optional)                  |

### `datalens_events`

Incoming events of the DataLens webhook receiver
(`POST /api/integrations/datalens/webhook/:token`, public; the token is compared with
`app_settings.DATALENS_WEBHOOK_TOKEN`):

| Column        | Type    | Description                                                         |
| ------------- | ------- | ------------------------------------------------------------------- |
| `id`          | INTEGER | PK                                                                  |
| `received_at` | TEXT    | receive time                                                        |
| `kind`        | TEXT    | `confirmation` (a confirmation code was extracted) / `notification` |
| `code`        | TEXT    | confirmation code (optional)                                        |
| `payload`     | TEXT    | JSON payload (truncated to 64 KB)                                   |

Auto-cleanup keeps the last 500 rows.

### `notifications`

| Column           | Type    | Description                                                             |
| ---------------- | ------- | ----------------------------------------------------------------------- |
| `id`             | INTEGER | PK                                                                      |
| `at`             | TEXT    | time                                                                    |
| `audience`       | TEXT    | `admin` / `all` (CHECK)                                                 |
| `kind`           | TEXT    | `datalens.confirmation`, `datalens.notification`, `datalens.request`, … |
| `title` / `body` | TEXT    | title / text (body optional)                                            |
| `read_by`        | TEXT    | JSON array of user ids who have read the notification (default `[]`)    |

Shown in the cabinet bell (`GET /api/notifications`); "mark all read" —
`POST /api/notifications/read`. An analyst can request a DataLens connection
(`POST /api/integrations/datalens/request`) → an admin notification + an audit entry.

---

## Relations and invariants

- `decisions.hypothesis_id` → `hypotheses.id` (FK, `foreign_keys=ON`).
- `sessions.user_id` → `users.id` (FK ON DELETE CASCADE): deleting a user removes their sessions.
- Creating a `decision` atomically sets the linked hypothesis status to the `outcome`
  (green/yellow/red).
- `hypotheses.parent_id` → `hypotheses.id` (solution → problem).
- A hypothesis cannot be saved without the methodology format (≥3 assumptions across 3 categories,
  ≥2 methods, traffic light, deadline) — `validateHypothesis` from `@pca/shared`.
- `decisions` requires ≥1 evidence item.
- KPI progress: payments = B2B `paid` **+** purchase-goal reaches from Metrika (when the primary
  goal is `e_purchase`); an application ≠ a payment for application goals.
- Secrets in the DB (`sessions.token_hash`, `users.password_hash`, `app_settings.value` with
  `is_secret=1`, `ai_providers.secret_enc`) are stored only as a hash or ciphertext.

---

## Data flow

```
Stat API → raw_responses (raw) → normalization → channel_stats / utm_stats / geo_device_stats /
page_stats / exit_page_stats  →  SnapshotBuilder → report_snapshots.payload → DOCX/PDF + screen
DataLens ← CSV export (channels/utm/pages/geo_device/b2b) ← the same metric tables + b2b_manual
```

A repeated sync extends the daily history without overwriting past dates. Changing the KPI goal or
fixing units requires a clean DB (`rm data/productcamp.sqlite*`) — upserts accumulate and do not
remove stale rows. Live pages (`/api/live/*`) do not write to the DB — they read the Reporting API
directly.

See also: [architecture.md](architecture.md) · [admin-guide.md](admin-guide.md).
