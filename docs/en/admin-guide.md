# Administrator guide

> 🇬🇧 English · [🇷🇺 Русский](../admin-guide.md). Product version v3.1.0 · live site
> <https://dashboardcamp.ru>. A page-by-page walkthrough with buttons and screenshots lives in the
> cabinet's built-in help (`/help`, "Admin" section); this document is a self-contained
> administrator handbook.

An administrator sees everything an analyst sees ([user-guide.md](user-guide.md)) plus the
"Administration" section of the sidebar. Permissions are enforced on the server: `/api/admin/**`,
`/api/users`, changes to settings and AI providers, and data deletion are available only to the
Administrator role; everyone else gets HTTP 403 `ADMIN_ONLY`.

## 1. Initial setup (checklist)

1. **Server.** `.env` contains `APP_SECRET` (master key encrypting DB secrets), `COOKIE_SECURE=1`
   behind HTTPS and `DEMO_USERS=0` — see [deploy.md](../deploy.md) (RU).
2. **First sign-in.** The bootstrap administrator is created on start from `ADMIN_EMAIL` /
   `ADMIN_PASSWORD` while the `users` table is empty. After signing in, create a second
   administrator and remove the password from `.env`.
3. **Metrika & data** — counter, OAuth token, "Save" → "Refresh data from Metrika".
4. **AI providers** — at least one provider with a key: "Save" → "Test connection" → "Enabled".
5. **Users** — create analysts and hand over temporary passwords via a secure channel.
6. **Integrations** — DataLens if needed: API connection, webhook URL, dashboard links.
7. **Audit** — make sure every step was recorded.

## 2. Users and roles (`/app/admin/users`)

| Role          | Can                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Analyst       | Overview, Live, Goals, Funnels, Traffic, Behavior, KPI, Explore, Report, History, B2B, DataLens |
| Administrator | all of the above + Users, AI providers, Metrika & data, Integrations, Audit                     |

- **Create a user:** "Add user" → name, email, role → "Save". The temporary password is shown
  **once** — copy it and pass it on via a secure channel.
- **Reset a password:** "Reset password" issues a new temporary password and terminates all of the
  user's sessions. There is no self-service "forgot password" — an administrator resets it.
- **Change a role:** the "Role" dropdown in the user's row; applied immediately.
- **Disable:** "Disable" blocks sign-in and immediately ends all sessions; the record and its audit
  history are kept (users are never deleted).
- **Last-admin protection:** demoting or disabling the only active admin is rejected (HTTP 409).
  Keep at least two administrators.
- **Sign-in security:** scrypt password hashes; session cookie `pca_session` (HttpOnly), only the
  sha256 token hash is stored; lifetime `SESSION_DAYS` (7 days); 5 failed sign-ins within 15 minutes
  per IP+email → HTTP 429.

## 3. AI providers and keys (`/app/admin/ai`)

AI powers the report's AI analysis, AI hypotheses with the Decision Log, and the help RAG
assistant. Everything else (dashboards, funnels, DOCX/PDF) works without AI.

| Provider   | What you need                                | Where to get it                                                                                                    | Default model                 |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| OpenRouter | API key (`sk-or-…`)                          | openrouter.ai/keys → Create Key; requires Credits                                                                  | `anthropic/claude-sonnet-4.5` |
| Anthropic  | API key (`sk-ant-…`)                         | console.anthropic.com → Settings → API Keys; requires a balance                                                    | `claude-sonnet-4-6`           |
| YandexGPT  | service-account API key + folder ID (`b1g…`) | Yandex Cloud / AI Studio: service account with `ai.languageModels.user` → API key (`yc.ai.languageModels.execute`) | `yandexgpt/latest`            |
| GigaChat   | Authorization Key + scope                    | developers.sber.ru → GigaChat API project; scope `GIGACHAT_API_PERS` / `_B2B` / `_CORP`                            | `GigaChat-2-Pro`              |

**Order:** paste the key → extra fields (folder ID / scope) → "Save" → "Test connection" → tick
"Enabled".

- **Priority chain:** only enabled providers with a saved key participate; a lower priority runs
  first (defaults 10 / 20 / 30 / 40). Transient errors (429, 5xx, network) get up to 2 retries, then
  the request falls over to the next provider.
- **Storage:** keys are encrypted with AES-256-GCM using the `APP_SECRET` master key; the UI and API
  show only a mask `••••abcd`. An empty key field on save means "keep the current key".
- **Rotating `APP_SECRET`** makes stored keys undecryptable — re-enter them.
- **GigaChat and TLS:** Sber servers are signed by the Russian Trusted Root CA. The server needs
  `NODE_EXTRA_CA_CERTS` pointing to a PEM with the root and sub CA — `deploy/deploy.sh` installs
  them and sets the variable automatically. Symptom when missing: "gigachat: fetch failed" /
  `SELF_SIGNED_CERT_IN_CHAIN`.
