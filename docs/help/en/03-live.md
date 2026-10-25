---
title: Real-time
section: Dashboard
order: 3
summary: Live pages — today's goals, pc-goals funnel, detailed statistics.
---

# Real-time

## Live pages

The "Live" section queries the Metrika Reporting API directly — no waiting for the daily sync:

- **Live goals** — today's reaches for all goals, compared with yesterday and the 14/90-day average.
- **Live funnel** — pc-goals stages: saw tickets → CTA click → opened registration → cart → left contacts.
- **Goal detail** — per-goal breakdown: sources, devices, entry pages.

## Reading the delta

The delta compares with the same time yesterday. A negative delta early in the day is normal — compare against yesterday's full-day number.

## Ticket types

The live funnel breaks down by ticket type (standard / optimal / max) and application role (speaker, volunteer, C-level, partner) using pc-goals JS events on productcamp.ru.

## Refresh

Data is fetched when the page opens. The "Refresh" button re-queries Metrika; once a minute is plenty.
