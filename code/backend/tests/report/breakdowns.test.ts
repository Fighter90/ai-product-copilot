import { describe, it, expect } from 'vitest';
import type { UtmStat, GeoDeviceStat, PageStat } from '@pca/shared';
import { topUtm, topGeoDevice, topPages, TOP_N } from '../../src/report/breakdowns';

const utm = (over: Partial<UtmStat>): UtmStat => ({
  date: '2025-01-01',
  utmSource: 'vk',
  utmMedium: 'cpc',
  utmCampaign: 'spring',
  visits: 10,
  users: 9,
  goalReaches: 1,
  conversionRate: 0.1,
  ...over,
});

const geo = (over: Partial<GeoDeviceStat>): GeoDeviceStat => ({
  date: '2025-01-01',
  country: 'Россия',
  device: 'mobile',
  visits: 10,
  users: 9,
  goalReaches: 1,
  conversionRate: 0.1,
  ...over,
});

const page = (over: Partial<PageStat>): PageStat => ({
  date: '2025-01-01',
  page: '/lp',
  visits: 10,
  users: 9,
  bounceRate: 0.2,
  goalReaches: 1,
  conversionRate: 0.1,
  ...over,
});

describe('topUtm', () => {
  it('aggregates by source/medium/campaign across days, sorted by visits desc', () => {
    const rows = topUtm([
      utm({ visits: 10, goalReaches: 1 }),
      utm({ visits: 30, goalReaches: 2 }), // same triple merges → 40
      utm({ utmSource: 'tg', utmMedium: 'social', utmCampaign: 'launch', visits: 5 }),
    ]);
    expect(rows[0]).toEqual({
      source: 'vk',
      medium: 'cpc',
      campaign: 'spring',
      visits: 40,
      goalReaches: 3,
    });
    expect(rows[1]?.source).toBe('tg');
  });

  it('keeps at most TOP_N rows', () => {
    const many = Array.from({ length: TOP_N + 3 }, (_, i) =>
      utm({ utmCampaign: `c${i}`, visits: i + 1 }),
    );
    expect(topUtm(many)).toHaveLength(TOP_N);
  });
});

describe('topGeoDevice', () => {
  it('aggregates by country/device, sorted by visits desc', () => {
    const rows = topGeoDevice([
      geo({ visits: 10 }),
      geo({ visits: 20 }), // same key merges → 30
      geo({ country: 'Казахстан', device: 'desktop', visits: 50 }),
    ]);
    expect(rows[0]).toEqual({
      country: 'Казахстан',
      device: 'desktop',
      visits: 50,
      goalReaches: 1,
    });
    expect(rows[1]).toEqual({ country: 'Россия', device: 'mobile', visits: 30, goalReaches: 2 });
  });
});

describe('topPages', () => {
  it('aggregates by page, visit-weights bounce rate, guards zero visits', () => {
    const rows = topPages([
      page({ page: '/lp', visits: 10, bounceRate: 0.5, goalReaches: 1 }),
      page({ page: '/lp', visits: 30, bounceRate: 0.1, goalReaches: 2 }), // → bounce (5+3)/40=0.2
      page({ page: '/empty', visits: 0, bounceRate: 0, goalReaches: 0 }),
    ]);
    expect(rows[0]?.page).toBe('/lp');
    expect(rows[0]?.visits).toBe(40);
    expect(rows[0]?.bounceRate).toBeCloseTo(0.2);
    expect(rows.find((r) => r.page === '/empty')?.bounceRate).toBe(0);
  });

  it('aggregates scheme/host URL variants of one path into one row (ANA-178)', () => {
    const rows = topPages([
      page({ page: 'https://productcamp.ru/about', visits: 5, bounceRate: 0.4, goalReaches: 1 }),
      page({ page: 'http://productcamp.ru/about', visits: 3, bounceRate: 0, goalReaches: 0 }),
      page({ page: 'https://www.productcamp.ru/about/', visits: 2, bounceRate: 1, goalReaches: 1 }),
      page({ page: '/other', visits: 1, bounceRate: 0, goalReaches: 0 }),
    ]);
    const about = rows.filter((r) => r.page === '/about');
    expect(about).toHaveLength(1);
    expect(about[0]?.visits).toBe(10);
    expect(about[0]?.goalReaches).toBe(2);
    // visit-weighted bounce: (5×0.4 + 2×1) / 10
    expect(about[0]?.bounceRate).toBeCloseTo((5 * 0.4 + 2 * 1) / 10);
  });
});
