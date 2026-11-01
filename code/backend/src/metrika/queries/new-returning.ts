import { DIMENSION_NONE } from '@pca/shared';
import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
import { dimIndex, rangeDimensions, rangeLimit, rowDate } from './date-dimension';
import { statFilters } from '../traffic-filter';
import { mergeByKey, reachRate } from './dedupe';
import { ratio } from './ratio';

/**
 * New vs returning visitors per day, via the `ym:s:isNewUser` dimension (verified against the
 * live API — `ym:s:userSegment` and friends are not valid attributes). The segment dimension name
 * comes back localized; we store it verbatim with the standard `(none)` normalisation.
 */

export interface NewReturningStat {
  readonly date: string;
  /** `ym:s:isNewUser` value as returned by the API (e.g. "NW" / "RW" variants localized). */
  readonly segment: string;
  readonly visits: number;
  readonly users: number;
  readonly goalReaches: number;
  readonly conversionRate: number;
}

export interface NewReturningQueryOptions {
  readonly counterId: number;
  readonly from: string;
  readonly to: string;
  /** When set, goal reaches + conversion rate metrics are requested. */
  readonly goalId?: number;
  /**
   * Override the Reporting API `filters` value (tests). Default: {@link statFilters} —
   * test/robot traffic excluded unless INCLUDE_TEST_TRAFFIC=1 (ANA-22).
   */
  readonly filters?: string;
  /**
   * ANA-113: one range request for the whole window (dimensions prefixed with `ym:s:date`)
   * instead of one request per day — see queries/date-dimension.ts.
   */
  readonly dateDimension?: boolean;
}

type Row = StatDataResponse['data'][number];

function mapRow(row: Row, opts: NewReturningQueryOptions): NewReturningStat {
  const m = row.metrics;
  const hasGoal = opts.goalId !== undefined;
  return {
    date: rowDate(row, opts.from, opts.dateDimension),
    segment: row.dimensions[dimIndex(0, opts.dateDimension)]?.name ?? DIMENSION_NONE,
    visits: m[0] ?? 0,
    users: m[1] ?? 0,
    goalReaches: hasGoal ? (m[2] ?? 0) : 0,
    conversionRate: hasGoal ? ratio(m[3]) : 0,
  };
}

/** Build the metric list for a new/returning query (goal metrics appended when goalId set). */
export function newReturningMetrics(goalId?: number): string {
  const base = ['ym:s:visits', 'ym:s:users'];
  if (goalId !== undefined) {
    base.push(`ym:s:goal${goalId}reaches`, `ym:s:goal${goalId}conversionRate`);
  }
  return base.join(',');
}

/**
 * Collapse rows that share the segment natural key (date, segment): metrics are summed and CR
 * recomputed from the sums — the write-level dedup behind ANA-16.
 */
export function mergeNewReturningStats(rows: readonly NewReturningStat[]): NewReturningStat[] {
  return mergeByKey(
    rows,
    (s) => `${s.date}|${s.segment}`,
    (a, b) => ({
      date: a.date,
      segment: a.segment,
      visits: a.visits + b.visits,
      users: a.users + b.users,
      goalReaches: a.goalReaches + b.goalReaches,
      conversionRate: reachRate(a.goalReaches + b.goalReaches, a.visits + b.visits),
    }),
  );
}

/** Fetch the new/returning visitor split; returns raw response + parsed stats. */
export async function newReturningBreakdown(
  client: MetrikaClient,
  opts: NewReturningQueryOptions,
): Promise<{ raw: StatDataResponse; stats: NewReturningStat[] }> {
  const filters = opts.filters ?? statFilters();
  const raw = await client.get(
    ENDPOINTS.statData,
    {
      ids: opts.counterId,
      dimensions: rangeDimensions('ym:s:isNewUser', opts.dateDimension),
      metrics: newReturningMetrics(opts.goalId),
      date1: opts.from,
      date2: opts.to,
      ...rangeLimit(opts.dateDimension),
      attribution: 'lastsign',
      ...(filters ? { filters } : {}),
    },
    StatDataResponseSchema,
  );
  return { raw, stats: mergeNewReturningStats(raw.data.map((row) => mapRow(row, opts))) };
}
