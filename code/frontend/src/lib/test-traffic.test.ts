import { describe, it, expect } from 'vitest';
import type { PageStat, UtmStat } from '@pca/shared';
import {
  isTestPage,
  isTestUtm,
  isTestChannelRow,
  applyTestTrafficFilter,
  TEST_PAGE_PATTERNS,
  TEST_UTM_VALUES,
} from './test-traffic';

const page = (over: Partial<PageStat> = {}): PageStat => ({
  date: '2026-10-20',
  page: '/tickets',
  visits: 10,
  users: 9,
  bounceRate: 0.2,
  goalReaches: 1,
  conversionRate: 0.1,
  ...over,
});

const utm = (over: Partial<UtmStat> = {}): UtmStat => ({
  date: '2026-10-20',
  utmSource: 'vk',
  utmMedium: 'cpc',
  utmCampaign: 'spring',
  visits: 10,
  users: 9,
  goalReaches: 1,
  conversionRate: 0.1,
  ...over,
});

/**
 * ANA-22 client layer: known test pages/UTM values are hidden by default and come back with
 * the FilterBar «Показать тестовый трафик» toggle.
 */
describe('test-traffic (ANA-22)', () => {
  it('flags the known test pages from the live audit and file:// sandbox URLs', () => {
    for (const p of ['/test_1', '/test4', '/1111', '/page312425509.html', '/page307382109.html']) {
      expect(isTestPage(p)).toBe(true);
    }
    expect(isTestPage('file:///var/lib/polygon/analyses/x.html')).toBe(true);
    expect(isTestPage('/tickets')).toBe(false);
    expect(isTestPage('/page31242550.html')).toBe(false); // substring must not over-match
    expect(isTestPage('/testing-guide')).toBe(false);
  });

  it('matches UTM values exactly (qa must not exclude qatar)', () => {
    expect(isTestUtm('metrika_test')).toBe(true);
    expect(isTestUtm('qa')).toBe(true);
    expect(isTestUtm('qatar')).toBe(false);
    expect(isTestUtm('vk', 'cpc', 'goals_check')).toBe(true);
    expect(isTestUtm('test_claude')).toBe(true);
    expect(isTestUtm(null, null, null)).toBe(false);
  });

  it('filters UTM/page/channel rows unless includeTest is set', () => {
    const utmRows = [
      utm(),
      utm({ utmSource: 'metrika_test', utmMedium: 'qa', utmCampaign: 'goals_check' }),
    ];
    expect(applyTestTrafficFilter(utmRows, false, isTestChannelRow)).toHaveLength(1);
    expect(applyTestTrafficFilter(utmRows, true, isTestChannelRow)).toHaveLength(2);

    const pageRows = [page(), page({ page: 'https://x.ru/test_1' })];
    expect(applyTestTrafficFilter(pageRows, false, (r) => isTestPage(r.page))).toHaveLength(1);
    expect(applyTestTrafficFilter(pageRows, true, (r) => isTestPage(r.page))).toHaveLength(2);
  });

  it('never mutates the input array', () => {
    const rows = [utm(), utm({ utmSource: 'qa' })];
    const out = applyTestTrafficFilter(rows, false, isTestChannelRow);
    expect(rows).toHaveLength(2);
    expect(out).not.toBe(rows);
  });

  it('ships the ANA-22 baseline patterns', () => {
    expect(TEST_PAGE_PATTERNS).toContain('/test_1');
    expect(TEST_UTM_VALUES).toContain('metrika_test');
  });
});
