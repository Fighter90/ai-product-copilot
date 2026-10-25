import { DIMENSION_NONE } from '@pca/shared';
import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
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
}

type Row = StatDataResponse['data'][number];

function mapRow(row: Row, opts: BrowserOsQueryOptions): BrowserOsStat {
  const m = row.metrics;
  const hasGoal = opts.goalId !== undefined;
  return {
    date: opts.from,
    browser: row.dimensions[0]?.name ?? DIMENSION_NONE,
    os: row.dimensions[1]?.name ?? DIMENSION_NONE,
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

/** Fetch traffic broken down by browser + operating system; returns raw response + parsed stats. */
export async function browserOsBreakdown(
  client: MetrikaClient,
  opts: BrowserOsQueryOptions,
): Promise<{ raw: StatDataResponse; stats: BrowserOsStat[] }> {
  const raw = await client.get(
    ENDPOINTS.statData,
    {
      ids: opts.counterId,
      dimensions: 'ym:s:browser,ym:s:operatingSystem',
      metrics: browserOsMetrics(opts.goalId),
      date1: opts.from,
      date2: opts.to,
      attribution: 'lastsign',
    },
    StatDataResponseSchema,
  );
  return { raw, stats: raw.data.map((row) => mapRow(row, opts)) };
}