- **`.env` keys** (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `YANDEX_AI_API_KEY` +
  `YANDEX_AI_FOLDER_ID`, `GIGACHAT_AUTH_KEY` + `GIGACHAT_SCOPE`) are applied once to an empty
  providers table; afterwards this page is the source of truth.
- **Statistics:** the "Usage over 30 days" block shows calls and errors per provider (`ai_usage`;
  request contents are not stored).

Provider-by-provider details and errors: the "LLM provider keys" help article (`/help`).

## 4. Yandex Metrika and data (`/app/admin/metrika`)

### Connection

Each field shows its value source: `db` (set in the admin UI), `env` (from `.env`), `unset`.
"Save" applies **without a restart** — the Metrika client is rebuilt.

| Field              | Key                                         | What to enter                                                            |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| Metrika counter    | `COUNTER_ID`                                | counter number                                                           |
| OAuth token        | `YANDEX_OAUTH_TOKEN`                        | `metrika:read` (+ `metrika:write` for goal management); stored encrypted |
| Client ID / secret | `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` | OAuth app for `pnpm auth`; the secret is stored encrypted                |
| "Order" goal       | `ORDER_GOAL_ID`                             | order goal id for live pages                                             |
| Report KPI goal    | `GOAL_ID`                                   | `0` = auto-detect the purchase goal during sync                          |
| Payment target     | `KPI_TARGET`                                | target number of payments (300)                                          |

Secret fields show a mask; leave it untouched to keep the value, or clear it and paste a new one.

### OAuth token

1. Create an app at oauth.yandex.ru with `metrika:read` and `metrika:write`.
2. Issue a token for an account with access to the counter — manually or with `pnpm auth` (writes
   `YANDEX_OAUTH_TOKEN` to `.env`; see [README.en.md](../../README.en.md)).
3. Paste the token into "OAuth token" → "Save" → check the Live page.

### Synchronization

- "Refresh data from Metrika" loads aggregates for the global filter period (14 days by default, up
  to 365): channels, UTM, geo/devices, entry and exit pages, goals.
- On the server the sync runs automatically every 3 hours (`pca-sync.timer`). A manual sync is
  needed after changing the counter/token, after creating goals, and to backfill long history.
- Robots and test sessions (`file:`) are excluded; `INCLUDE_TEST_TRAFFIC=1` disables the filter.
- **Danger zone:** "Clear Metrika data" (confirm by typing `УДАЛИТЬ`) deletes `raw_responses` and
  the derived tables; report snapshots, hypotheses, B2B, users and settings are kept. Run a sync
  right after. Audit: `data.clear_metrika`.

### Metrika goals

Goals are managed via the Management API and require a token with `metrika:write`. The operations
are available to administrators as API endpoints within the cabinet session:

| Operation | Request                                      |
| --------- | -------------------------------------------- |
| Create    | `POST /api/admin/metrika/goals`              |
| Archive   | `POST /api/admin/metrika/goals/<ID>/archive` |
| Restore   | `POST /api/admin/metrika/goals/<ID>/restore` |

Condition types: `exact`, `contains`, `starts`, `regex` (Metrika rejects `js`: a JS event is an
`action` goal with a condition on the event identifier). A new goal appears after the next sync.
Errors: 409 — Metrika not configured; 401 — token expired; 403 — no access to the counter or no
`metrika:write`; 429 — API rate limit. Audit: `metrika.goal_created / goal_archived /
goal_restored`.

## 5. Integrations: Yandex DataLens (`/app/admin/integrations`)

### DataLens Public API connection

| Field       | Key                    | Where to get it                                                                                        |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Org ID      | `DATALENS_ORG_ID`      | datalens.ru → organization settings → organization ID                                                  |
| Workbook ID | `DATALENS_WORKBOOK_ID` | from the URL `datalens.ru/workbooks/<ID>`                                                              |
| IAM token   | `DATALENS_IAM_TOKEN`   | `yc iam create-token` (lives ≤ 12 h) or a service-account token with a DataLens role; stored encrypted |

These settings live in the DB (`app_settings`), not in `.env`, and apply immediately. "Check
connection" calls the DataLens API and writes `datalens.check` to the audit log. Errors: "Not
filled: …"; 401 — IAM token expired; 403 — wrong Org ID or missing role; 404 — no such workbook;
15 s timeout — network.

