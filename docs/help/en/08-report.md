---
title: Reports
section: Reports
order: 8
summary: Period snapshots, GOST-style DOCX/PDF, hypotheses, AI analysis.
---

# Reports

## Snapshot

"Report → Generate" fixes a period snapshot: KPI, channels, pages, funnel, goal reaches. Snapshots are stored in the database; the list is on the Report page.

## Export

- **DOCX** — editable document (GOST-compatible structure).
- **PDF** — print version. Requires Chromium on the server (`PUPPETEER_EXECUTABLE_PATH`); without it DOCX still works.

## Hypotheses

The "→ hypothesis" button creates a hypothesis draft from snapshot numbers. Hypotheses and decisions live on the Report page (Decision Log): status, evidence, snapshot link.

## AI analysis

The AI button generates a narrative breakdown of the snapshot via the configured AI provider. Keys are set in "Admin → AI providers". Treat the analysis as advice — verify numbers against the tables.
