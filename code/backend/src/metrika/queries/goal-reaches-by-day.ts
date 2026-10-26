import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
import { statFilters } from '../traffic-filter';
import { mergeByKey } from './dedupe';

/**
 * Per-day goal reaches for EVERY goal on the counter, via the time-series endpoint
 * `/stat/v1/data/bytime` with `group=day`. Unlike the other breakdowns this query needs no per-day
 * chunking: one request returns the whole daily series for its metrics.
 */

/** Metrika caps a Reporting API request at 10 metrics — goal reaches batch by that many goals. */
export const GOAL_METRICS_BATCH = 10;

export interface GoalReachesQueryOptions {
  readonly counterId: number;
  readonly from: string;
  readonly to: string;
  /** Goal ids for THIS request batch (≤ {@link GOAL_METRICS_BATCH} unless overridden). */
  readonly goalIds: readonly number[];
  /** Override the batch size (tests). */
  readonly batchSize?: number;
  /**
   * Override the Reporting API `filters` value (tests). Default: {@link statFilters} —
   * test/robot traffic excluded unless INCLUDE_TEST_TRAFFIC=1 (ANA-22).
   */
  readonly filters?: string;
}

export interface GoalDayRow {
  readonly date: string;
  readonly goalId: number;
  readonly reaches: number;
}

/** `ym:s:goal{id}reaches` metric list for a batch of goals. */
export function goalReachMetrics(goalIds: readonly number[]): string {
  return goalIds.map((id) => `ym:s:goal${id}reaches`).join(',');
}

/** Split goal ids into metric-batches that fit one request. */
export function batchGoalIds(
  goalIds: readonly number[],
  size: number = GOAL_METRICS_BATCH,
): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < goalIds.length; i += size) {
    batches.push([...goalIds.slice(i, i + size)]);
  }
  return batches;
}

/** Inclusive list of YYYY-MM-DD days between from and to — the bytime x-axis for `group=day`. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const MS_PER_DAY = 86_400_000;
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += MS_PER_DAY
  ) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Collapse rows that share the (date, goalId) reach pair, summing reaches — the write-level dedup
 * behind ANA-16 (a repeated pair must add up, never double-insert).
 */
export function mergeGoalDayRows(rows: readonly GoalDayRow[]): GoalDayRow[] {
  return mergeByKey(
    rows,
    (r) => `${r.date}|${r.goalId}`,
    (a, b) => ({ date: a.date, goalId: a.goalId, reaches: a.reaches + b.reaches }),
  );
}

/**
 * Fetch one batch: the daily reaches series for each goal in `goalIds`.
 * bytime nests metrics as number[][] — row `metrics[i]` holds the per-day values of metric i.
 */
export async function goalReachesByDay(
  client: MetrikaClient,
  opts: GoalReachesQueryOptions,
): Promise<{ raw: StatDataResponse; rows: GoalDayRow[] }> {
  const filters = opts.filters ?? statFilters();
  const raw = await client.get(
    ENDPOINTS.statByTime,
    {
      ids: opts.counterId,
      metrics: goalReachMetrics(opts.goalIds),
      group: 'day',
      date1: opts.from,
      date2: opts.to,
      ...(filters ? { filters } : {}),
    },
    StatDataResponseSchema,
  );
  const days = daysBetween(opts.from, opts.to);
  // With no dimensions the response holds a single row; series[i] = values of metric i over days.
  const series = raw.data[0]?.metrics ?? [];
  const rows: GoalDayRow[] = [];
  for (const [i, goalId] of opts.goalIds.entries()) {
    const values = series[i];
    if (!Array.isArray(values)) continue;
    for (const [d, value] of values.entries()) {
      rows.push({ date: days[d] ?? opts.from, goalId, reaches: value ?? 0 });
    }
  }
  return { raw, rows: mergeGoalDayRows(rows) };
}
