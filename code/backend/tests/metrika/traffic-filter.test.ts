import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ROBOT_FILTER,
  TEST_URL_FILTER,
  EXCLUDE_TEST_TRAFFIC,
  INCLUDE_TEST_TRAFFIC_ENV,
  TEST_TRAFFIC_PATTERNS_ENV,
  EXCLUDE_ENV_TEST_ENV,
  EXCLUDE_ENV_TEST_FILTER,
  parseTestTrafficPatterns,
  escapeMetrikaRegex,
  testPatternFilter,
  composeTestTrafficFilter,
  statFilters,
} from '../../src/metrika/traffic-filter';

/**
 * ANA-22: the test/service-traffic exclusion must be ONE shared constant used by both the daily
 * sync and live mode. Expressions are verified against the live Reporting API (error 4001 for the
 * capitalised `!=Yes`, error 4007 for `!~` on isRobot — only the forms below pass).
 */
describe('traffic-filter (ANA-22)', () => {
  const env = process.env[INCLUDE_TEST_TRAFFIC_ENV];

  afterEach(() => {
    if (env === undefined) delete process.env[INCLUDE_TEST_TRAFFIC_ENV];
    else process.env[INCLUDE_TEST_TRAFFIC_ENV] = env;
  });

  it('excludes robots with the live-verified expression (kept for reference, NOT sent in sync queries)', () => {
    // ANA-65 reconciliation: isRobot + breakdown ⇒ contains_sensitive_data ⇒ Metrika silently
    // drops small rows (8% of visits lost while totals stayed exact). Robots are excluded
    // server-side by the counter setting filter_robots=1 instead — the sync must not send this.
    expect(ROBOT_FILTER).toBe("ym:s:isRobot!='yes'");
  });

  it('matches the TEST_FILTER expression live mode uses for sandbox URLs', () => {
    expect(TEST_URL_FILTER).toBe("ym:s:startURL!~'^file:'");
  });

  it('default sync filter excludes test sessions only — never the isRobot expression', () => {
    expect(EXCLUDE_TEST_TRAFFIC).toBe(TEST_URL_FILTER);
    expect(statFilters()).toBe(TEST_URL_FILTER);
    expect(statFilters()).not.toContain('isRobot');
  });

  it('filters by default (env unset)', () => {
    delete process.env[INCLUDE_TEST_TRAFFIC_ENV];
    expect(statFilters()).toBe(EXCLUDE_TEST_TRAFFIC);
  });

  it('keeps filtering for any value other than 1', () => {
    process.env[INCLUDE_TEST_TRAFFIC_ENV] = '0';
    expect(statFilters()).toBe(EXCLUDE_TEST_TRAFFIC);
  });

  it('INCLUDE_TEST_TRAFFIC=1 disables the filter (no filters param)', () => {
    process.env[INCLUDE_TEST_TRAFFIC_ENV] = '1';
    expect(statFilters()).toBeUndefined();
  });

  it('accepts an injected env value (testability)', () => {
    vi.stubEnv(INCLUDE_TEST_TRAFFIC_ENV, '1');
    expect(statFilters(process.env[INCLUDE_TEST_TRAFFIC_ENV])).toBeUndefined();
    vi.unstubAllEnvs();
    expect(statFilters('')).toBe(EXCLUDE_TEST_TRAFFIC);
  });
});

/**
 * ANA-22 (layer 2): admin-configurable test-traffic patterns (TEST_TRAFFIC_PATTERNS) and the
 * pc-goals env=test visit-param filter, layered ON TOP of the base file:// filter. The layers
 * must never introduce the isRobot expression (see the traffic-filter header / ANA-65).
 */
