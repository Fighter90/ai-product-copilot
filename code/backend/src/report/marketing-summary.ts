import type { MarketingCell, MarketingMetricTotal, MarketingSummary } from '@pca/shared';
import { MARKETING_METRICS, MARKETING_WEEKS } from '../marketing/definitions';

/**
 * ANA-165: aggregate the Marketing page's weekly grid (sheet «стата») for the report period.
 * Pure and deterministic: the totals are sums of real (non-demo) marketing_weekly cells whose
 * campaign week intersects [from, to] — traceable to SQLite, no live API, no clock.
 */

/** Grid range of one cell's week; an unknown weekStart is treated as the single day itself. */
function weekRange(weekStart: string): { start: string; end: string } {
  const week = MARKETING_WEEKS.find((w) => w.key === weekStart);
  return week ? { start: week.start, end: week.end } : { start: weekStart, end: weekStart };
}

/** ISO dates compare lexicographically — inclusive intersection of a week and the period. */
function intersects(
  range: { start: string; end: string },
  period: { from: string; to: string },
): boolean {
  return range.end >= period.from && range.start <= period.to;
}

function metricTotal(
  metricKey: string,
  labelRu: string,
  labelEn: string,
  section: MarketingMetricTotal['section'],
  live: readonly MarketingCell[],
): MarketingMetricTotal {
  const rows = live.filter((c) => c.metricKey === metricKey);
  return {
    metricKey,
    labelRu,
    labelEn,
    section,
    total: rows.reduce((acc, c) => acc + c.value, 0),
    weeks: new Set(rows.map((c) => c.weekStart)).size,
  };
}

/**
 * Per-metric totals over the weeks intersecting the report period. Demo cells (seed data) are
 * excluded — a real report never mixes them into its sums. Returns undefined when no real cell
 * intersects the period (the snapshot field stays absent, as in legacy snapshots).
 */
export function buildMarketingSummary(
  cells: readonly MarketingCell[],
  period: { from: string; to: string },
): MarketingSummary | undefined {
  const live = cells.filter((c) => !c.isDemo && intersects(weekRange(c.weekStart), period));
  if (live.length === 0) return undefined;

  const weekKeys = [...new Set(live.map((c) => c.weekStart))];
  const knownWeeks = MARKETING_WEEKS.filter((w) => weekKeys.includes(w.key));
  const unknownWeeks = weekKeys.filter((k) => !MARKETING_WEEKS.some((w) => w.key === k)).sort();
  const weeks = [
    ...knownWeeks.map((w) => ({ key: w.key, start: w.start, end: w.end })),
    ...unknownWeeks.map((k) => ({ key: k, start: k, end: k })),
  ];

  const metricKeys = [...new Set(live.map((c) => c.metricKey))];
  const catalog = MARKETING_METRICS.filter((m) => metricKeys.includes(m.key));
  const unknownKeys = metricKeys.filter((k) => !MARKETING_METRICS.some((m) => m.key === k)).sort();
  const byMetric: MarketingMetricTotal[] = [
    ...catalog.map((m) => metricTotal(m.key, m.ru, m.en, m.section, live)),
    // The API only accepts catalog metric keys — 'other' is a defensive bucket for stray rows.
    ...unknownKeys.map((k) => metricTotal(k, k, k, 'other', live)),
  ];

  return { weeks, byMetric };
}
