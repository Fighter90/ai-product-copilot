import { clampRatio } from './period-totals';

/**
 * Single period aggregator (ANA-16). Stat tables are stored per day (`utm_stats`, `page_stats`,
 * `channel_stats` keyed by date), so every table/report that shows a period MUST collapse rows by
 * its natural key through these helpers: visits / users / reaches are summed, bounce rate and
 * duration are visit-weighted, conversion rate is recomputed as reaches / visits. Used by the
 * backend sync dedupe, the frontend tables and the report so the numbers never diverge.
 */

/**
 * Collapse `rows` that share `keyOf`, combining each group via `merge(first, next)`.
 * First-seen order is preserved; `merge` must treat `first` as the accumulator.
 */
export function mergeByKey<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  merge: (first: T, next: T) => T,
): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const cur = map.get(key);
    map.set(key, cur ? merge(cur, row) : row);
  }
  return [...map.values()];
}

/** Visit-weighted average of a rate field (bounce rate, conversion rate) over summed visits. */
export function weightedRate(
  aRate: number,
  aVisits: number,
  bRate: number,
  bVisits: number,
): number {
  const visits = aVisits + bVisits;
  return visits > 0 ? (aRate * aVisits + bRate * bVisits) / visits : 0;
}

/** Conversion rate from summed reaches and visits (reaches/visits), 0 when there are no visits. */
export function reachRate(reaches: number, visits: number): number {
  return visits > 0 ? reaches / visits : 0;
}

/**
 * Visit-weighted mean of `rate` over `rows` — e.g. the overall bounce rate of a set of pages.
 * An unweighted mean lets a 1-visit page with 100% bounce move the headline as much as the home
 * page with thousands of visits.
 */
export function weightedAverage<T extends { readonly visits: number }>(
  rows: readonly T[],
  rate: (row: T) => number,
): number {
  let visits = 0;
  let weighted = 0;
  for (const r of rows) {
    visits += r.visits;
    weighted += rate(r) * r.visits;
  }
  return visits > 0 ? weighted / visits : 0;
}

/** Visit-weighted bounce rate of `rows`. */
export function weightedBounce(
  rows: readonly { readonly visits: number; readonly bounceRate: number }[],
): number {
  return weightedAverage(rows, (r) => r.bounceRate);
}

/** Minimal shape of a per-day stat row the period aggregator understands. */
export interface PeriodRow {
  readonly visits: number;
  readonly users?: number;
  readonly goalReaches?: number;
  readonly bounceRate?: number;
  readonly avgDuration?: number;
  readonly conversionRate?: number;
}

/**
 * Collapse per-day rows into one row per `keyOf` for the whole period, highest visits first.
 * Non-metric fields (dimension values, `date`) are taken from the first row of each group.
 * Note: summed `users` over days over-counts returning people — it is an upper bound.
 */
export function aggregatePeriod<T extends PeriodRow>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  return mergeByKey(rows, keyOf, (a, b) => {
    const visits = a.visits + b.visits;
    const out: Record<string, unknown> = { ...a } as Record<string, unknown>;
    out.visits = visits;
    if (a.users !== undefined || b.users !== undefined) out.users = (a.users ?? 0) + (b.users ?? 0);
    const reaches =
      a.goalReaches !== undefined || b.goalReaches !== undefined
        ? (a.goalReaches ?? 0) + (b.goalReaches ?? 0)
        : undefined;
    if (reaches !== undefined) out.goalReaches = reaches;
    if (a.bounceRate !== undefined || b.bounceRate !== undefined)
      out.bounceRate = weightedRate(a.bounceRate ?? 0, a.visits, b.bounceRate ?? 0, b.visits);
    if (a.avgDuration !== undefined || b.avgDuration !== undefined)
      out.avgDuration = weightedRate(a.avgDuration ?? 0, a.visits, b.avgDuration ?? 0, b.visits);
    if (a.conversionRate !== undefined || b.conversionRate !== undefined)
      out.conversionRate =
        reaches !== undefined
          ? clampRatio(reachRate(reaches, visits))
          : weightedRate(a.conversionRate ?? 0, a.visits, b.conversionRate ?? 0, b.visits);
    return out as unknown as T;
  }).sort((x, y) => y.visits - x.visits);
}

/** Number of distinct values of `keyOf` — e.g. distinct channels, not channel × day rows. */
export function distinctCount<T>(rows: readonly T[], keyOf: (row: T) => string): number {
  return new Set(rows.map(keyOf)).size;
}

/**
 * БАГ-07: canonical page key — the URL without query/hash and with one trailing-slash form (only
 * the bare root keeps its «/»). Metrika page rows arrive per day and per raw URL, so «/»,
 * «/?utm_source=x» and «/b2b/» are the same page for tops and must collapse into one row.
 */
export function pageKey(url: string): string {
  const bare = url.split(/[?#]/, 1)[0] ?? url;
  let key = bare;
  while (key.length > 1 && key.endsWith('/')) key = key.slice(0, -1);
  return key;
}

/** БАГ-07: normalized UTM value — trimmed and lowercased, so «tg», «TG» and « tg » are one source. */
export function normUtm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** БАГ-07: UTM row key (source|medium|campaign, normalized) — collapses case/whitespace dupes. */
export function utmKey(
  source: string | null | undefined,
  medium: string | null | undefined,
  campaign: string | null | undefined,
): string {
  return `${normUtm(source)}|${normUtm(medium)}|${normUtm(campaign)}`;
}
