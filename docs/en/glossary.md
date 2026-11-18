# Glossary

> Document version: v3.4.64 (2026-11-18). 🇬🇧 English (mirror: [docs/glossary.md](../glossary.md)).
> Alphabetical order. An asterisk (*) marks terms backed by a product rule.

---

**A**

- **ADR (Architecture Decision Record)** — a numbered record of an architecture decision (`docs/decisions/NNN-*.md`). A new dependency outside the stack — via an ADR only.
- **AI analysis** — an LLM-chain structured analysis of a report snapshot. Does not enter DOCX/PDF without an explicit action. The executing provider is recorded (attribution).
- **Archived goals** — Metrika goals past the age threshold (`ARCHIVED_GOAL_ID_THRESHOLD`); shown via a separate checkbox.

**B**

- **B2B deal** — a manual record of a corporate purchase (`b2b_manual`): company, tickets (integer ≥1), amount, stage. The «PAYMENT» stage = paid tickets in KPI.*
- **bfcache** — the browser's back/forward cache; the source of stale shells after logout (backlog).

**D**

- **Data mart** — a derived table (`channel_stats`, `utm_stats`, `geo_device_stats`, `page_stats`) computed from `raw_responses`. The UI reads only marts.
- **Decision Log** — the journal of decisions: hypothesis, date, «what we do», method, period, cut, evidence, outcome 🟢🟡🔴 + rationale, next step, decided-by.*
- **Determinism** — a report property: one `snapshotId` → byte-identical DOCX/PDF.*
- **Digest** — the weekly summary on Overview: visits/applications with Δ WoW, top channel.

**E**

- **Export** — DOCX/PDF from a snapshot (?lang=ru|en; EN gets an `-en` suffix); buttons disabled with «Preparing…» during rendering.

**F**

- **Findings** — optional decision rows («finding + confidence high/medium/low»); empty ones are dropped.*

**G**

- **GAP** — the remainder to the goal: `GOAL − PAID` (=300 at zero payments).
- **Goal (Metrika)** — an event/action in the counter; funnel roles are assigned by the classifier; `GOAL_ID=0` — auto-pick the payment goal.

**H**

- **Hardening** — prod protection measures: nginx 80/443+HSTS, non-root systemd, scrypt, HttpOnly, audit log.
- **Hypothesis (format)** — «{AUDIENCE} will {action}, if {condition}»; two kinds: problem and solution.*

**I**

- **ICE** — hypothesis prioritization: **I**mpact × **C**onfidence × **E**ffort, scale 1–5. **A product, not the mean** (ADR-005).*
- **Immutable snapshot** — see Snapshot.

**K**

- **Kanban (hypotheses)** — 6 columns: Draft, In check, Confirmed, Partially confirmed, Rejected, Overdue.

**M**

- **Marketing grid** — `marketing_weekly`: partner weeks with visits/clicks/payments; the source of the report's «Marketing» section.
- **Metrika token** — the OAuth token (`METRIKA_OAUTH_TOKEN`); verified in the admin panel.
- **Method (verification)** — quantitative / qualitative / composite; a hypothesis has ≥2.

**O**

- **Onboarding tour** — a 5-step intro shown once after the first sign-in.
- **Overview** — the main summary page: hero, KPI tiles, 4 charts, weak spots, digest, UTM table.

**P**

- **pc-goals** — user JS goals of the counter (registration/cart/contacts), the base of the participant funnel.
- **Plan → fact (cumulative)** — the plan line to the goal and actual payments on KPI; pinned in snapshots (`kpi_target`/`kpi_paid`).
- **Problem pages** — pages with bounce > 50% and sufficient volume (+ a separate low-CR list).

**Q**

- **Quotas (Reporting API)** — Metrika request limits; sync runs in sequential daily chunks.

**R**

- **RAG assistant** — the help assistant on `/app/help`, answering from the help articles.
- **Raw responses** — full Metrika JSON responses before normalization; the basis of traceability.*
- **Required hypothesis fields** — the format, ≥3 assumptions, ≥2 methods, traffic light, deadline. Without them Save is blocked.*

**S**

- **Session** — the HttpOnly cookie `pca_session`; revoked on password reset/logout.
- **SMART goal** — «Reach ≥300 paid tickets by Nov 21, 2026»; set by the admin (goal+deadline), feeds hero/KPI/report.
- **Snapshot** — an immutable JSON of the whole report context (`report_snapshots`): id, generated_at, period, payload. A rebuild = a new id.*
- **Swarm** — the AI-agent pipeline: Linear Todo+`swarm` → development → gates → review → release. See wiki/Swarm.

**T**

- **Test traffic** — a checkbox on live pages: include/exclude test visits.
- **Traffic light** — hypothesis outcome criteria: 🟢 ≥X, 🟡 Y–X, 🔴 <Y; a decision must reference them.*
- **Troubleshooting** — the symptom→cause→fix guide (`docs/troubleshooting.md`).

**U**

- **UTM** — campaign tagging (source/medium/campaign); `(none)` = direct/unmarked.
- **UTM coverage** — the share of marked traffic; ~31–32% is normal.

**V**

- **Visits** — one source: `periodTotals(stats)` for cards, funnel and KPI (±0%).

**W**

- **Weak spots** — the auto list of problems on Overview/report with numbers and «→ hypothesis».
- **What-if** — the «Traffic ±N%» slider on KPI: instant forecast recalculation without saving.*
