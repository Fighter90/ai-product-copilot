import { DIMENSION_NONE } from '@pca/shared';
import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
import { dimIndex, rangeDimensions, rangeLimit, rowDate } from './date-dimension';
import { statFilters } from '../traffic-filter';
import { mergeByKey, reachRate } from './dedupe';
import { ratio } from './ratio';

/**
 * Browser + operating-system breakdown — a distinct aggregation (visits are NOT additive across
 * the browser/OS matrix), kept separate from geo/device per the same rule that split UTM out of
 * channel_stats. Verified against the live API: `ym:s:browser` and `ym:s:operatingSystem` are the
 * valid dimension names (`ym:s:os` is not).
 */

export interface BrowserOsStat {
  readonly date: string;
  readonly browser: string;
  readonly os: string;
  readonly visits: number;
  readonly users: number;
  readonly goalReaches: number;
  readonly conversionRate: number;
}

export interface BrowserOsQueryOptions {
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

function mapRow(row: Row, opts: BrowserOsQueryOptions): BrowserOsStat {
  const m = row.metrics;
  const hasGoal = opts.goalId !== undefined;
  return {
    date: rowDate(row, opts.from, opts.dateDimension),
    browser: row.dimensions[dimIndex(0, opts.dateDimension)]?.name ?? DIMENSION_NONE,
    os: row.dimensions[dimIndex(1, opts.dateDimension)]?.name ?? DIMENSION_NONE,
    visits: m[0] ?? 0,
    users: m[1] ?? 0,
    goalReaches: hasGoal ? (m[2] ?? 0) : 0,
    conversionRate: hasGoal ? ratio(m[3]) : 0,
  };
}

/** Build the metric list for a browser/OS query (goal metrics appended when goalId set). */
export function browserOsMetrics(goalId?: number): string {
  const base = ['ym:s:visits', 'ym:s:users'];
  if (goalId !== undefined) {
    base.push(`ym:s:goal${goalId}reaches`, `ym:s:goal${goalId}conversionRate`);
  }
  return base.join(',');
}

/**
 * Collapse rows that share the browser/OS natural key (date, browser, os): metrics are summed and
 * CR recomputed from the sums — the write-level dedup behind ANA-16.
 */
export function mergeBrowserOsStats(rows: readonly BrowserOsStat[]): BrowserOsStat[] {
  return mergeByKey(
    rows,
    (s) => `${s.date}|${s.browser}|${s.os}`,
    (a, b) => ({
      date: a.date,
      browser: a.browser,
      os: a.os,
      visits: a.visits + b.visits,
      users: a.users + b.users,
      goalReaches: a.goalReaches + b.goalReaches,
      conversionRate: reachRate(a.goalReaches + b.goalReaches, a.visits + b.visits),
    }),
  );
}

/** Fetch traffic broken down by browser + operating system; returns raw response + parsed stats. */
export async function browserOsBreakdown(
  client: MetrikaClient,
  opts: BrowserOsQueryOptions,
): Promise<{ raw: StatDataResponse; stats: BrowserOsStat[] }> {
  const filters = opts.filters ?? statFilters();
  const raw = await client.get(
    ENDPOINTS.statData,
    {
      ids: opts.counterId,
      dimensions: rangeDimensions('ym:s:browser,ym:s:operatingSystem', opts.dateDimension),
      metrics: browserOsMetrics(opts.goalId),
      date1: opts.from,
      date2: opts.to,
      ...rangeLimit(opts.dateDimension),
      attribution: 'lastsign',
      ...(filters ? { filters } : {}),
    },
    StatDataResponseSchema,
  );
  return { raw, stats: mergeBrowserOsStats(raw.data.map((row) => mapRow(row, opts))) };
}
