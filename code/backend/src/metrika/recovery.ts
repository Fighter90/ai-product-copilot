import type { ChannelStat, GeoDeviceStat, PageStat, UtmStat } from '@pca/shared';
import type { MetricsRepo } from '../db/repositories/metrics-repo';
import { ENDPOINTS } from './endpoints';
import { StatDataResponseSchema, type StatDataResponse } from './schemas';
import { mapRow as mapChannelRow } from './queries/traffic-by-source';
import { mapRow as mapUtmRow } from './queries/utm-breakdown';
import { mapRow as mapGeoRow } from './queries/geo-device-breakdown';
import { aggregatePages } from './queries/normalize-page';
import { mapRow as mapPageRow } from './queries/page-behavior';
import { mapRow as mapExitRow } from './queries/exit-page-behavior';

/**
 * ANA-150 — DATA RECOVERY.
 *
 * The counter's history (2025-04-29..2026-11-05) was purged from the five derived stat tables by
 * migration 021 under the wrong diagnosis «seeded backfill»: the counter's statistics were in fact
 * RESET ~2026-11-06, so the pre-reset rows were REAL history and Metrika can no longer serve them
 * (any old range now returns the last week). What survives is the sync's audit trail — raw_responses
 * payloads saved before the reset — and those payloads echo the originating query
 * (`query.dimensions` / `query.metrics`), so each chunk can be identified and replayed through the
 * exact parsers the sync used.
 *
 * Recovery is strictly read-only for raw_responses («сырьё не тронуто») and writes only the
 * derived stat tables, replacing rows by their natural keys — a repeat run (or a chunk whose
 * dates already have rows) rewrites the same values instead of doubling them (channel_stats
 * needs a NULL-safe upsert: SQLite treats NULL UTM keys as DISTINCT, defeating plain
 * INSERT OR REPLACE). Restored rows are live data (is_demo = 0): they ARE real Metrika
 * aggregates, traceable to the stored payloads. Reports without a derived stat table
 * (browser-os, new-returning, goal bytime series) and chunks whose query echo is missing are
 * counted and skipped, never guessed.
 */

export type RecoveredReportKind =
  | 'channels'
  | 'utm'
  | 'geoDevice'
  | 'pages'
  | 'exitPages'
  /** Recognised but without a derived stat table — nothing to upsert. */
  | 'browserOs'
  | 'newReturning'
  | 'goalReaches'
  /** No query echo / unknown dimensions — skipped, never guessed. */
  | 'unknown';

export interface DetectedReport {
  readonly kind: RecoveredReportKind;
  /** True when the chunk is a ≤31-day range request (ym:s:date is the first dimension). */
  readonly dateDimension: boolean;
  /** The KPI goal whose metrics the stored query carried (goal reaches / conversion rate). */
  readonly goalId?: number;
}

const GOAL_REACHES_METRIC = /ym:s:goal(\d+)reaches/;
/** Report identity from the echoed query dimensions, most specific first. */
const KIND_BY_DIMENSION: ReadonlyArray<[kind: RecoveredReportKind, dimension: string]> = [
  ['utm', 'UTM'],
  ['pages', 'startURL'],
  ['exitPages', 'endURL'],
  ['channels', 'TrafficSource'],
  ['geoDevice', 'regionCountry'],
  ['browserOs', 'operatingSystem'],
  ['newReturning', 'isNewUser'],
];

/** Identify which sync report a stored payload belongs to, from the payload's own query echo. */
export function detectReport(payload: unknown, endpoint?: string): DetectedReport {
  // bytime goal series have a different response shape (nested metric arrays) and no stat table.
  if (endpoint === ENDPOINTS.statByTime) return { kind: 'goalReaches', dateDimension: false };
  const query = (payload as { query?: unknown } | null | undefined)?.query;
  const dimensions = (query as { dimensions?: unknown } | null | undefined)?.dimensions;
  const metrics = (query as { metrics?: unknown } | null | undefined)?.metrics;
  const dims = Array.isArray(dimensions) ? dimensions.map((d) => String(d)) : [];
  const goalId = Array.isArray(metrics)
    ? metrics
        .map((m) => GOAL_REACHES_METRIC.exec(String(m))?.[1])
        .find((id): id is string => id !== undefined)
    : undefined;
  const dateDimension = dims.includes('ym:s:date');
  const kind = KIND_BY_DIMENSION.find(([, dimension]) =>
    dims.some((d) => d.includes(dimension)),
  )?.[0];
  if (kind) {
    return goalId === undefined
      ? { kind, dateDimension }
      : { kind, dateDimension, goalId: Number(goalId) };
  }
  return { kind: 'unknown', dateDimension: false };
}

