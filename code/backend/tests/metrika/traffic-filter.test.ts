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

  it('excludes robots with the live-verified expression', () => {
    expect(ROBOT_FILTER).toBe("ym:s:isRobot!='yes'");
  });

  it('matches the TEST_FILTER expression live mode uses for sandbox URLs', () => {
    expect(TEST_URL_FILTER).toBe("ym:s:startURL!~'^file:'");
  });

  it('AND-combines both exclusions into the default sync filter', () => {
    expect(EXCLUDE_TEST_TRAFFIC).toBe(`${ROBOT_FILTER} AND ${TEST_URL_FILTER}`);
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
