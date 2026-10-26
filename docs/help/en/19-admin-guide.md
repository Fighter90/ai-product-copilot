---
title: Administrator guide
section: Admin
order: 19
summary: A page-by-page walkthrough of the admin area — users, AI providers, Metrika and data, integrations, audit log. Fields, buttons, scenarios and errors.
---

# Administrator guide

An administrator sees everything an analyst sees (see “Analyst guide”, `/help/analyst-guide`) plus the “Administration” section in the sidebar. Every admin request is checked server-side: `/api/admin/*`, `/api/users`, settings changes and data deletion are available only to the Administrator role; others get HTTP 403.

The first administrator is created on first start from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` when the users table is empty. After that, users are created in the UI.

## Initial setup order

1. “Metrika & data” — counter and OAuth token, “Save”.
2. Same page — “Refresh data from Metrika” for the needed period.
3. “AI providers” — at least one provider with a key (`/help/llm-keys`).
4. “Users” — create analysts and hand out temporary passwords.
5. “Integrations” — DataLens if needed: API connection, webhook URL, dashboard links.
6. “Audit log” — check that every step was recorded.

## Users (`/app/admin/users`)

**Purpose.** Accounts, roles and access.

![Screenshot: users](/screenshots/17-admin-users.png)
_The users table and the “Add user” button._

| Element                  | What it does                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------- |
| “Add user”               | a dialog with “Name”, “Email”, “Role” (default “Analyst”) and “Save”                    |
| Temporary password card  | after create or reset — “Temporary password (shown once)”, with “Copy” and “Close”      |
| Table columns            | Name (a `you` badge on your row), Email, Role, Status (active / disabled), Last sign-in |
| “Role” dropdown in a row | changes the role immediately: Administrator / Analyst                                   |
| “Reset password”         | issues a new temporary password and ends all of the user's sessions                     |
| “Disable” / “Enable”     | blocks sign-in; disabling ends all active sessions of the user immediately              |

**Scenarios.**

- _New analyst:_ “Add user” → name, email, role “Analyst” → “Save” → “Copy” the password → hand it over via a secure channel. It is never shown again.
- _Forgotten password:_ find the user → “Reset password” → hand over the new temporary password. There is no self-service password form in the UI — the administrator resets it.
- _Someone left:_ “Disable”. The record and its audit history stay; sign-in and sessions are blocked.
- _Second administrator:_ switch the role in the row to “Administrator”. Keep at least two active administrators.

**Errors.** “Email already exists” (409; the UI message is in Russian) — a user with that email exists (enable them or reset the password). “The last administrator cannot be disabled or demoted” — appoint another administrator first.

## AI providers (`/app/admin/ai`)

**Purpose.** Keys and order of the four providers (OpenRouter, Anthropic, YandexGPT, GigaChat) for the report's AI analysis, AI hypotheses and the assistant.

In short: each card has “Key”, “Model”, “Priority” (lower goes first in the chain), extra fields (folder ID for YandexGPT, scope for GigaChat), “Save”, “Test connection” and the “Enabled” checkbox. Below is “Usage, last 30 days” (calls and failures per provider). Keys are AES-256-GCM encrypted and shown only as a mask.

Step-by-step instructions per provider, scenarios and errors — “LLM provider keys” (`/help/llm-keys`).

## Metrika & data (`/app/admin/metrika`)

**Purpose.** Counter connection, KPI goals, sync into SQLite and cache cleanup.

![Screenshot: Metrika & data](/screenshots/19-admin-metrika.png)
_The “Connection”, “Sync to SQLite” and “Danger zone” cards._

### “Connection” card

Each field shows a source badge: `db` (set in the admin UI), `env` (from `.env`), `unset`.

| Field           | Key                    | What to enter                                                                        |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| Metrika counter | `COUNTER_ID`           | the counter number, e.g. `54280963`                                                  |
| OAuth token     | `YANDEX_OAUTH_TOKEN`   | a token with `metrika:read` (plus `metrika:write` to manage goals); stored encrypted |
| App Client ID   | `YANDEX_CLIENT_ID`     | the OAuth app id — used by `pnpm auth` to obtain a token                             |
| Client secret   | `YANDEX_CLIENT_SECRET` | the OAuth app secret; stored encrypted                                               |
| “Order” goal    | `ORDER_GOAL_ID`        | the order goal id for live pages; defaults to the `reg_step1` JS event               |
| Report KPI goal | `GOAL_ID`              | `0` — auto-detect the purchase goal at sync                                          |
| Payments target | `KPI_TARGET`           | the target number of payments, e.g. 300                                              |

“Save” applies changes **immediately, without a server restart** (the Metrika client is rebuilt). A line “Save: …” then lists the changed keys; click it to dismiss.

Secret fields show a `••••abcd` mask. Leave the mask untouched to keep the value; to replace a secret, clear the mask and paste the new value.

Notes on the current version: a manual sync always auto-detects the primary purchase goal, and `GOAL_ID` is used as a fallback “order goal” for live pages when the “Order” goal is not set. “Payments target” is stored, but the KPI strips and the report use the built-in target of 300.

**Getting an OAuth token.**

1. At oauth.yandex.ru create an app (the link is in the hint above the form) with `metrika:read` and `metrika:write`.
2. Issue a token for an account with access to the counter (or run `pnpm auth` with Client ID / Client secret — it writes the token to `.env`).
3. Paste it into “OAuth token” → “Save”.
4. Check the Live page: if data appears, the token and counter are correct.

### “Sync to SQLite” card

“Refresh data from Metrika” loads Metrika aggregates for the global filter period (default — the last 14 days; change it with the filter on analytics pages): channels, UTM, geo and devices, entry and exit pages, goals. The report and the Overview, Traffic, Behaviour, Funnel & B2B and KPI & forecast pages depend on this data.

When finished, a line “Sync: {…}” shows the summary: number of goals, the detected primary goal id, days and rows per breakdown. Errors appear under the button.

On the server the sync also runs every 3 hours (`pca-sync.timer`). A manual sync is needed after changing the counter or token, after creating goals and to load long history (choose a period up to 365 days).

### Danger zone

“Clear Metrika data” → type `УДАЛИТЬ` in the dialog → “OK”. This deletes raw Metrika responses (`raw_responses`) and derived tables (channels, UTM, geo/devices, entry and exit pages). Report snapshots, hypotheses, B2B deals, users and settings are **kept**. Run a sync right after, otherwise analytics pages stay empty. Logged as `data.clear_metrika`.

### Metrika goals: create, archive, restore

Goal management uses the Metrika Management API and needs a token with `metrika:write`. The current UI has no dedicated form; the operations are available to administrators as API endpoints (they work within your cabinet session):

| Operation | Request                                      | Body                                                                                 |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Create    | `POST /api/admin/metrika/goals`              | `{"name": "…", "type": "action", "conditions": [{"type": "exact", "url": "event"}]}` |
| Archive   | `POST /api/admin/metrika/goals/<ID>/archive` | optional `{"folderId": N}` — the archive folder                                      |
| Restore   | `POST /api/admin/metrika/goals/<ID>/restore` | —                                                                                    |

Rules: goal types — `url`, `action`, `step`, `number`, `visit_duration`, `email`, `file`, `phone`, `search`, `social`, `chat`, `messenger`, `payment_system`. Condition types — `exact`, `contain`, `start`, `regexp`. Metrika rejects condition type `js`: a JS event is an `action` goal with a condition on the event id. `url` and `action` goals need at least one condition, `step` goals at least one step. A new goal appears in the cabinet after the next sync. All operations are logged (`metrika.goal_created`, `metrika.goal_archived`, `metrika.goal_restored`).

Goal-management errors (messages are in Russian):

| Meaning                                            | What to do                                                     |
| -------------------------------------------------- | -------------------------------------------------------------- |
| Metrika is not configured (409)                    | set the counter and token under “Connection”                   |
| Metrika rejected the goal (400)                    | fix type, conditions or name according to the error text       |
| OAuth token invalid or expired (401)               | issue a new token                                              |
| Counter not accessible or no `metrika:write` (403) | issue a token with `metrika:write` from an account with access |
| Goal not found (404)                               | check the goal id — it may already be deleted or archived      |
| Metrika API rate limit (429)                       | retry later                                                    |

## Integrations (`/app/admin/integrations`)

**Purpose.** The Yandex DataLens link: Public API access, the webhook receiver and dashboard links for analysts.

![Screenshot: integrations](/screenshots/20-admin-integrations.png)
_DataLens connection, webhook URL, latest code and events._

### DataLens connection

| Field / button     | What it does                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Org ID             | datalens.ru → Organisation settings → organisation ID                                                                                                |
| Workbook ID        | the id from `datalens.ru/workbooks/<ID>`                                                                                                             |
| IAM token          | `yc iam create-token` (lives up to 12 hours) or a service-account IAM token with a role in the DataLens organisation; stored encrypted, empty = keep |
| “Save”             | saves the fields, applied immediately                                                                                                                |
| “Check connection” | calls the DataLens API; success shows the workbook title                                                                                             |

Check errors: missing fields are listed by key; HTTP 401 — IAM token invalid or expired; HTTP 403 — check Org ID and your role in the organisation; HTTP 404 — workbook not found, check Workbook ID; a 15-second timeout or “DataLens API unavailable” — network problems from the server.

### DataLens webhook (receiver token)

- “Webhook URL for DataLens” shows `https://<domain>/api/integrations/datalens/webhook/<token>` and a “Copy” button. The token in the URL is what protects the receiver.
- “Issue a new URL” generates a new token; **the old URL stops working immediately** — update it in DataLens. Logged as `datalens.token_rotated`.
- Connecting: DataLens → Settings → Notifications → Webhooks → “Add webhook” → paste the URL → “Get code” → within seconds the code appears under “Latest confirmation code” → enter it in DataLens.
- “Events from DataLens” — recent incoming events (confirmation codes and alerts) with time and payload; refreshed every 5 seconds. Events also reach the notification bell.

