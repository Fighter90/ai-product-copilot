import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ROBOT_FILTER,
  TEST_URL_FILTER,
  EXCLUDE_TEST_TRAFFIC,
  INCLUDE_TEST_TRAFFIC_ENV,
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
