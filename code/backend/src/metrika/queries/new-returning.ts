import { DIMENSION_NONE } from '@pca/shared';
import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
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
}

type Row = StatDataResponse['data'][number];

function mapRow(row: Row, opts: NewReturningQueryOptions): NewReturningStat {
  const m = row.metrics;
  const hasGoal = opts.goalId !== undefined;
  return {
    date: opts.from,
    segment: row.dimensions[0]?.name ?? DIMENSION_NONE,
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

/** Fetch the new/returning visitor split; returns raw response + parsed stats. */
export async function newReturningBreakdown(
  client: MetrikaClient,
  opts: NewReturningQueryOptions,
): Promise<{ raw: StatDataResponse; stats: NewReturningStat[] }> {
  const raw = await client.get(
    ENDPOINTS.statData,
    {
      ids: opts.counterId,
      dimensions: 'ym:s:isNewUser',
      metrics: newReturningMetrics(opts.goalId),
      date1: opts.from,
      date2: opts.to,
      attribution: 'lastsign',
    },
    StatDataResponseSchema,
  );
  return { raw, stats: raw.data.map((row) => mapRow(row, opts)) };
}