describe('traffic-filter test-traffic patterns (ANA-22)', () => {
  const savedInclude = process.env[INCLUDE_TEST_TRAFFIC_ENV];
  const savedPatterns = process.env[TEST_TRAFFIC_PATTERNS_ENV];
  const savedEnvTest = process.env[EXCLUDE_ENV_TEST_ENV];

  afterEach(() => {
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore(INCLUDE_TEST_TRAFFIC_ENV, savedInclude);
    restore(TEST_TRAFFIC_PATTERNS_ENV, savedPatterns);
    restore(EXCLUDE_ENV_TEST_ENV, savedEnvTest);
  });

  it('parses the admin pattern list (comma / semicolon / newline, quotes and blanks dropped)', () => {
    expect(
      parseTestTrafficPatterns('/test_1, /page312425509.html;metrika_test\nclaude_check'),
    ).toEqual(['/test_1', '/page312425509.html', 'metrika_test', 'claude_check']);
    expect(parseTestTrafficPatterns('  \'test_claude\', "qa" ,, ')).toEqual(['test_claude', 'qa']);
    expect(parseTestTrafficPatterns('')).toEqual([]);
  });

  it('builds a parenthesised negative match on the start URL and UTM fields for one token', () => {
    expect(testPatternFilter('metrika_test')).toBe(
      "(ym:s:startURL!~'metrika_test' AND ym:s:utmSource!~'^metrika_test$'" +
        " AND ym:s:utmCampaign!~'^metrika_test$' AND ym:s:utmMedium!~'^metrika_test$')",
    );
  });

  it('escapes regex metacharacters in patterns (a literal /test_1 must stay literal)', () => {
    expect(testPatternFilter('/test_1')).toContain("ym:s:startURL!~'/test_1'");
    expect(testPatternFilter('a.b(c)')).toContain("ym:s:startURL!~'a\\.b\\(c\\)'");
  });

  it('composes base + env-param + pattern layers with AND', () => {
    const f = composeTestTrafficFilter({
      patterns: ['/test_1', 'metrika_test'],
      excludeEnvTest: true,
    });
    expect(f).toBe(
      [
        TEST_URL_FILTER,
        EXCLUDE_ENV_TEST_FILTER,
        testPatternFilter('/test_1'),
        testPatternFilter('metrika_test'),
      ].join(' AND '),
    );
  });

  it('returns just the base filter when no extra layers are configured', () => {
    expect(composeTestTrafficFilter({})).toBe(EXCLUDE_TEST_TRAFFIC);
  });

  it('never includes the isRobot expression in any composed filter', () => {
    const f = composeTestTrafficFilter({ patterns: ['qa', 'claude_check'], excludeEnvTest: true });
    expect(f).not.toContain('isRobot');
  });

  it('INCLUDE_TEST_TRAFFIC=1 still disables every layer', () => {
    expect(composeTestTrafficFilter({ patterns: ['qa'], includeEnv: '1' })).toBeUndefined();
  });

  it('statFilters picks the pattern list and env-param switch up from the environment', () => {
    delete process.env[INCLUDE_TEST_TRAFFIC_ENV];
    process.env[TEST_TRAFFIC_PATTERNS_ENV] = '/test_1, metrika_test';
    process.env[EXCLUDE_ENV_TEST_ENV] = '1';
    expect(statFilters()).toBe(
      [
        TEST_URL_FILTER,
        EXCLUDE_ENV_TEST_FILTER,
        testPatternFilter('/test_1'),
        testPatternFilter('metrika_test'),
      ].join(' AND '),
    );
  });

  it('statFilters stays at the base filter when the extra env vars are unset', () => {
    delete process.env[TEST_TRAFFIC_PATTERNS_ENV];
    delete process.env[EXCLUDE_ENV_TEST_ENV];
    expect(statFilters()).toBe(EXCLUDE_TEST_TRAFFIC);
  });
});

/**
 * ANA-22 layer 2 (appended): admin-configurable test-page/UTM patterns and the pc-goals
 * `env=test` visit-param filter — layered ON TOP of the base file:// filter above. Like the
 * base layer, nothing here may ever contain the isRobot expression (breakdown safety).
 */