/** Rows upserted per stat table after the whole window was replayed and merged. */
export interface RecoverySummary {
  readonly scanned: number;
  readonly skippedNoTable: number;
  readonly skippedUnknown: number;
  /** First few unidentifiable chunks (query hash) for manual inspection. */
  readonly unknownSamples: readonly string[];
  readonly channelRows: number;
  readonly utmRows: number;
  readonly geoDeviceRows: number;
  readonly pageRows: number;
  readonly exitPageRows: number;
}

export interface RecoveryOptions {
  /** Parse only, upsert nothing (CLI --dry-run). Default: write the restored rows. */
  readonly write?: boolean;
}

/** Accumulated per-table rows across all replayed chunks, keyed by the table's natural key. */
interface RecoveryAcc {
  channels: GoalAwareAcc<ChannelStat>;
  utm: GoalAwareAcc<UtmStat>;
  geoDevice: GoalAwareAcc<GeoDeviceStat>;
  pages: GoalAwareAcc<PageStat>;
  exitPages: GoalAwareAcc<PageStat>;
}

/**
 * Natural-key accumulator whose collision rule prefers goal-bearing provenance over raw id order.
 * A chunk whose query carried `ym:s:goal*reaches` resolves REAL goal metrics; a goalless chunk
 * maps `goalReaches: 0` / `conversionRate: 0` — absence of the metric in ITS query, not a measured
 * zero — so when both chunks collide on one natural key (e.g. a backfill traffic chunk and a
 * scheduled goal chunk for the same day), the goalless row must never overwrite the goal-bearing
 * one, whichever was stored into raw_responses first. Rows with the same provenance keep the
 * last-wins rule: overlapping chunks are duplicate provenance of the same real numbers, so the
 * replay stays deterministic and a repeated run stays a no-op.
 */
class GoalAwareAcc<T> {
  private readonly rows = new Map<string, { stat: T; hasGoal: boolean }>();

  set(key: string, stat: T, hasGoal: boolean): void {
    const cur = this.rows.get(key);
    if (cur?.hasGoal && !hasGoal) return;
    this.rows.set(key, { stat, hasGoal });
  }

  values(): T[] {
    return [...this.rows.values()].map((entry) => entry.stat);
  }
}

function newAcc(): RecoveryAcc {
  return {
    channels: new GoalAwareAcc(),
    utm: new GoalAwareAcc(),
    geoDevice: new GoalAwareAcc(),
    pages: new GoalAwareAcc(),
    exitPages: new GoalAwareAcc(),
  };
}

/** channel_stats key with NULL-safe UTM columns — must match the (date, channel, utm_*) PK. */
function channelKey(c: ChannelStat): string {
  return `${c.date}|${c.channel}|${c.utmSource ?? ''}|${c.utmMedium ?? ''}|${c.utmCampaign ?? ''}`;
}

/**
 * Replay every raw_responses chunk fully inside [from, to] through the sync's own parsers and
 * upsert the merged rows into the derived stat tables (is_demo = 0). Never touches raw_responses.
 *
 * Cross-chunk consolidation REPLACES by the table's natural key (last chunk wins) instead of
 * summing: per-day chunks are disjoint, so a repeated key across chunks is duplicate provenance of
 * the same real number (e.g. a backfill chunk and a scheduled-sync chunk covering the same day) —
 * summing would double-count it. The one exception is goal provenance: a chunk whose query carried
 * `ym:s:goal*reaches` wins over a later goalless chunk for the same key, because a goalless chunk
 * maps goalReaches: 0 as absence of the metric, not a measured zero (see {@link GoalAwareAcc}) —
 * raw id order must not decide whether the restored history keeps its goal metrics. Within one
 * chunk keys are unique by query design, and URL variants still collapse additively via
 * aggregatePages (one real page, several stored spellings). Combined with the NULL-safe channel
 * upsert this makes repeated runs a no-op.
 */
