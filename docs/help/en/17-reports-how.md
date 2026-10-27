---
title: How reports are built
section: Reports
order: 17
summary: The data path from Metrika to DOCX/PDF — sync, snapshot, charts, GOST structure, AI analysis, ICE hypotheses and the layout verifier.
---

# How reports are built

A report is not a “dashboard screenshot” — it is a separate, immutable document. Below is the full data path step by step, plus what to click on the Report page (`/app/report`).

## The pipeline at a glance

| Step | What happens                                       | Where the data lives                 | AI involved |
| ---- | -------------------------------------------------- | ------------------------------------ | ----------- |
| 1    | Metrika sync → SQLite                              | `raw_responses` + aggregate tables   | no          |
| 2    | Data snapshot for a period                         | `report_snapshots`, JSON payload     | no          |
| 3    | Charts (3 PNGs) and 🟢/🔴 blocks                   | rendered from the snapshot on export | no          |
| 4    | DOCX per GOST R 7.32-2017                          | built from the snapshot              | no          |
| 5    | PDF via headless Chrome                            | built from the same snapshot         | no          |
| 6    | AI analysis, AI hypotheses, Decision Log proposals | appended to the same snapshot        | yes         |
| 7    | Layout check `scripts/verify-report-gost.mjs`      | the finished DOCX                    | no          |

The key rule: steps 3–5 never call Metrika or AI — only the stored snapshot. That is why the numbers on screen, in DOCX and in PDF are identical.

## Step 1. Metrika sync into SQLite

- The sync asks Metrika (Stat API) for daily aggregates: channels, UTM tags, geo and devices, entry and exit pages, goals.
- Every raw Metrika response is stored in `raw_responses` — the **source of facts**. The aggregates `channel_stats`, `utm_stats`, `geo_device_stats`, `page_stats`, `exit_page_stats` are derived from it.
- On the server the sync runs every 30 minutes (systemd timer `pca-sync.timer`). Manually — the “Refresh data from Metrika” button under “Administration → Metrika & data” (administrators only).
- Robots and service visits are filtered out by default.

If no sync covered the period, the report is empty: the recommendations block says there is no channel data for the period and asks to sync Metrika.

## Step 2. The data snapshot

The “Build data snapshot” button (RU label «Сформировать срез данных») builds a snapshot for the period in the global filter. It reads **only the local database** (no live Metrika calls) and freezes:

- **KPI** — the 300 paid-ticket target, B2C applications (sum of primary-goal reaches), B2B paid tickets and the gap to target. If the primary goal is a purchase goal, its reaches also count as payments;
- **channels** — visits, users, bounces, goal reaches per channel;
- **the funnel** — visits → B2C applications → B2B in progress → B2B paid;
- **breakdowns** — top UTM, top geo and devices, top entry and exit pages;
- **B2B deals** — the pipeline state at snapshot time (all deals, not filtered by date);
- **hypotheses and the Decision Log** stored in the database at that moment.

Each snapshot gets a unique id (UUID) and a creation time. Later syncs **do not change** an existing snapshot — build a new one to see fresh data. AI texts (step 6) are written into the same snapshot, but its numbers are never recalculated.

## Step 3. Charts and the 🟢/🔴 traffic light

On export the server draws three charts from the snapshot numbers: ECharts runs in headless Chrome with animation disabled, producing PNGs.

| Figure (RU caption in the document)   | Type   | What it shows                                          |
| ------------------------------------- | ------ | ------------------------------------------------------ |
| Visits and applications by channel    | bars   | two series per channel — which traffic converts        |
| Funnel: visit → application → payment | funnel | visits → B2C applications → B2B in progress → B2B paid |
| Channel share of visits               | donut  | traffic structure and dependence on a single source    |

The images are rendered once per export and embedded identically. If Chrome is not found on the server the report is still built — without figures, as text and tables.