describe('traffic-filter — admin patterns + env-param layer (ANA-22)', () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    delete process.env[TEST_TRAFFIC_PATTERNS_ENV];
    delete process.env[EXCLUDE_ENV_TEST_ENV];
    for (const k of Object.keys(process.env))
      if (!(k in snapshot) && k.startsWith('INCLUDE_TEST')) delete process.env[k];
    process.env[INCLUDE_TEST_TRAFFIC_ENV] = snapshot[INCLUDE_TEST_TRAFFIC_ENV] as string;
  });

  it('parses comma / semicolon / newline lists and strips quotes and blanks', () => {
    expect(parseTestTrafficPatterns(" /test_1, page312425509.html;\nmetrika_test; 'qa' ")).toEqual([
      '/test_1',
      'page312425509.html',
      'metrika_test',
      'qa',
    ]);
    expect(parseTestTrafficPatterns('')).toEqual([]);
  });

  it('escapes regex metacharacters in patterns', () => {
    expect(escapeMetrikaRegex('/test_(1)')).toBe('/test_\\(1\\)');
    expect(escapeMetrikaRegex('a.b*c')).toBe('a\\.b\\*c');
  });

  it('one pattern excludes it from the start URL (substring) and UTM fields (exact)', () => {
    expect(testPatternFilter('/test_1')).toBe(
      "(ym:s:startURL!~'/test_1'" +
        " AND ym:s:utmSource!~'^/test_1$'" +
        " AND ym:s:utmCampaign!~'^/test_1$'" +
        " AND ym:s:utmMedium!~'^/test_1$')",
    );
  });

  it('composes base + patterns + env-test layers with AND; never isRobot', () => {
    const f = composeTestTrafficFilter({
      patterns: ['metrika_test', '/1111'],
      excludeEnvTest: true,
    });
    expect(f).toContain(TEST_URL_FILTER);
    expect(f).toContain("ym:s:startURL!~'metrika_test'");
    expect(f).toContain("ym:s:startURL!~'/1111'");
    expect(f).toContain(EXCLUDE_ENV_TEST_FILTER);
    expect(f).not.toContain('isRobot');
    // base + env-param + 2 patterns = 3 extra ANDed parenthesised groups on top of the base.
    expect((f?.match(/ AND \(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('env-test filter keeps visits without the param and env=prod, drops env=test', () => {
    // The OR keeps a visit that misses either the name or the value marker.
    expect(EXCLUDE_ENV_TEST_FILTER).toBe("(ym:s:paramsLevel1!='env' OR ym:s:paramsLevel2!='test')");
  });

  it('INCLUDE_TEST_TRAFFIC=1 disables every layer at once', () => {
    expect(composeTestTrafficFilter({ includeEnv: '1', patterns: ['qa'] })).toBeUndefined();
  });

  it('statFilters reads the admin TEST_TRAFFIC_PATTERNS env on top of the base filter', () => {
    process.env[TEST_TRAFFIC_PATTERNS_ENV] = 'metrika_test, claude_check';
    const f = statFilters();
    expect(f).toContain(TEST_URL_FILTER);
    expect(f).toContain("ym:s:startURL!~'metrika_test'");
    expect(f).toContain("ym:s:startURL!~'claude_check'");
    expect(f).not.toContain('paramsLevel1'); // env-param layer is opt-in (EXCLUDE_ENV_TEST_TRAFFIC=1)
  });

  it('statFilters adds the env-param layer when EXCLUDE_ENV_TEST_TRAFFIC=1', () => {
    process.env[EXCLUDE_ENV_TEST_ENV] = '1';
    expect(statFilters()).toContain(EXCLUDE_ENV_TEST_FILTER);
  });

  it('statFilters returns undefined with INCLUDE_TEST_TRAFFIC=1 even with patterns set', () => {
    process.env[TEST_TRAFFIC_PATTERNS_ENV] = 'qa';
    process.env[INCLUDE_TEST_TRAFFIC_ENV] = '1';
    expect(statFilters()).toBeUndefined();
  });
});
