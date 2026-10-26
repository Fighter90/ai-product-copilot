---
title: Metrics and formulas
section: Basics
order: 14
summary: Every metric in the cabinet — definition, how Metrika computes it, where to see it, correct interpretation and common misreadings.
---

# Metrics and formulas

This article defines every number the cabinet shows. All traffic metrics originate in **Yandex Metrika** and are synced daily; goal metrics depend on the selected goal (the KPI strip uses the primary goal).

![KPI screenshot](/screenshots/11-kpi.png)
_The KPI strip — the primary application of these metrics._

## Visits

- **Definition**: a visit is a sequence of user actions on the site, ending after 30 minutes of inactivity (or at midnight). One person can make many visits.
- **How Metrika computes it**: counted per visit start, attributed to the source of that visit (last significant attribution in the daily sync).
- **Where to see it**: Overview KPI strip, Traffic channels and UTM, Explore presets, History daily rows.
- **Correct reading**: visits measure traffic volume and campaign reach; they are the denominator of most rates.

**Common misreading**: treating visits as people. A single journalist checking the site five times is five visits.

## Visitors

- **Definition**: unique people (approximated by Metrika's visitor id) within the reporting period.
- **How Metrika computes it**: deduplicated per calendar period — the same person on five days is one visitor over those five days and five visitors if counted per day and summed.
- **Where to see it**: Overview KPI strip, channel and geo tables.
- **Correct reading**: visitors answer "how big is the audience"; they never equal the sum of daily visitors.

**Common misreading**: summing daily visitors from the `days` preset and calling it audience — the result overcounts anyone who returned.

## Bounce rate

- **Definition**: the share of visits with exactly one page view and no events, or shorter than a minimal time — Metrika's "refusals".
- **How Metrika computes it**: bounced visits / total visits, per row (channel, page, day). The cabinet stores per-day values and **recomputes totals weighted by visits**, so a bounce rate for a week is not the average of daily values.
- **Where to see it**: Overview, Traffic channels, Behavior pages, the `channels_daily` and `pages_daily` DataLens datasets.

![Traffic screenshot](/screenshots/08-traffic.png)
_Bounce rate and duration sit next to visits per channel — read them together, never in isolation._

- **Correct reading**: a high bounce on a landing page signals a mismatch between the ad and the page; a high bounce on an informational article can be normal.

**Common misreading**: averaging bounce rates across days. Weight by visits — a 90% bounce day with 20 visits matters less than a 60% day with 2,000.

## Page depth

- **Definition**: average number of page views per visit.
- **How Metrika computes it**: page views / visits.
- **Where to see it**: Traffic channels, Behavior pages.
- **Correct reading**: depth shows engagement depth per visit. For a conference site, depth of 2–4 is typical: program → speakers → tickets.

**Common misreading**: chasing depth as a success metric. Depth grows when navigation is hard, too. Read it together with the goal reaches.

## Visit duration

- **Definition**: average time from the first to the last hit of a visit.
- **How Metrika computes it**: sum of durations / number of visits; stored in seconds (the CSV datasets carry `avg_duration_sec`).
- **Where to see it**: Overview, channel tables.
- **Correct reading**: duration is robust to short visits only if Metrika's visibility tracking works; very low values often mean one-page hits.

**Common misreading**: comparing duration across channels with different intent — a direct visit from a past attendee can be short yet end in a purchase.

## Conversion

- **Definition**: goal reaches divided by visits, in percent.
- **How Metrika computes it**: per row; the cabinet recomputes it from stored reaches and visits (`SUM(reaches) / SUM(visits) × 100`).
- **Where to see it**: Overview KPI strip, goal detail pages, channel tables, `channels_daily` dataset (`conversion_rate`).
- **Correct reading**: conversion is comparable across time and channels; it is the first metric to compare two campaigns by.

**Common misreading**: comparing conversion of a small campaign (50 visits) with a big one (20,000) — small-sample conversion jumps randomly. Also: a goal that can fire several times per visit can push conversion above 100%.

## Goal reaches

- **Definition**: the number of times the selected counter goal fired (purchases for the primary goal, applications for action goals).
- **How Metrika computes it**: each goal type counts differently — URL goals on page hits, action goals on JS events (the pc-goals `*_apply` events), ecommerce goals on order data.
- **Where to see it**: Goals catalog, goal detail cards, KPI, funnel end stage, Live goals.
- **Correct reading**: reaches are counts of goal events, not of unique people; a multi-reach goal measures activity, a purchase goal measures orders.

**Common misreading**: comparing reaches of two different goals directly; a depth goal will always outcount a purchase goal. Compare conversion instead.

## UTM coverage

- **Definition**: the share of visits that arrived with UTM tags (`utm_source` present).
- **How Metrika computes it**: tagged visits / total visits; the untagged remainder is organic, direct and referral traffic.
- **Where to see it**: Traffic → UTM (the "(none)" row), the `utm_daily` dataset.
- **Correct reading**: coverage shows how much of your traffic is campaign-attributable. Low coverage is normal for a site with strong organic; dropping coverage means campaigns stopped tagging links.

**Common misreading**: expecting every visit to have a campaign. Direct and organic traffic never carries UTM.

## KPI gap to target

- **Definition**: collected primary-goal reaches vs the **300-ticket** campaign target, with the required daily pace to close the gap.
- **Where to see it**: Overview KPI strip, KPI & forecast page.
- **Correct reading**: compare pace, not just the absolute gap — a big gap early with a healthy pace is fine; a small gap with a dying pace is the alarm.

## Quick reference

| Metric       | Denominator | Healthy direction | Watch out for                    |
| ------------ | ----------- | ----------------- | -------------------------------- |
| Visits       | —           | up                | bot spikes                       |
| Visitors     | period      | up                | summing daily values             |
| Bounce rate  | visits      | down              | unweighted averaging             |
| Page depth   | visit       | moderate          | treating high as good            |
| Duration     | visit       | moderate          | cross-channel comparison         |
| Conversion   | visits      | up                | small samples, multi-reach goals |
| Goal reaches | —           | up                | comparing different goal types   |
| UTM coverage | visits      | context           | expecting 100%                   |

## Use cases

- **"Why did conversion drop?"** — decompose: bounce rate (traffic quality), reaches (goal still firing?), visits (denominator inflated by a bot spike). The table above tells you which page of the cabinet to open for each.
- **Explain the KPI to a stakeholder** — use the "Goal reaches" and "KPI gap" definitions verbatim; they are written to be quoted.
- **Validate a DataLens chart** — reproduce the metric formula from the dataset fields listed here; if your chart disagrees with the cabinet, the aggregation (weighted vs averaged) is usually the cause.

## Troubleshooting

- **My spreadsheet average differs from the cabinet** — the cabinet weights rates by visits; replicate with `SUMPRODUCT`.
- **Conversion over 100%** — a multi-reach goal; switch to a purchase-type goal for rate metrics.
- **Visitors don't equal visits even for one day** — one visitor can start several visits; that is by definition.