### Dashboard links

“DataLens dashboard links (one per line)” → “Save”. Links starting with `http://` or `https://` appear for all users on the DataLens page under “Team DataLens dashboards”.

### Analyst requests

On the DataLens page an analyst can send “Ask an administrator to connect” with a note. Administrators get a bell notification, and the request is logged (`datalens.request`). Limit — 3 requests per hour per user.

## Audit log (`/app/admin/audit`)

**Purpose.** Answering “who changed what and when”. Entries are append-only; secrets are never logged.

The table shows the latest 1000 entries and refreshes every 30 seconds. Columns: When, Who, Action, Target, Details (first 120 characters). Search, column sorting, column picker, pagination and “Download CSV” are available.

| Group    | Actions                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| Sign-in  | `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_changed`         |
| Users    | `users.create`, `users.update`, `users.reset_password`                            |
| Settings | `settings.update` (list of changed keys), `data.clear_metrika`                    |
| AI       | `ai.provider_update`, `ai.provider_test`                                          |
| Metrika  | `metrika.goal_created`, `metrika.goal_archived`, `metrika.goal_restored`          |
| DataLens | `datalens.export`, `datalens.request`, `datalens.check`, `datalens.token_rotated` |

**Scenarios.** “Why did the data disappear?” — look for `data.clear_metrika`. “Who changed the token?” — `settings.update` with `YANDEX_OAUTH_TOKEN` in the target. “Password guessing?” — a series of `auth.login_failed` for one email (sign-in is blocked after 5 failures in 15 minutes).

## Daily and weekly admin routine

- **Daily:** the bell (analyst requests, DataLens events); Live — data is flowing; on empty days — a manual sync.
- **Weekly:** “Usage, last 30 days” for AI providers (rising failures — check keys and balance); the audit log for `auth.login_failed`; the user list is up to date.
- **On events:** Metrika token expired — new token and sync; someone left — “Disable”; new campaign — a goal via the API and a sync.

## Common problems

| Symptom                                           | Cause and fix                                                   |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Live pages say Metrika is not connected           | counter or token missing — “Metrika & data” → “Connection”      |
| Analytics empty while Live works                  | no sync for the period — “Refresh data from Metrika”            |
| Sync fails with 401/403                           | token expired or cannot see the counter — issue a new one       |
| Tokens and keys gone after an `APP_SECRET` change | secrets cannot be decrypted — re-enter them                     |
| An analyst sees “No access”                       | it is an admin section; change their role if needed             |
| DataLens sends no code                            | the URL is stale after “Issue a new URL” — copy the current one |
