import type { StatDataResponse } from '../schemas';

/**
 * ANA-113: range (multi-day) variants of the per-day breakdown queries.
 *
 * The Metrika Reporting API accepts `ym:s:date` as a dimension, so a whole window (the 30-min
 * timer's 3 days, a 10-day backfill chunk) fits in ONE request instead of one request per day —
 * the `quota_requests_by_uid` budget (5000/day) is otherwise dominated by the per-day loop
 * (7 tables × N days + goal batches). Small-cardinality breakdowns enable it via
 * `dateDimension: true`; page-level breakdowns keep the per-day loop (row count explodes).
 */

type Row = StatDataResponse['data'][number];

/** Windows up to this many days are pulled as one range request; wider ones keep the per-day loop. */
export const RANGE_MAX_DAYS = 31;

/** Prepend the date dimension to the query's base dimension list when the range variant is on. */
export function rangeDimensions(base: string, dateDimension?: boolean): string {
  return dateDimension ? `ym:s:date,${base}` : base;
}

/** Shift a business-dimension index when the date dimension is prepended. */
export function dimIndex(i: number, dateDimension?: boolean): number {
  return dateDimension ? i + 1 : i;
}

/** Row date: the API's `ym:s:date` value in the range variant, else the per-day `from`. */
export function rowDate(row: Row, fallbackFrom: string, dateDimension?: boolean): string {
  return dateDimension ? (row.dimensions[0]?.name ?? fallbackFrom) : fallbackFrom;
}

/** Extra request params for the range variant: raise the row cap above the 1000 default. */
export function rangeLimit(dateDimension?: boolean): { limit: number } | Record<string, never> {
  return dateDimension ? { limit: 10_000 } : {};
}
