---
title: Roles: what is available
section: Basics
order: 14
summary: The full permission matrix — what Administrators and Analysts see on every cabinet page.
---

# Roles: what is available

There are two roles in the cabinet. The role is assigned by an administrator when creating a user and can be changed later («Admin → Users»). Permission checks run on the backend for every API call — hiding sections in the UI is a convenience; the data is protected directly.

## Permission matrix by section

| Section                                               | Administrator | Analyst |
| ----------------------------------------------------- | ------------- | ------- |
| Overview (KPI, “on track for 300”, What-if scenarios) | ✅            | ✅      |
| Live (real time)                                      | ✅            | ✅      |
| Metrika Goals + goal detail                           | ✅            | ✅      |
| pc-goals funnel (live)                                | ✅            | ✅      |
| Traffic (channels, UTM)                               | ✅            | ✅      |
| Behaviour (geo, devices, pages)                       | ✅            | ✅      |
| Funnel & B2B                                          | ✅            | ✅      |
| KPI & forecast                                        | ✅            | ✅      |
| Explore (11 presets)                                  | ✅            | ✅      |
| Report (snapshot, DOCX/PDF, hypotheses, AI analysis)  | ✅            | ✅      |
| History                                               | ✅            | ✅      |
| B2B deals                                             | ✅            | ✅      |
| DataLens (CSV export, request update)                 | ✅            | ✅      |
| Help & assistant                                      | ✅            | ✅      |
| Users                                                 | ✅            | ❌ 403  |
| AI providers                                          | ✅            | ❌ 403  |
| Metrika & data (sync, goals, cleanup)                 | ✅            | ❌ 403  |
| Integrations (webhook token)                          | ✅            | ❌ 403  |
| Audit log                                             | ✅            | ❌ 403  |

## What the Analyst sees on each page

- **Overview** — the goal KPI strip (orders out of 300, pace, What-if forecast with two sliders: traffic ±50%, conversion +0…5 pp), the weekly digest, collapsed channel and page sections.
- **Live** — today straight from the Reporting API: reaches for every goal, compared with yesterday and the 14/90-day average.
- **Metrika Goals** — live/sleeping/dead statuses, duplicates; click a goal for dynamics and breakdowns.
- **pc-goals funnel** — live stages from ticket view to application, split by standard/optimal/max tariffs and application roles.
- **Traffic** — channels with CR and benchmarks (🟢/🔴), the UTM table with the B2C/B2B segment filter.
- **Behaviour** — geo, devices, entry/exit pages with bounce rate.
- **KPI & forecast** — the “Forecast” tab (pace, target date, deadline) and the “B2B” tab (pipeline by stage, amount, average cheque).
- **Explore** — 11 cut presets with search and CSV.
- **Report** — snapshot creation, DOCX/PDF export, hypotheses with ICE and the Decision Log, AI analysis.
- **DataLens** — downloading 5 CSV datasets and the “Request update” button (notifies administrators).

## Administrator-only

- **Users** — creation (the password is returned once), role changes, deactivation, password reset (also one-time).
- **AI providers** — OpenRouter / Anthropic / YandexGPT / GigaChat keys (AES-256-GCM encrypted), models, “Test”, token usage stats.
- **Metrika & data** — counter check, manual sync (goals, channels, UTM, geo, pages, exit pages, browsers/OS, new/returning), goal create/archive via the Management API, data cleanup.
- **Integrations** — DataLens webhook token generation (paste it into DataLens alerts), event history.
- **Audit** — the log: sign-ins, settings changes, goal creation, exports.

## Guest access

Without signing in: the landing page, `/help` (the whole help section, RU/EN) and the RAG assistant (5 questions per 10 minutes; signed-in users get 20).

## If a page is unavailable

An analyst opening `/app/admin/*` directly sees the “Access denied” panel — expected: the check runs server-side (HTTP 403) and cannot be bypassed from the UI.
