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
  if (includeEnv === '1') return undefined;
  return composeTestTrafficFilter({
    patterns: parseTestTrafficPatterns(process.env[TEST_TRAFFIC_PATTERNS_ENV] ?? ''),
    excludeEnvTest: process.env[EXCLUDE_ENV_TEST_ENV] === '1',
  });
}

// ---------------------------------------------------------------------------
// ANA-22 (layer 2): admin-configurable test/service-traffic patterns, layered
// ON TOP of the base sync filter above. The base layer (test `file:` sessions)
// and the counter-level robot filter are owned by the ANA-65 reconciliation —
// never fold isRobot into anything built here (breakdown queries must not
// receive it, see the file header).
// ---------------------------------------------------------------------------

/** Env/setting key holding the admin's test-page/UTM pattern list (TEST_TRAFFIC_PATTERNS). */
export const TEST_TRAFFIC_PATTERNS_ENV = 'TEST_TRAFFIC_PATTERNS';

/** Env switch (`1`) to also exclude visits whose pc-goals visit-param marks env=test. */
export const EXCLUDE_ENV_TEST_ENV = 'EXCLUDE_ENV_TEST_TRAFFIC';

/**
 * Visits carrying the pc-goals marker visit-param `env=test` are dropped; everything else stays.
 * In Metrika terms: param name on paramsLevel1, value on paramsLevel2 — a visit without the param
 * has neither, so the OR keeps it; env=prod fails the second clause and stays; env=test fails both
 * and is excluded. Parenthesised so it AND-composes safely with the other layers.
 */
export const EXCLUDE_ENV_TEST_FILTER = "(ym:s:paramsLevel1!='env' OR ym:s:paramsLevel2!='test')";

/** Split the admin's TEST_TRAFFIC_PATTERNS value (comma / newline / semicolon separated). */
export function parseTestTrafficPatterns(raw: string): string[] {
  return raw
    .split(/[;,\n]+/)
    .map((s) => s.trim())
    .map((s) => s.replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0);
}

/** Escape a literal pattern for use inside a Metrika `!~` PCRE expression. */
export function escapeMetrikaRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One admin pattern (a page fragment like `/test_1` or `page312425509.html`, or a UTM value like
 * `metrika_test`) → the expression that keeps only visits NOT matching it on the start URL or any
 * UTM field. Substring match on URLs, exact match on UTM values (a UTM `qa` must not exclude
 * `qatar`). Parenthesised for safe AND-composition.
 */
export function testPatternFilter(token: string): string {
  const re = escapeMetrikaRegex(token);
  return (
    `(ym:s:startURL!~'${re}'` +
    ` AND ym:s:utmSource!~'^${re}$'` +
    ` AND ym:s:utmCampaign!~'^${re}$'` +
    ` AND ym:s:utmMedium!~'^${re}$')`
  );
}

export interface TestTrafficLayers {
  /** Parsed TEST_TRAFFIC_PATTERNS tokens (see parseTestTrafficPatterns). */
  readonly patterns?: readonly string[];
  /** Exclude visits with the pc-goals env=test marker ({@link EXCLUDE_ENV_TEST_FILTER}). */
  readonly excludeEnvTest?: boolean;
  /** `INCLUDE_TEST_TRAFFIC=1` disables every layer (no `filters` param at all). */
  readonly includeEnv?: string;
}

/**
 * Compose the full sync filter from the base test-session filter plus the optional ANA-22 layers.
 * Returns undefined when filtering is disabled, so callers can omit the `filters` param entirely.
 * Never contains the isRobot expression (see the file header).
 */
export function composeTestTrafficFilter(layers: TestTrafficLayers = {}): string | undefined {
  if (layers.includeEnv === '1') return undefined;
  const parts: string[] = [EXCLUDE_TEST_TRAFFIC];
  if (layers.excludeEnvTest) parts.push(EXCLUDE_ENV_TEST_FILTER);
  for (const p of layers.patterns ?? []) parts.push(testPatternFilter(p));
  return parts.join(' AND ');
}
