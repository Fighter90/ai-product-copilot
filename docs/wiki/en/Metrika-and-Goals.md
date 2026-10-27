# Metrika and goals

> Sources: `docs/help/en/04-goals.md`, `docs/help/en/03-live.md`, `docs/help/en/14-metrics.md`,
> spec [openspec/specs/metrika-sync](https://github.com/Fighter90/ai-product-copilot/blob/main/openspec/specs/metrika-sync/spec.md).
> Русская версия: [Метрика и цели](../Metrika-and-Goals).

## How data gets into the product

```
Yandex Metrika (Reporting API) → daily sync → SQLite → cabinet / report / DataLens
```

- The sync runs **day by day** keeping history: re-running never damages past days.
- Every raw Metrika response is stored in `raw_responses` — every number is traceable.
- Trigger: the "Metrika & data" admin page or `pnpm sync`; resilient to quotas (retry,
  `METRIKA_REQUEST_DELAY_MS` pause).
- Robots are filtered by the counter itself — the product never subtracts visits twice.

## The KPI goal and "will we make 300?"

- The campaign KPI is **300+ paid tickets**; the invariant **"an application ≠ a payment"**
  holds everywhere.
- The goal is set on the "Metrika & data" admin page (`GOAL_ID`); `GOAL_ID=0` auto-detects
  the purchase goal (`selectPrimaryGoal`).
- The Overview shows the "will we make 300?" strip: goal, B2C applications, payments,
  B2B tickets, gap.

## Live (real time)

- **Live, Goals, Goal detail, pc-goals funnel** query the Reporting API directly — they
  show "today" without waiting for the nightly sync and never write to the DB.
- Deltas compare with the same time yesterday; a negative delta before noon is normal
  (half a day vs a full day).

## Metrics

Definitions and formulas (visits, visitors, bounce rate, depth, conversion, goal reaches,
UTM coverage) — [docs/help/en/14-metrics.md](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/help/en/14-metrics.md).