CSV datasets (channels, UTM, pages, geo+devices, B2B deals) are connected in DataLens manually via
a Files connection; sources are served by `GET /api/integrations/datalens/export/:id`. The workbook
and the Metrika connection can be created by `scripts/push-datalens.mjs` (`DATALENS_IAM_TOKEN`,
`DATALENS_ORG_ID` in the process environment).

### Webhook and receiver token

- The URL looks like `https://<domain>/api/integrations/datalens/webhook/<token>`; the token in the
  URL (`DATALENS_WEBHOOK_TOKEN`, stored encrypted) is the receiver's only protection.
- "Issue a new URL" generates a new token and **the old URL stops working immediately**; audit —
  `datalens.token_rotated`.
- In DataLens: Settings → Notifications → Webhooks → "Add webhook" → URL → "Get code" → the code
  appears in the "Last confirmation code" card and in the bell.
- Events are stored in `datalens_events` (last 500).

### Dashboard links and analyst requests

- "DataLens dashboard links" (`DATALENS_LINKS`, one per line, `http(s)://`) are shown to everyone on
  the DataLens page.
- An analyst can "Ask the administrator to connect" — an admin notification and a
  `datalens.request` audit entry (at most 3 per hour per user).

## 6. Audit log (`/app/admin/audit`)

Answers "who changed what, and when". The latest 1000 entries, search, sorting, CSV export.
Secrets are never written to the log.

| Group    | Actions                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| Sign-in  | `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_changed`         |
| Users    | `users.create`, `users.update`, `users.reset_password`                            |
| Settings | `settings.update` (list of keys), `data.clear_metrika`                            |
| AI       | `ai.provider_update`, `ai.provider_test`                                          |
| Metrika  | `metrika.goal_created`, `metrika.goal_archived`, `metrika.goal_restored`          |
| DataLens | `datalens.export`, `datalens.request`, `datalens.check`, `datalens.token_rotated` |

Typical investigations: data disappeared — `data.clear_metrika`; who changed the token —
`settings.update` with `YANDEX_OAUTH_TOKEN`; password guessing — a series of `auth.login_failed`
for one email.

## 7. Backups, monitoring, operations

| What                      | How                                                                                                         | Details                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Nightly backup            | `pca-backup.timer` (04:30) → `deploy/backup.sh`: `sqlite3 .backup` → gzip → `/opt/pca/backups/`, 14 copies  | [deploy/DEPLOY.md](../../deploy/DEPLOY.md) (RU), § 5   |
| Off-site copy             | `scripts/pull-backup.sh` pulls the latest backup to the owner's machine (30 copies)                         | script header                                          |
| Restore                   | stop `pca-api` → swap the DB, delete `-wal`/`-shm` → start → `/api/health`                                  | [deploy/DEPLOY.md](../../deploy/DEPLOY.md) (RU), § 5.2 |
| Monitoring                | `pca-monitor.timer` (every 5 min): 3 consecutive `/api/health` failures → API restart; disk > 85% → warning | [deploy/DEPLOY.md](../../deploy/DEPLOY.md) (RU), § 5   |
| Deploy & update           | `deploy/deploy.sh`; manually — `git pull` → build → migrations → `systemctl restart`                        | [deploy.md](../deploy.md) (RU)                         |
| Running & troubleshooting | local run, PDF, common errors                                                                               | [runbook.md](runbook.md)                               |

Secrets (`.env`) are not part of DB backups — keep a separate, protected copy of `.env`. Without the
same `APP_SECRET`, tokens and keys encrypted in the DB cannot be decrypted after a restore.

## 8. Routine and common problems

- **Daily:** the bell (analyst requests, DataLens events); Live — data is flowing.
- **Weekly:** AI "Usage over 30 days"; `auth.login_failed` in the audit log; the user list is
  current; backups are fresh.
- **On events:** Metrika token or DataLens IAM token expired — issue a new one; an employee left —
  "Disable".

| Symptom                                      | Fix                                                         |
| -------------------------------------------- | ----------------------------------------------------------- |
| Live: "Metrika is not connected"             | set the counter and token in Metrika & data                 |
| Analytics empty while Live works             | no sync for the period — "Refresh data from Metrika"        |
| Sync fails with 401/403                      | token expired or cannot see the counter — issue a new one   |
| Tokens/keys gone after changing `APP_SECRET` | secrets cannot be decrypted — re-enter them                 |
| GigaChat: "fetch failed"                     | missing Russian Trusted Root CA / `NODE_EXTRA_CA_CERTS`     |
| DataLens sends no code                       | URL outdated after "Issue a new URL" — copy the current one |
| Analyst sees "No access"                     | admin-only section; change the role if needed               |

See also: [architecture.md](architecture.md) · [data-model.md](data-model.md) ·
[user-guide.md](user-guide.md).
