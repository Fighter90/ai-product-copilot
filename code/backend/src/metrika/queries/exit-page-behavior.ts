import type { PageStat } from '@pca/shared';
import { DIMENSION_NONE } from '@pca/shared';
import type { MetrikaClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { StatDataResponseSchema, type StatDataResponse } from '../schemas';
import { statFilters } from '../traffic-filter';
import { aggregatePages, mergePageStats } from './normalize-page';
import { pageMetrics, type PageQueryOptions } from './page-behavior';
import { ratio } from './ratio';

type Row = StatDataResponse['data'][number];

function mapRow(row: Row, opts: PageQueryOptions): PageStat {
  const m = row.metrics;
  const hasGoal = opts.goalId !== undefined;
  return {
    date: opts.from,
    page: row.dimensions[0]?.name ?? DIMENSION_NONE,
    visits: m[0] ?? 0,
    users: m[1] ?? 0,
    bounceRate: ratio(m[2]),
    goalReaches: hasGoal ? (m[3] ?? 0) : 0,
    conversionRate: hasGoal ? ratio(m[4]) : 0,
  };
}

/**
 * Fetch behaviour broken down by exit page; returns raw response + parsed stats.
 *
 * Dimension: `ym:s:endURL` — verified against the live API. The Reporting API REJECTS the
 * intuitive `ym:s:exitURL` ("Incorrectly specified attribute … error code: 4001", audit bug
 * ANA-15); `endURL` with `attribution: lastsign` is the equivalent of "the page where the
 * session ended".
 */
export async function exitPageBehavior(
  client: MetrikaClient,
  opts: PageQueryOptions,
): Promise<{ raw: StatDataResponse; stats: PageStat[] }> {
  const filters = opts.filters ?? statFilters();
  const raw = await client.get(
    ENDPOINTS.statData,
    {
      ids: opts.counterId,
      dimensions: 'ym:s:endURL',
      metrics: pageMetrics(opts.goalId),
      date1: opts.from,
      date2: opts.to,
      attribution: 'lastsign',
      ...(filters ? { filters } : {}),
    },
    StatDataResponseSchema,
  );
  return {
    raw,
    stats: mergePageStats(aggregatePages(raw.data.map((row) => mapRow(row, opts)))),
  };
}
