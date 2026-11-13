import type { ChannelStat } from '@pca/shared';
import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
import { dimIndex, rangeDimensions, rangeLimit, rowDate } from './date-dimension';
import { statFilters } from '../traffic-filter';
import { mergeByKey, reachRate, weightedRate } from './dedupe';
import { ratio } from './ratio';

export interface TrafficQueryOptions {
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

/**
 * Row → ChannelStat. Exported for the raw-payload history recovery (ANA-150), which replays saved
 * responses through the same mapping the sync used — one source of truth for the metric order.
 */
export function mapRow(
  row: Row,
  opts: Pick<TrafficQueryOptions, 'from' | 'goalId' | 'dateDimension'>,
): ChannelStat {
  const m = row.metrics;
  const hasGoal = opts.goalId !== undefined;
  return {
    date: rowDate(row, opts.from, opts.dateDimension),
    channel: row.dimensions[dimIndex(0, opts.dateDimension)]?.name ?? 'unknown',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    visits: m[0] ?? 0,
    users: m[1] ?? 0,
    bounceRate: ratio(m[2]),
    avgDuration: m[3] ?? 0,
    goalReaches: hasGoal ? (m[4] ?? 0) : 0,
    conversionRate: hasGoal ? ratio(m[5]) : 0,
  };
}

/**
 * Collapse rows to one per channel. The query groups by (lastTrafficSource, lastSourceEngine), so a
 * single channel like "Search engine traffic" arrives as several rows (Google, Yandex, …). We only
 * key channel_stats by source, so without this aggregation those sibling rows collapse on the
 * primary key and INSERT OR REPLACE keeps just the last one — silently dropping the others' visits.
 * Visits/users/reaches are summed; bounce + duration are visit-weighted; CR is recomputed.
 */
interface ChannelAcc {
  date: string;
  channel: string;
  visits: number;
  users: number;
  goalReaches: number;
  wBounce: number;
  wDur: number;
}

export function aggregateByChannel(stats: ChannelStat[]): ChannelStat[] {
  const acc = new Map<string, ChannelAcc>();
  for (const s of stats) {
    const cur = acc.get(s.channel);
    if (!cur) {
      acc.set(s.channel, {
        date: s.date,
        channel: s.channel,
        visits: s.visits,
        users: s.users,
        goalReaches: s.goalReaches,
        wBounce: s.bounceRate * s.visits,
        wDur: s.avgDuration * s.visits,
      });
    } else {
      cur.visits += s.visits;
      cur.users += s.users;
      cur.goalReaches += s.goalReaches;
      cur.wBounce += s.bounceRate * s.visits;
      cur.wDur += s.avgDuration * s.visits;
    }
  }
  return [...acc.values()].map((c) => ({
    date: c.date,
    channel: c.channel,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    visits: c.visits,
    users: c.users,
    bounceRate: c.visits > 0 ? c.wBounce / c.visits : 0,
    avgDuration: c.visits > 0 ? c.wDur / c.visits : 0,
    goalReaches: c.goalReaches,
    conversionRate: c.visits > 0 ? c.goalReaches / c.visits : 0,
  }));
}

/** Build the metric list for a traffic-by-source query (goal metrics appended when goalId set). */
export function trafficMetrics(goalId?: number): string {
  const base = ['ym:s:visits', 'ym:s:users', 'ym:s:bounceRate', 'ym:s:avgVisitDurationSeconds'];
  if (goalId !== undefined) {
    base.push(`ym:s:goal${goalId}reaches`, `ym:s:goal${goalId}conversionRate`);
  }
  return base.join(',');
}

/**
 * Cross-chunk safety net (ANA-16): unlike {@link aggregateByChannel} this keys on (date, channel),
 * so rows accumulated over several request chunks collapse to one row per `channel_stats` PK.
 */
export function mergeChannelStats(rows: readonly ChannelStat[]): ChannelStat[] {
  return mergeByKey(
    rows,
    (s) => `${s.date}|${s.channel}`,
    (a, b) => ({
      date: a.date,
      channel: a.channel,
      utmSource: a.utmSource ?? b.utmSource,
      utmMedium: a.utmMedium ?? b.utmMedium,
      utmCampaign: a.utmCampaign ?? b.utmCampaign,
      visits: a.visits + b.visits,
      users: a.users + b.users,
      bounceRate: weightedRate(a.bounceRate, a.visits, b.bounceRate, b.visits),
      avgDuration: weightedRate(a.avgDuration, a.visits, b.avgDuration, b.visits),
      goalReaches: a.goalReaches + b.goalReaches,
      conversionRate: reachRate(a.goalReaches + b.goalReaches, a.visits + b.visits),
    }),
  );
}

/** Fetch traffic broken down by last source, returning both the raw response and parsed stats. */
export async function trafficBySource(
  client: MetrikaClient,
  opts: TrafficQueryOptions,
): Promise<{ raw: StatDataResponse; stats: ChannelStat[] }> {
  const filters = opts.filters ?? statFilters();
  const raw = await client.get(
    ENDPOINTS.statData,
    {
      ids: opts.counterId,
      // Group by the LAST SIGNIFICANT source (`lastsign`), not `lastTrafficSource`: the latter is
      // last CLICK — Metrika ignores attribution=lastsign for an explicitly-"last" dimension, and
      // the numbers disagreed with the live screens / DataLens (ANA-65 finding 2, verified live
      // 2026-10-27). Querying lastSourceEngine too would split one channel into several rows
      // (Search = Google + Yandex …) — visits are additive but users are NOT (the same person
      // across engines counts once per source), so a single-dimension query gives Metrika's
      // native, deduplicated visits AND users per channel.
      dimensions: rangeDimensions('ym:s:lastsignTrafficSource', opts.dateDimension),
      metrics: trafficMetrics(opts.goalId),
      date1: opts.from,
      date2: opts.to,
      ...rangeLimit(opts.dateDimension),
      attribution: 'lastsign',
      ...(filters ? { filters } : {}),
    },
    StatDataResponseSchema,
  );
  return {
    raw,
    // ANA-113: in the range variant the channel-only collapse of {@link aggregateByChannel} would
    // fuse different days into one row (its key has no date) — mergeChannelStats already keys on
    // (date, channel) and does the same visit-weighted merging, so it handles both modes.
    stats: mergeChannelStats(raw.data.map((row) => mapRow(row, opts))),
  };
}
