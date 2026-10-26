/**
 * Shared test/service-traffic exclusion for the Metrika Reporting API (audit bug ANA-22).
 *
 * Historically only the real-time module (`src/live/live.ts`, TEST_FILTER) excluded test traffic;
 * the daily sync pulled everything, so cached tables counted robots and dev visits while live mode
 * did not. Both paths must exclude the same traffic, so the sync queries all pass the constants
 * below as their `filters` param.
 *
 * Expressions verified against the live API (counter 54280963):
 * - `ym:s:isRobot!='yes'` — isRobot enum ids are lowercase `yes`/`no` (`People`/`Robots` when
 *   grouped); `!=Yes` (capitalised, unquoted) fails with error 4001, and `!~` is not supported
 *   for this dimension (error 4007).
 * - `ym:s:startURL!~'^file:'` — sandbox/test sessions marked by pc-goals; identical to the
 *   TEST_FILTER exported by `src/live/live.ts`.
 * - The `A AND B` combination works on `/stat/v1/data` and `/stat/v1/data/bytime` alike.
 *
 * Follow-up (outside the metrika scope): `src/live/live.ts` should import TEST_URL_FILTER from
 * here instead of keeping its own copy of the expression.
 */

/** Robots (crawlers, bots) — excluded from every business metric. */
export const ROBOT_FILTER = "ym:s:isRobot!='yes'";

/** Test/sandbox sessions marked by pc-goals (`file:` start URLs) — same as live.ts TEST_FILTER. */
export const TEST_URL_FILTER = "ym:s:startURL!~'^file:'";

/** Robots AND test sessions, AND-combined — the filter the daily sync applies by default. */
export const EXCLUDE_TEST_TRAFFIC = `${ROBOT_FILTER} AND ${TEST_URL_FILTER}`;

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
