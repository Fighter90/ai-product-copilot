# Troubleshooting

> Document version: v3.4.64 (2026-11-18). 🇬🇧 English (mirror: [docs/troubleshooting.md](../troubleshooting.md)).
> Format: **Symptom → Cause → Fix**. No fix listed — file a Linear issue (team ANA).

---

## 1. Sign-in and access

### 1.1 «Wrong email or password»

- **Causes**: typo; the password was rotated; caps lock/layout.
- **Fix**: verify credentials with the admin; after 5 failures — a temporary lock, wait. The admin can reset the password (admin panel → Users → «Reset password»).

### 1.2 «No access» on a direct URL (`/app/admin/...` as an analyst)

- **Cause**: RBAC — the admin panel is Administrator-only.
- **Fix**: by design. Need access — ask the admin to change the role.

### 1.3 After Logout, the Back button shows the dashboard for a second

- **Cause**: the browser's bfcache serves a stale shell from cache.
- **Fix**: refresh the page (F5) — no data leaks (the session is revoked, the API answers 401). If the shell hangs longer than 2–3 seconds — report it (backlog ANA-197).

### 1.4 The onboarding tour shows again

- **Cause**: the tour shows once per sign-in; a repeat after changing the language in the profile modal is a known nit (backlog ANA-197).
- **Fix**: «Skip tour». If it appears on every reload — it's a bug, file an issue.

### 1.5 Language/theme reset

- **Cause**: localStorage cleared (private mode, site data wipe).
- **Fix**: toggle RU/EN and the theme again — the choice will stick.

## 2. Data and sync

### 2.1 Empty Overview / «0 visits» where data is expected

- **Causes**: no sync for the period; the period filter is outside the data range; the B2B segment is selected (goal tiles hidden — by design).
- **Fix**: check the period (14d by default); verify the nightly sync ran (admin: `/opt/pca/data`, the `sync_runs` table); run sync (`pnpm sync` / scheduler).

### 2.2 Sync fails

- **Causes**: expired `METRIKA_OAUTH_TOKEN`; Reporting API quotas; API unavailability.
- **Fix**: admin → Metrika → token check; refresh the token (OAuth); on quotas — wait for the window / reduce frequency; error logs in `sync_runs` and `raw_responses` (statuses).

### 2.3 UTM table: a lot of `(none)`

- **Cause**: direct/unmarked traffic; UTM coverage ~31–32% is normal for this camp.
- **Fix**: improve campaign tagging (utm_source/medium/campaign required in all links).

### 2.4 Overview and funnel numbers differ

- **Must not happen**: both use the single `periodTotals`. If the gap is >0% — it's a bug; file an issue with the period and screenshots.

### 2.5 pc-goals funnel: the «Payment» stage is missing

- **Cause**: the counter has no payment goal (`source: none`) — «Payment» falls back to B2B payments of the period.
- **Fix**: create a payment goal in Metrika or use the B2B input.

### 2.6 The «GOAL / REMAINING TO GOAL» tiles disappeared

- **Cause**: the **B2B** segment is selected — Metrika goals belong to the overall flow; B2B has none.
- **Fix**: switch back to `B2C+B2B`. The explanation instead of the tiles is by design.

## 3. Reports and export

### 3.1 Export buttons show «Preparing…» for a long time (>30 s)

- **Cause**: PDF is rendered by the server-side Chrome — 12–20 s normally; slower with several parallel requests.
- **Fix**: wait; repeated clicks are impossible (buttons disabled). If >60 s and an error appears in the ErrorBox — see 3.3.

### 3.2 The export does not download / no file

- **Causes**: the browser blocks downloads; disk full; a render failure.
- **Fix**: check the downloads folder; retry once; the error shows in the ErrorBox above the preview (the HTTP status text). Systematic — an issue with the `snapshotId`.

### 3.3 Two DOCX/PDF downloads differ byte-wise

- **Must not happen**: determinism is covered by tests (dates pinned from the snapshot). One known exception — the **first PDF render after a server restart** (cold fonts).
- **Fix**: download again — the second and later files are identical. Stable reproduction — an issue.