Under each figure there is a “🟢 What is good / 🔴 What is bad” block computed **from thresholds, without AI**:

| Threshold                 | Value | How it is used                                                      |
| ------------------------- | ----- | ------------------------------------------------------------------- |
| Good conversion           | ≥ 5%  | the best channel with CR ≥ 5% — “scale it”                          |
| Poor conversion           | < 2%  | the worst channel or the overall funnel below 2% — “check traffic”  |
| Minimum visits for signal | 50    | smaller channels are excluded from the comparison                   |
| Channel dependence        | ≥ 70% | a top channel with ≥ 70% of visits — single-source risk             |
| Entry-page bounce         | ≥ 70% | the page is listed under “bad” in the general recommendations block |

For the funnel the block also states whether the 300 target is reached and how many payments are missing. If no threshold fires, a neutral line says no clear strengths/problems were found.

## Step 4. DOCX structure per GOST R 7.32-2017

Order of sections:

1. **Title page** — everything centred: track line, «АНАЛИТИЧЕСКИЙ ОТЧЁТ», period, sources, year. The snapshot id is not on the title page — it is in the appendix.
2. **СОДЕРЖАНИЕ (Contents)** — a real Word TOC field with hyperlinks (heading levels 1–2). Page numbers appear after the fields are updated (Word usually offers it on open; manually — F9).
3. **ПЕРЕЧЕНЬ РИСУНКОВ (List of figures)** — all figure captions («Рисунок N — …»), identical to those under the images.
4. **ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ**, **ВВЕДЕНИЕ**, **УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ** (designations, introduction, executive summary) — unnumbered.
5. Numbered sections starting with **«1. КРАТКИЕ ИТОГИ» (key results)**: good/bad recommendations, methodology, conversion funnel, B2B pipeline, channel analysis, the funnel and traffic-structure figures, ICE prioritisation, Define / Develop (hypotheses), Deliver (Decision Log), AI analysis, top geo and devices, UTM, entry and exit pages, roadmap, glossary.
6. **Appendices** — headings starting with «Приложение» (e.g. the data appendix with the snapshot id) are not numbered.

Empty sections (“no data”, “no checks yet”) are dropped automatically, so the number of sections depends on the data.

Layout: A4, margins left 30 mm, right 15 mm, top and bottom 20 mm; Times New Roman 14 pt, 1.5 line spacing, justified text; black ALL-CAPS headings with through numbering; every table bordered; figure captions italic 12 pt centred; page number centred in the footer. The document text is in Russian.

## Step 5. PDF

The PDF is built from the same snapshot: the server renders an HTML version of the report and prints it to A4 in headless Chrome. The Chrome path is auto-detected (macOS, Linux, Windows) or set via `PUPPETEER_EXECUTABLE_PATH`. Without Chrome the PDF cannot be built — use DOCX (it does not need Chrome except for the figures).

## Step 6. AI analysis, hypotheses and the Decision Log

AI is used only through providers configured by an administrator (“Administration → AI providers”). Providers are tried by priority; if one fails, the request automatically goes to the next.

**AI analysis (insights).** The “Generate AI analysis” button (RU «Сгенерировать AI-анализ») runs 6 sequential requests, one per section: Summary · Channels, UTM and Audience · Pages and Funnel · Risks and Recommendations · Hypotheses and Roadmap · Final conclusion. This usually takes 5–10 minutes, up to 2 minutes per section. A failed section is replaced by a “generation error — section skipped” note; the rest are kept. The text is saved into the snapshot and the button becomes inactive.

**AI hypotheses.** Generated automatically in the background right after a snapshot is built, if at least one provider is available:

- **10 problem hypotheses** using “[segment] experiences [trouble] when [action] because [barrier]”, each citing a specific snapshot number;
- **10 solution hypotheses** “If [action], then [user benefit], leading to [business result]” — with a success criterion, five risks (value, usability, feasibility, business, legal), a validation plan (at least 2 methods), a 🟢/🟡/🔴 traffic light and a deadline;
- **ICE** — the model only sets Impact, Confidence and Ease (1–10) with rationales. The final score is **computed in code**: Impact × Confidence × Ease (a product, scale 1–1000). Any score the model might suggest is ignored;
- **Decision Log** — after the hypotheses the model proposes at least 3 decision entries (method, period, findings, outcome green / yellow / red).

Because generation runs in the background, the “AI hypotheses” counter may say “not generated” right after building. Open the snapshot from History a few minutes later and the hypotheses and decisions will be there. If generation failed, click “Rebuild report” — a new snapshot and a new attempt are created.

**Anti-hallucination.** The model only receives a text digest of the snapshot numbers — no raw visits and no personal data. Its instructions forbid inventing numbers and mixing applications with payments; the hypotheses answer must be strict JSON and is schema-validated. Charts, traffic lights and the ICE score are never touched by AI. AI sections in the document are an interpretation: verify every number against the tables.

## Step 7. Checking the DOCX layout

A dependency-free script checks GOST compliance (needs the system `unzip`). Run from the repository root: `node scripts/verify-report-gost.mjs path/to/report.docx`.

It checks: page margins, A4 size, Times New Roman and 14 pt defaults, 1.5 line spacing, no blue Word headings, the page-number field in the footer, table borders, «Рисунок N» captions, required sections (Contents, List of figures when figures exist, Executive summary, Introduction, Designations).

Result — `VERDICT: PASS`, `PASS-WITH-WARNINGS` or `FAIL`; exit code 0 for the first two and 1 for FAIL.

## Step by step on the Report page

The Report page controls are currently labelled in Russian: «Сформировать срез данных» (build snapshot), «Сгенерировать AI-анализ» (generate AI analysis), «Перестроить отчёт» (rebuild report), «Export DOCX», «Export PDF».

1. Choose the period in the top filter (7d / 14d / 30d / 90d / 1y or custom dates). Use a meaningful interval — a week or a month.
2. Click **“Build data snapshot”**. You will see the snapshot id, period, the KPI strip (target, applications or orders for the primary goal, B2B orders, gap), the funnel summary, the B2B pipeline and the full on-screen report.
3. Wait for the background AI hypotheses (if a provider is configured), then open the snapshot from History to see them.
4. Optionally click **“Generate AI analysis”** and wait for the progress bar (5–10 minutes). No need to reload the page.
5. Click **“Export DOCX”** or **“Export PDF”** — `productcamp-report-<id>.docx` / `.pdf` downloads to your computer. Charts are rendered at export time, so the first export takes a few seconds.
6. Open the DOCX in Word and update fields (F9) so the Contents get page numbers.
7. Need fresh data or other filters — **“Rebuild report”** creates a new snapshot. The old one stays in History.

If you arrived from Overview or Traffic via a “→ hypothesis” link, a “Hypothesis draft” card appears at the top with segment, problem, action, barrier and evidence fields. The draft lives in the browser until the session ends; “Remove draft” deletes it.

## FAQ

| Question                                | Answer                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Why do report numbers differ from Live? | Live is today's live Metrika data; the report is a frozen SQLite snapshot for the chosen period. |
| The DOCX has no figures                 | Chrome was not found on the server — an administrator sets `PUPPETEER_EXECUTABLE_PATH`.          |
| Contents have no page numbers           | Update fields in Word (F9, or accept the update prompt on open).                                 |
| “AI analysis unavailable”               | No enabled provider with a key — see “LLM provider keys” (`/help/llm-keys`).                     |
| Hypotheses did not appear               | Reopen the snapshot from History in a few minutes; if still empty — “Rebuild report”.            |
| Can I fix numbers inside a snapshot?    | No, snapshots are immutable by design. Fix the data (sync, B2B deals) and build a new snapshot.  |