export function recoverHistoryFromRaw(
  metrics: MetricsRepo,
  window: { readonly from: string; readonly to: string },
  opts: RecoveryOptions = {},
): RecoverySummary {
  const write = opts.write ?? true;
  const acc = newAcc();
  const unknownSamples: string[] = [];
  let scanned = 0;
  let skippedNoTable = 0;
  let skippedUnknown = 0;

  for (const raw of metrics.iterateRawResponsesBetween(window.from, window.to)) {
    scanned += 1;
    const detected = detectReport(raw.payload, raw.endpoint);
    if (detected.kind === 'unknown') {
      skippedUnknown += 1;
      if (unknownSamples.length < 5) unknownSamples.push(raw.queryHash);
      continue;
    }
    // Recognised reports without a derived stat table (browser-os / new-returning / goal series).
    if (
      detected.kind === 'browserOs' ||
      detected.kind === 'newReturning' ||
      detected.kind === 'goalReaches'
    ) {
      skippedNoTable += 1;
      continue;
    }
    const parsed = StatDataResponseSchema.safeParse(raw.payload);
    if (!parsed.success) {
      skippedUnknown += 1;
      if (unknownSamples.length < 5) unknownSamples.push(raw.queryHash);
      continue;
    }
    const data: StatDataResponse['data'] = parsed.data.data;
    const hasGoal = detected.goalId !== undefined;
    switch (detected.kind) {
      case 'channels': {
        for (const row of data) {
          const stat = mapChannelRow(row, {
            from: raw.dateFrom,
            goalId: detected.goalId,
            dateDimension: detected.dateDimension,
          });
          acc.channels.set(channelKey(stat), stat, hasGoal);
        }
        break;
      }
      case 'utm': {
        for (const row of data) {
          const stat = mapUtmRow(row, {
            from: raw.dateFrom,
            goalId: detected.goalId,
            dateDimension: detected.dateDimension,
          });
          acc.utm.set(
            `${stat.date}|${stat.utmSource}|${stat.utmMedium}|${stat.utmCampaign}`,
            stat,
            hasGoal,
          );
        }
        break;
      }
      case 'geoDevice': {
        for (const row of data) {
          const stat = mapGeoRow(row, {
            from: raw.dateFrom,
            goalId: detected.goalId,
            dateDimension: detected.dateDimension,
          });
          acc.geoDevice.set(`${stat.date}|${stat.country}|${stat.device}`, stat, hasGoal);
        }
        break;
      }
      case 'pages': {
        for (const stat of aggregatePages(
          data.map((row) => mapPageRow(row, { from: raw.dateFrom, goalId: detected.goalId })),
        )) {
          acc.pages.set(`${stat.date}|${stat.page}`, stat, hasGoal);
        }
        break;
      }
      case 'exitPages': {
        for (const stat of aggregatePages(
          data.map((row) => mapExitRow(row, { from: raw.dateFrom, goalId: detected.goalId })),
        )) {
          acc.exitPages.set(`${stat.date}|${stat.page}`, stat, hasGoal);
        }
        break;
      }
    }
  }

  const merged = {
    channels: acc.channels.values(),
    utm: acc.utm.values(),
    geoDevice: acc.geoDevice.values(),
    pages: acc.pages.values(),
    exitPages: acc.exitPages.values(),
  };
  if (write) {
    // channel_stats needs the NULL-safe variant (NULL keys defeat INSERT OR REPLACE);
    // every other stat table has NOT NULL key columns, so the plain PK upsert is idempotent.
    metrics.upsertChannelStatsNullSafe(merged.channels);
    metrics.upsertUtmStats(merged.utm);
    metrics.upsertGeoDeviceStats(merged.geoDevice);
    metrics.upsertPageStats(merged.pages);
    metrics.upsertExitPageStats(merged.exitPages);
  }
  return {
    scanned,
    skippedNoTable,
    skippedUnknown,
    unknownSamples,
    channelRows: merged.channels.length,
    utmRows: merged.utm.length,
    geoDeviceRows: merged.geoDevice.length,
    pageRows: merged.pages.length,
    exitPageRows: merged.exitPages.length,
  };
}
