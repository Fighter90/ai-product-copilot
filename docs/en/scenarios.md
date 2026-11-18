# Scenarios — step-by-step recipes

> Document version: v3.4.64 (2026-11-18). 🇬🇧 English (mirror: [docs/scenarios.md](../scenarios.md)).
> Working step-by-step scenarios: from the morning check to the weekly hypothesis loop.

---

## Scenario 1. Morning check (5 minutes)

**Goal:** understand the day's status without diving in.

1. Sign in → **Overview**.
2. Hero: «On track to 300?» — the status (on/off track), forecast, payment pace.
3. Tiles: VISITS / B2C APPLICATIONS / B2B PIPELINE / PAID B2B — and Δ vs the previous period.
4. **Weekly digest** — what changed (▼/▲ WoW).
5. **Weak spots** — the top problems with numbers.
6. **Live** — what is happening right now (if there is any activity).

**Result:** 3 talking points for the morning standup.

---

## Scenario 2. Weekly report (10 minutes)

**Goal:** send the team a documented weekly summary.

1. **Report** → period `7d` (or «Dates» for specific days) → **Build report**.
2. Check the preview: 17–18 sections, the «Marketing» section (when the week intersects), the TOC in place.
3. **Export DOCX** — wait for the download (file name: `productcamp-report-<snapshotId>.docx`).
4. If needed **Export PDF** (for email/messenger).
5. **History** — make sure the snapshot with the «Current» badge is pinned (plan→fact).
6. Send the file + the snapshot link (`/app/report?snapshot=<id>`) — the recipient opens the same report 1:1.

**Important:** the file is deterministic — no matter how many times you download it, the bytes match what you sent.

---

## Scenario 3. The weekly hypothesis loop (Discover → Decide)

**Goal:** from weak spots to made decisions.

**Part A — discovery (Monday):**

1. **Overview → Weak spots** → pick a 🔴 item (e.g. «Direct 1 774 visits · CR 0.2%»).
2. **«→ hypothesis»** — the form is prefilled (subject, title, evidence with the CR number and channel).
3. Complete: audience, observation, **≥3 assumptions** (why the pain exists), **≥2 methods** (e.g.: 5 interviews + an A/B on the landing), traffic light (🟢 CR ≥ 2%), deadline.
4. Save → the card lands in «Draft».

**Part B — prioritization (Tuesday):** 5. Walk the kanban, set/verify **ICE** (I×C×E, product). The top of the column is the order of work.

**Part C — verification (Wed–Thu):** 6. Move the card to **«In check»**. Execute the listed methods. Record the numbers.

**Part D — decision (Friday):** 7. **Decisions → New decision**: hypothesis, date, «what we do», verification period, cut, **evidence** (quote+source), **outcome** 🟢/🟡/🔴 per the traffic-light thresholds + rationale, next step. 8. The hypothesis card → «Confirmed»/«Partial»/«Rejected». 9. The week's result is visible: the kanban (stages) + the Decision Log (decisions with outcomes).

---

## Scenario 4. Creating a B2B deal (2 minutes)

1. **B2B Deals** → «New deal».
2. Company («Acme LLC»), **tickets** (e.g. 25; integer ≥1), amount, date.
3. Create → the deal lands in **LEAD**.
4. During negotiations drag it to **NEGOTIATION** — the «B2B PIPELINE» tile grows by 25.
5. Payment: drag to **PAYMENT** → «PAID B2B» +25; KPI and the report take it into account.
6. If the deal fell through — delete it in the «Table» tab (confirm).

---

## Scenario 5. What-if «what if traffic +30%?»

1. **KPI & Forecast** → find the **«Traffic: ±N%»** slider.
2. Move it to **+30%**: the application pace recalculates (e.g. 0.8 → 1.0/day), the goal date and «+N days (behind)» update instantly.
3. Compare with the baseline: slider to 0 returns the original forecast.
4. **The state is not saved** — it's a decision calculator, not a plan.

---

## Scenario 6. Cross-checking the report against Overview and Metrika

**Goal:** make sure report numbers = dashboard numbers.

1. Build a report for the period (e.g. 14d) — note the `snapshotId` from the URL.
2. Write down from the preview: visits, applications, B2B payments, GAP, CR, top-3 channels.
3. Open **Overview** with the same period — cross-check every number (tolerance ±0%: one source).
4. A disputed number? Via the mart's `query_hash` go back to the raw response in `raw_responses` (view through the admin API/SQLite).
5. DOCX/PDF: open the downloaded file — the same numbers (text from the same snapshot).

---

## Scenario 7. Preparing for the deadline (a week before Nov 21)

1. **KPI & Forecast**: note the «+N days (behind)» and the required pace (~75/day at 0 payments).
2. **Overview**: hero status → weak spots → every problem hypothesis with CR issues — into this week's work.
3. **B2B Deals**: push negotiations — every deal in «PAYMENT» = tickets toward the goal.
4. **Marketing**: make sure partner activation weeks are filled (they will enter the report).
5. The weekly **Report** — for the coordination; record the outcomes in Decisions.
6. Final: a 30d report (the «Marketing» section mandatory) + DOCX into the archive.

---

## Scenario 8. Onboarding a new volunteer (15 minutes)

1. The admin creates a user (Analyst role) and hands over the temporary password securely.
2. The newcomer signs in, completes the onboarding tour (5 steps), sets language/theme.
3. Reads **Help** → «Roles», «Overview», «Funnel» articles.
4. Walks Scenario 1 (the morning check) with a mentor.
5. Homework: create one problem hypothesis from weak spots (Scenario 3, part A).

---

## Scenario 9. Report determinism check (audit, 3 minutes)

1. **Report** → build a snapshot.
2. **Export DOCX** ×2 → compare file sizes/hashes — identical.
3. **Export PDF** ×2 → the same (a second render; the first after a server restart may differ — a known cold-fonts quirk).
4. Stable mismatch? → an issue with the `snapshotId` and both files.

---

## Scenario 10. Switching the interface and report language

1. The **RU/EN** toggle in the top bar — the whole dashboard switches (data unchanged).
2. An EN report: build/open a snapshot → **Export DOCX/PDF** with EN enabled → the file gets the `-en` suffix and EN chrome.
3. Switch back to RU the same way.
