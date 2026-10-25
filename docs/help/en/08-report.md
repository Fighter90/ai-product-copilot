---
title: Reports
section: Reports
order: 8
summary: Period snapshots, GOST-style DOCX/PDF export, hypotheses, decision log and AI analysis.
---

# Reports

The Report page (`/app/report`) turns dashboard numbers into deliverables: a fixed period snapshot, an editable document, and a trail of hypotheses and decisions. The intended loop is **snapshot → document → hypothesis → decision**.

![Report screenshot](/screenshots/13-report.png)
_The Report page: snapshot list, export buttons and the hypothesis/decision log._

Before generating, spend a minute on data hygiene:

![History screenshot](/screenshots/14-history.png)
_Check History for sync gaps in the period — a report over a gapped range will understate results._

## Step 1 — Generate a snapshot

"Report → Generate" fixes a period snapshot: KPI strip values, channels, pages, funnel, goal reaches — everything as it was at generation time. Snapshots are stored in the database and listed on the Report page.

1. Set the header period to the range you want to capture.
2. Press **Generate** and give the snapshot a meaningful name ("Week 42", "After mailing launch").
3. Open a snapshot later to see the numbers even if the underlying data changed or got re-synced.

Snapshots are immutable on purpose: they are your evidence base for "what did we know then".

## Step 2 — Export to DOCX or PDF

Each snapshot exports to:

- **DOCX** — editable document with a GOST-compatible structure: title page data, tables, conclusions. Best when a human will edit or merge the text.
- **PDF** — print-ready version. PDF rendering requires Chromium on the server (`PUPPETEER_EXECUTABLE_PATH`); without it the DOCX button still works and PDF shows a configuration hint.

Both files are generated from the snapshot, not from live data — regenerate the snapshot if you need fresh numbers.

## Step 3 — Hypotheses

The **→ hypothesis** button creates a hypothesis draft from the snapshot numbers: it prefills what changed and by how much. A hypothesis has a status (new / in progress / confirmed / rejected) and can be edited freely — the draft is a starting point, not a verdict.

Good hypothesis practice in this cabinet:

1. One hypothesis per observable change ("email channel brought +40 visits after the Tuesday mailing").
2. Link it to the snapshot that contains the evidence (the link is created automatically).
3. Close the loop: when the follow-up period has its own snapshot, confirm or reject the hypothesis explicitly.

## Step 4 — Decisions

Hypotheses and decisions live in the Decision Log on the Report page: status, evidence, snapshot link. A decision records what was done because of the hypothesis ("moved the ticket block higher", "paused campaign X"). This is what makes the next report a story, not a table dump.

## AI analysis

The **AI analysis** button sends the snapshot numbers to the configured AI provider and returns a narrative breakdown: what grew, what fell, which stages of the funnel deserve attention, suggested next steps.

Preparing data for a good analysis:

1. Generate the snapshot on a clean period (avoid ranges with sync gaps — check **History**).
2. Make sure an AI provider is configured and tested in **Admin → AI providers**; without one the button explains what is missing.
3. Name the snapshot so the period context is obvious.

Reading the results:

- The analysis is **advice**: verify every number it cites against the snapshot tables before forwarding it.
- It sees only the snapshot content — no site access, no personal data, no Metrika credentials.
- The exact provider and model used are recorded in the admin usage log.

## Use cases

- **Build a weekly report** — every Friday: set the period to the last 7 days, generate "Week N", export DOCX, add one decision line from the log.
- **Compare two campaigns** — snapshot each campaign's period, export both documents, and compare channel and funnel sections side by side.
- **Postmortem after a launch** — generate a snapshot on launch week, write hypotheses from it, and track decisions until the next snapshot confirms or rejects them.

## Troubleshooting

- **PDF button fails but DOCX works** — Chromium is missing on the server; an administrator must set `PUPPETEER_EXECUTABLE_PATH`.
- **AI analysis returns an error** — check the provider status in **Admin → AI providers** (press **Test**) and the usage log; rate limits and exhausted keys are the usual causes.
- **Snapshot numbers differ from live dashboards** — the snapshot is frozen at generation time; regenerate it to capture the current state.
