import type { GeoDeviceStat } from '@pca/shared';
import { DIMENSION_NONE } from '@pca/shared';
import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
import { dimIndex, rangeDimensions, rangeLimit, rowDate } from './date-dimension';
import { statFilters } from '../traffic-filter';
import { mergeByKey, reachRate } from './dedupe';
import { ratio } from './ratio';

export interface GeoDeviceQueryOptions {
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

/** Missing dimension values come back as null — normalise to the `(none)` sentinel. */
function dim(row: Row, i: number): string {
  return row.dimensions[i]?.name ?? DIMENSION_NONE;
}

function mapRow(row: Row, opts: GeoDeviceQueryOptions): GeoDeviceStat {
  const m = row.metrics;
  const hasGoal = opts.goalId !== undefined;
  return {
    date: rowDate(row, opts.from, opts.dateDimension),
    country: dim(row, dimIndex(0, opts.dateDimension)),
    device: dim(row, dimIndex(1, opts.dateDimension)),
    visits: m[0] ?? 0,
    users: m[1] ?? 0,
    goalReaches: hasGoal ? (m[2] ?? 0) : 0,
    conversionRate: hasGoal ? ratio(m[3]) : 0,
  };
}

/** Build the metric list for a geo/device query (goal metrics appended when goalId set). */
export function geoDeviceMetrics(goalId?: number): string {
  const base = ['ym:s:visits', 'ym:s:users'];
  if (goalId !== undefined) {
    base.push(`ym:s:goal${goalId}reaches`, `ym:s:goal${goalId}conversionRate`);
  }
  return base.join(',');
}

/**
 * Collapse rows that share the `geo_device_stats` natural key (date, country, device): metrics are
 * summed and CR recomputed from the sums — the write-level dedup behind ANA-16.
 */
export function mergeGeoDeviceStats(rows: readonly GeoDeviceStat[]): GeoDeviceStat[] {
  return mergeByKey(
    rows,
    (s) => `${s.date}|${s.country}|${s.device}`,
    (a, b) => ({
      date: a.date,
      country: a.country,
      device: a.device,
      visits: a.visits + b.visits,
      users: a.users + b.users,
      goalReaches: a.goalReaches + b.goalReaches,
      conversionRate: reachRate(a.goalReaches + b.goalReaches, a.visits + b.visits),
    }),
  );
}

/** Fetch traffic broken down by country + device category; returns raw response + parsed stats. */
export async function geoDeviceBreakdown(
  client: MetrikaClient,
  opts: GeoDeviceQueryOptions,
): Promise<{ raw: StatDataResponse; stats: GeoDeviceStat[] }> {
  const filters = opts.filters ?? statFilters();
  const raw = await client.get(
    ENDPOINTS.statData,
    {
      ids: opts.counterId,
      dimensions: rangeDimensions('ym:s:regionCountry,ym:s:deviceCategory', opts.dateDimension),
      metrics: geoDeviceMetrics(opts.goalId),
      date1: opts.from,
      date2: opts.to,
      ...rangeLimit(opts.dateDimension),
      attribution: 'lastsign',
      ...(filters ? { filters } : {}),
    },
    StatDataResponseSchema,
  );
  return { raw, stats: mergeGeoDeviceStats(raw.data.map((row) => mapRow(row, opts))) };
}
