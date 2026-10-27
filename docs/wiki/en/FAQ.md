# FAQ — frequently asked questions

Short answers with links to the help centre and the guide. Full navigation — in [Home.md](Home.md).

## How is a «lead» different from a «payment»?

These are two different Yandex.Metrika goals on the funnel: a **lead** (registration —
`GOAL_ID`) and a **payment** (order — `ORDER_GOAL_ID`). A lead ≠ payment: conversion rates are
counted separately at every funnel step (ticket page view → CTA → registration → payment).
Details: [Metrika-and-Goals.md](Metrika-and-Goals.md).

## Where do B2B deals come from?

Yandex.Metrika does not see B2B — deals are entered by hand on the B2B page
(`b2b_manual` table) or imported from CSV. Paid B2B tickets are included in the KPI «300 paid
tickets». Details: [Roles.md](Roles.md).

## What do I need to start?

1. A Yandex.Metrika OAuth token and a counter ID (an admin enters them in
   Administration → Metrika).
2. Run the first sync — the dashboard fills with data for the selected window.
3. Analysts work with the report, hypotheses and the marketing grid. Details:
   [Quickstart.md](Quickstart.md).

## Who can do what?

- **Admin** — settings, users, sync, Metrika goals, integrations, audit log.
- **Analyst** — dashboards, reports, hypotheses, decisions, B2B/marketing data entry.
  Details: [Roles.md](Roles.md).

## Where are the data exported to?

CSV datasets for Yandex DataLens are built by the backend
(`/api/integrations/datalens/export/...`), the workbook can be created by the script
`scripts/datalens-api.mjs`. Details: [DataLens.md](DataLens.md).

## How do I deploy?

The deploy runs from CI on the `v*.*.*` tag (GitHub Environments, `deploy/deploy.sh`) or
manually via workflow_dispatch. The SQLite database and `.env` on the server are never
overwritten. Details: [Deploy.md](Deploy.md).

## Which AI providers are supported?

OpenRouter, Anthropic, YandexGPT and GigaChat — configured by an admin in
Administration → AI providers; the chain works in priority order. Details:
[AI-Providers.md](AI-Providers.md).
