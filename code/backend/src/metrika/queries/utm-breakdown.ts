import type { UtmStat } from '@pca/shared';
import { UTM_NONE } from '@pca/shared';
import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
import { statFilters } from '../traffic-filter';
import { mergeByKey, reachRate } from './dedupe';
import { ratio } from './ratio';

export interface UtmQueryOptions {
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
}

type Row = StatDataResponse['data'][number];

/** Missing dimension values come back as null — normalise to the `(none)` sentinel. */
function dim(row: Row, i: number): string {
  return row.dimensions[i]?.name ?? UTM_NONE;
}

function mapRow(row: Row, opts: UtmQueryOptions): UtmStat {
  const m = row.metrics;
  const hasGoal = opts.goalId !== undefined;
  return {
    date: opts.from,
    utmSource: dim(row, 0),
    utmMedium: dim(row, 1),
    utmCampaign: dim(row, 2),
    visits: m[0] ?? 0,
    users: m[1] ?? 0,
    goalReaches: hasGoal ? (m[2] ?? 0) : 0,
    conversionRate: hasGoal ? ratio(m[3]) : 0,
  };
}

/** Build the metric list for a UTM-breakdown query (goal metrics appended when goalId set). */
export function utmMetrics(goalId?: number): string {
  const base = ['ym:s:visits', 'ym:s:users'];
  if (goalId !== undefined) {
    base.push(`ym:s:goal${goalId}reaches`, `ym:s:goal${goalId}conversionRate`);
  }
  return base.join(',');
}

/**
 * Collapse rows that share the `utm_stats` natural key (date, source, medium, campaign): metrics
 * are summed and CR recomputed from the sums. Guards the upsert against repeated keys within one
 * response or across chunks — the write-level dedup behind ANA-16.
 */
export function mergeUtmStats(rows: readonly UtmStat[]): UtmStat[] {
  return mergeByKey(
    rows,
    (s) => `${s.date}|${s.utmSource}|${s.utmMedium}|${s.utmCampaign}`,
    (a, b) => ({
      date: a.date,
      utmSource: a.utmSource,
      utmMedium: a.utmMedium,
      utmCampaign: a.utmCampaign,
      visits: a.visits + b.visits,
      users: a.users + b.users,
      goalReaches: a.goalReaches + b.goalReaches,
      conversionRate: reachRate(a.goalReaches + b.goalReaches, a.visits + b.visits),
    }),
  );
}

/** Fetch traffic broken down by UTM source/medium/campaign; returns raw response + parsed stats. */
export async function utmBreakdown(
  client: MetrikaClient,
  opts: UtmQueryOptions,
): Promise<{ raw: StatDataResponse; stats: UtmStat[] }> {
  const filters = opts.filters ?? statFilters();
  const raw = await client.get(
    ENDPOINTS.statData,
    {
      ids: opts.counterId,
      // lastsign UTM dims (ANA-65 finding 2): plain UTMSource/… are last CLICK and disagreed with
      // the live screens; verified against the live API 2026-10-27.
      dimensions: 'ym:s:lastsignUTMSource,ym:s:lastsignUTMMedium,ym:s:lastsignUTMCampaign',
      metrics: utmMetrics(opts.goalId),
      date1: opts.from,
      date2: opts.to,
      attribution: 'lastsign',
      ...(filters ? { filters } : {}),
    },
    StatDataResponseSchema,
  );
  return { raw, stats: mergeUtmStats(raw.data.map((row) => mapRow(row, opts))) };
}
