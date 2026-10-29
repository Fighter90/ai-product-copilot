---
title: When something does not work
section: Reference
order: 24
summary: 14 common situations as «symptom → cause → action»: empty charts, 429/Metrika quota, logout, 504 AI analysis, gaps in data, login and deploy issues.
---

# When something does not work

Format: **symptom → likely cause → what to do**. If your case is not described — collect the
details (page, time, browser console error text) and pass them to the administrator;
infrastructure details live in `docs/runbook.md`.

## Data and sync

### 1. Charts are empty, «run a sync»

**Cause:** no data in the DB for the selected period — the sync has not run yet or the window
does not cover the period. **Action:** admin — `Administration → Metrika and data` → run a
sync with the dates. The first sync loads the window; afterwards a daily auto-sync for
yesterday runs (systemd timer). Analyst: switch to a covered period — the FilterBar offers
«Backfill N days».

### 2. Sync failed with 429 / «quota»

**Cause:** Metrika API limits — a large window hits the request quota. **Action:** nothing is
lost — the sync snapshots the window and restores it. Load smaller chunks or enable
`METRIKA_REQUEST_DELAY_MS` pacing (ms between requests). The last run status is in
`Administration → Metrika and data` (ANA-15: steps and their errors).

### 3. Numbers differ between pages

**Cause:** pages aggregate different slices (channels ≠ entry pages). The canonical KPI slice
is by channels. **Action:** compare against `/app/kpi` and the report; if the same metric
disagrees — that is a bug, file an issue. Integrity check: `node scripts/reconcile-data.mjs`
(Metrika ↔ DB ↔ CSV).

### 4. A visible «gap» in b2b/b2c — several missing days

**Cause:** data before the sync started or missed manual entry. **Action:** open
`GET /api/payments/coverage` — gaps ≥ 3 days are listed. Close them: B2B — CSV import
(`POST /api/b2b/import`), B2C — the import on the payments page; Metrika — a window sync. KPI
and the forecast recompute automatically.

### 5. A grid week is empty, not zero

**Cause:** no source data for those weeks (usually before the site launch). Empty = «no data»,
zero = «data exists, zero events». **Action:** backfill Metrika for the period and press Sync
on the marketing page, or enter the value manually.

## Login and session

### 6. «Invalid credentials»

**Cause:** typo, keyboard layout or a deactivated account. **Action:** check the e-mail/password
and layout; 5 failures in 15 minutes — a temporary IP block (wait). The password is reset by an
admin: `Administration → Users → Reset password`.

### 7. Logged out after a «Server unavailable» error

**Cause (historical):** 502/503 from nginx used to log people out. **Current behaviour:** 5xx
does not log you out — the cabinet shows a «Server unavailable» screen and retries; only
401/403 treat you as a guest. If you were still logged out — refresh and sign in again; the
session lasts 7 days with «Remember me».

### 8. No access to admin sections

**Cause:** the `analyst` role — admin navigation is hidden and direct requests return 403 (a
protection, not a bug). **Action:** ask an administrator to change the role
(`Administration → Users`).

## Reports and AI

### 9. «Build report» / AI analysis spins and returns 504

**Cause:** DOCX/PDF generation and AI analysis take minutes; an nginx timeout. **Action:** the
timeout for `/api/report/` is already raised to 600 s; if 504 repeats — the build continues in
the background, refresh the page: the snapshot appears in «History». AI analysis can be
regenerated (provider dropdown above the button).

### 10. The AI button is disabled — «no providers»

**Cause:** no AI provider configured or the key is missing. **Action:** admin —
`Administration → AI providers`: enable a provider (OpenRouter / Anthropic / YandexGPT /
GigaChat), set the key, press «Test». The chain works in priority order.

### 11. GigaChat: «self signed certificate in certificate chain» / fetch failed

**Cause:** the Russian root certificate is not installed on the server. **Action:** deploy.sh
does it automatically (`russian-trusted-ca.pem` + `NODE_EXTRA_CA_CERTS` in .env); manually —
see `docs/runbook.md`, the GigaChat section.

## The Marketing page

### 12. Weeks are empty instead of zero

**Cause:** no source data (the period before the site launch). **Action:** admin — a Metrika
window sync + the Sync button; analyst — enter values manually (the sync will not overwrite
them). Details — [Marketing & influence partners](21-marketing.md).

### 13. My grid edit «disappeared»

**Cause:** it cannot — `manual` edits are protected from sync and import. **Action:** open the
cell tooltip — it shows the source, author and time of the last change. If the cell is
`metrika` — a manual value was never saved there (check the right week/row).

### 14. No «Sync» button / 403 on sync

**Cause:** the sync spends Metrika quota — admins only. **Action:** analyst — manual entry (an
equally valid workflow) or ask an admin; admin — check the role (`Administration → Users`) and
retry.

## What to collect before asking for help

1. The page URL and exact time.
2. The error text from the browser console (F12 → Console).
3. A screenshot and the role you are signed in with.
4. For data issues — the period and the counter.

For administrators additionally: `journalctl -u pca-api -n 100`, the last sync status
(`Administration → Metrika and data`), the `GET /api/payments/coverage` output.
