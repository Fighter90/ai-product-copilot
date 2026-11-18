# FAQ — frequently asked questions

> Document version: v3.4.64 (2026-11-18). 🇬🇧 English (mirror: [docs/faq.md](../faq.md)).
> No answer here — [Troubleshooting](troubleshooting.md) or a Linear issue (team ANA).

---

## Product and data

**Q: Where do the numbers come from?**
A: From Yandex.Metrika Reporting API. Every raw response is stored in `raw_responses` (SQLite) before processing; the dashboard and reports read only the DB. Every number traces to the original response.

**Q: Why are «application» and «payment» different numbers?**
A: An application is a reach of the «Left contacts (order)» goal (`reg_step1`). A payment is a B2C e-commerce purchase or a B2B deal in the «paid» stage. Different funnel events; KPI and reports never mix them.

**Q: Why does B2B have no «GOAL 300» tile?**
A: Metrika goals count the overall visit flow — the B2B segment has none, so the goal and remaining tiles are hidden with an explanation. Switch back to `B2C+B2B` to see them.

**Q: What is «UTM coverage: 31%»? Is that bad?**
A: It is the share of traffic with UTM tags. `(none)` — direct hits and unmarked links. Growing coverage = better campaign tagging.

**Q: The forecast shows «—». Why?**
A: The forecast needs application/payment dynamics. At a zero pace — «—» and the status «Not on track at the current pace». The forecast counts applications (see the disclaimer), not payments.

**Q: Metrika and dashboard numbers differ. Who is right?**
A: The dashboard derives from the same raw Metrika responses, computed by uniform rules (daily chunks, a single visits source). A gap >2% is a bug — file an issue with the period.

## Reports

**Q: Why do different downloads of a DOCX/PDF match byte-for-byte?**
A: By design: the report renders from an immutable snapshot; metadata dates are pinned from the snapshot's `generated_at`. Tests cover determinism.

**Q: PDF takes 15–20 seconds to download. Normal?**
A: Yes — a server-side Chrome renders the document. The buttons are disabled meanwhile («Preparing…»); repeated clicks are unnecessary.

**Q: Why is there no «Marketing» section in the report?**
A: The period intersects no filled partner weeks. Build the report for a period including activations (e.g. 30d).

**Q: Does the AI analysis invent numbers?**
A: No: the prompt receives snapshot figures only, the answer is structured per sections. The executing provider is visible in the UI. The AI text does not enter the export automatically.

**Q: How is History different from «build again»?**
A: History keeps all snapshots with a «Current» badge. A rebuild creates a NEW snapshot; the old one stays immutable — past-period reports never «drift».

## Hypotheses and decisions

**Q: Why can't I press Save in a hypothesis?**
A: The format is not met: ≥3 assumptions, ≥2 verification methods, traffic-light criteria, deadline. The blockers panel on top lists what's missing. It's a methodology requirement, not a bug.

**Q: Are findings required in a decision?**
A: No. Findings are optional rows; empty ones are dropped and do not block saving. Required: hypothesis, date, decision, evidence (quote+source), outcome rationale, next step.

**Q: What does ICE 25 mean?**
A: I×C×E — the product of impact, confidence and ease (scale 1–5). 5×5×1 = 25. A product, not a mean — you cannot «buy» confidence with impact.

**Q: A hypothesis moved to «Overdue» by itself.**
A: The deadline passed with a non-terminal status — automation. Open the card: reformulate, close, or revise the deadline.

## Access and settings

**Q: I forgot my password.**
A: Ask the administrator — they will reset it (the new temporary password is shown once). There is no self-recovery.

**Q: Why don't I see «Users/AI providers»?**
A: You are an analyst; the admin panel is Administrator-only. A direct URL gives «No access».

**Q: The site is in Russian — how do I switch to English?**
A: The RU/EN toggle in the top bar. Metrika goal names stay as defined in Metrika — they are data, not UI.

**Q: The dark theme reset.**
A: The choice lives locally (localStorage) — private mode or clearing site data resets it. Toggle it again.

## Operations

**Q: When is the data updated?**
A: Scheduled sync (nightly) + manual runs when needed. «Today's» data arrives with the Metrika lag — the working mode is «yesterday and earlier». The Live page refreshes every 60 seconds straight from Metrika.

**Q: Where do I get a DataLens feed?**
A: The DataLens page — typed CSV datasets; the admin configures the connection (Public API + token).

**Q: How do I report a bug?**
A: A Linear issue (workspace analitics-platform, team ANA): the title is one concrete line, the description has repro steps, expected/actual, a screenshot. Attach the `snapshotId` if the bug is in a report.

**Q: What is the footer version «v3.4.64 · 76d7090 · 2026-11-18»?**
A: The build version, commit hash and date. A «New version» banner means prod updated — reload the page.
