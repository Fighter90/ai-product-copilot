---
title: Goals and KPI
section: Dashboard
order: 4
summary: Counter goal catalog, KPI goal selection, per-goal detail page.
---

# Goals and KPI

## The Goals page

Lists every counter goal with its type, status and reaches. Dead goals (0 reaches in 90 days) and duplicates are flagged automatically.

## Choosing the primary goal

The primary goal drives KPI and reports. By default it is auto-detected (purchase goal). An administrator can pin a specific goal with the `GOAL_ID` server variable.

## Goal detail page

Click a goal to open its detail card: reach dynamics, conversion, breakdown by channels and devices, period comparison.

## Archived goals

Goals with ids above the archive threshold are treated as archived and excluded from KPI. The threshold is configured via `ARCHIVED_GOAL_ID_THRESHOLD`.