### 3.4 «The report behind this link was not found…»

- **Cause**: `?snapshot=<id>` points to a deleted/invalid snapshot.
- **Fix**: go to **History** (the banner link) and pick the snapshot or build a new one.

### 3.5 No «Marketing» section in the report

- **Cause**: the period intersects no filled partner weeks (`marketing_weekly`).
- **Fix**: build the report for a period crossing filled weeks (e.g. 30d), or fill the grid on the Marketing page.

### 3.6 AI analysis: «provider unavailable» / poor quality

- **Causes**: all providers in the chain are excluded (balance/key); the LLM is down.
- **Fix** (admin): admin panel → AI providers → connection check, enable a live one (OpenRouter with 372 calls/30d is the reference), refresh the key. Low quality — adjust the period/language and retry (every call is logged to `ai_usage`).

## 4. Hypotheses and decisions

### 4.1 «Save» is blocked in a hypothesis

- **Cause**: the blockers panel lists what's missing (≥3 assumptions, ≥2 methods, traffic light, deadline, format).
- **Fix**: fill the panel's items; empty assumption/method rows should not block (if they do — a bug).

### 4.2 A decision does not save

- **Causes**: no hypothesis picked; no date; empty «Decision»; no evidence (quote+source); empty outcome rationale.
- **Note**: findings are NOT required: empty rows are dropped and do not block (ANA-198/63).

### 4.3 A hypothesis moved to «Overdue» by itself

- **Cause**: the deadline passed with a non-terminal status — automatic transition.
- **Fix**: open the card → reconsider (close/reformulate/move the deadline via «Edit»).

## 5. B2B deals

### 5.1 «Tickets: an integer of at least 1»

- **Cause**: negative/zero/fractional tickets.
- **Fix**: enter an integer ≥1. The amount is any non-negative value.

### 5.2 Cannot delete a deal from the kanban

- **Cause**: deletion is only in the «Table» tab.
- **Fix**: Table → the deal row → Delete → confirm.

### 5.3 B2B payments did not appear in KPI

- **Cause**: the deal is not in the «paid» stage (or tickets=0).
- **Fix**: drag the deal to PAYMENT (kanban) or change the stage in the table; refresh the KPI.

## 6. Infrastructure (for admins)

### 6.1 `/api/health` does not respond / 502

- **Causes**: `pca-api` is down; nginx cannot reach it.
- **Fix**: `systemctl status pca-api` → `journalctl -u pca-api -f` → resolve (disk full? DB locked?) → `systemctl restart pca-api` → health.

### 6.2 Health shows an old version after a deploy

- **Causes**: rsync did not land; no restart happened; the gate was skipped.
- **Fix**: repeat `SSH_KEY=~/.ssh/pca_deploy ./deploy/deploy.sh` — a deploy counts as successful only when health = the build version.

### 6.3 Backups are not created

- **Check**: `ls -lt /opt/pca/backups | head`; the `backups/backup.log`; the timer status (`systemctl list-timers`).
- **Fix**: resolve the logged cause (disk, lock file); run backup.sh manually.

### 6.4 DataLens: datasets unavailable

- **Cause**: the `DATALENS_IAM_TOKEN` expired.
- **Fix**: `scripts/refresh-datalens-token.mjs` (needs `PCA_ADMIN_PASSWORD`, `PCA_SSH_HOST`, local `yc`).

### 6.5 Everyone sees the «New version» banner

- **Cause**: prod updated (BuildMismatchBadge compares the UI build version with the API).
- **Fix**: reload the page (F5) — the banner goes away.

## 7. Useful checks

```bash
# health + version
curl -s https://dashboardcamp.ru/api/health | head -c 200
# service status and live logs
systemctl status pca-api && journalctl -u pca-api -f
# fresh backups
ls -lt /opt/pca/backups | head
# export byte-identity (curl with a session)
curl -b cookies.txt -o a.pdf "https://dashboardcamp.ru/api/report/download/<id>/pdf" && \
curl -b cookies.txt -o b.pdf "https://dashboardcamp.ru/api/report/download/<id>/pdf" && \
shasum a.pdf b.pdf
```
