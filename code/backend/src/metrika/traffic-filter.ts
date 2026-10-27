/**
 * Shared test/service-traffic exclusion for the Metrika Reporting API (audit bug ANA-22).
 *
 * Robots — DO NOT send `ym:s:isRobot` in breakdown requests. Since 2026-10 any isRobot filter or
 * dimension combined with a breakdown marks the response `contains_sensitive_data: true` and
 * Metrika silently DROPS small rows while keeping totals exact (reconciliation ANA-65: 8% of
 * visits lost in channel_stats). Robots are therefore excluded server-side by the counter setting
 * `filter_robots=1` (verified 2026-10-27 via the management API). ROBOT_FILTER below is kept only
 * as the documented, live-verified expression for ad-hoc totals queries (no breakdown) — never
 * re-add it to the sync queries.
 *
 * Test/sandbox sessions (`file:` start URLs marked by pc-goals) — excluded by the query filter
 * below, identical to TEST_FILTER in `src/live/live.ts`. The `A AND B` combination works on
 * `/stat/v1/data` and `/stat/v1/data/bytime` alike.
 *
 * Follow-up (outside the metrika scope): `src/live/live.ts` should import TEST_URL_FILTER from
 * here instead of keeping its own copy of the expression.
 */

/**
 * Robots (crawlers, bots) — ad-hoc totals queries only (never with breakdowns, see the header).
 * Real exclusion happens via the counter-level `filter_robots=1` setting.
 */
export const ROBOT_FILTER = "ym:s:isRobot!='yes'";

/** Test/sandbox sessions marked by pc-goals (`file:` start URLs) — same as live.ts TEST_FILTER. */
export const TEST_URL_FILTER = "ym:s:startURL!~'^file:'";

/**
 * The filter the daily sync applies by default: test sessions only. Robots arrive already
 * excluded by the counter-level filter_robots=1 setting (see the header).
 */
export const EXCLUDE_TEST_TRAFFIC = TEST_URL_FILTER;

/** Env switch: set to `1` to disable the exclusion (include test/robot traffic in the sync). */
export const INCLUDE_TEST_TRAFFIC_ENV = 'INCLUDE_TEST_TRAFFIC';

/**
 * Resolve the Reporting API `filters` value for a sync query. Filtering is ON by default;
 * `INCLUDE_TEST_TRAFFIC=1` turns it off (returns undefined → no `filters` param is sent).
 * `includeEnv` is injectable for tests.
 */
export function statFilters(
  includeEnv: string | undefined = process.env[INCLUDE_TEST_TRAFFIC_ENV],
): string | undefined {
  return includeEnv === '1' ? undefined : EXCLUDE_TEST_TRAFFIC;
}
