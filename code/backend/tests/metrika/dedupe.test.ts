import { describe, it, expect } from 'vitest';
import { mergeByKey, weightedRate, reachRate } from '../../src/metrika/queries/dedupe';
import { mergeChannelStats } from '../../src/metrika/queries/traffic-by-source';
import { mergeUtmStats } from '../../src/metrika/queries/utm-breakdown';
import { mergeGeoDeviceStats } from '../../src/metrika/queries/geo-device-breakdown';
import { mergePageStats } from '../../src/metrika/queries/normalize-page';
import { mergeBrowserOsStats } from '../../src/metrika/queries/browser-os-breakdown';
import { mergeNewReturningStats } from '../../src/metrika/queries/new-returning';
import { mergeGoalDayRows } from '../../src/metrika/queries/goal-reaches-by-day';
import type { ChannelStat, GeoDeviceStat, PageStat, UtmStat } from '@pca/shared';

/**
 * ANA-16: every breakdown collapses rows sharing a table's natural key BEFORE the upsert, so
 * repeated keys sum up instead of overwriting (or accumulating as duplicates in legacy tables).
 */
describe('dedupe helpers', () => {
  it('mergeByKey groups by key, keeping first-seen order and folding via merge', () => {
    const merged = mergeByKey(
      [
        { k: 'a', n: 1 },
        { k: 'b', n: 10 },
        { k: 'a', n: 2 },
      ],
      (r) => r.k,
      (first, next) => ({ ...first, n: first.n + next.n }),
    );
    expect(merged).toEqual([
      { k: 'a', n: 3 },
      { k: 'b', n: 10 },
    ]);
  });

  it('weightedRate averages by visits and survives a zero-visit group', () => {
    expect(weightedRate(0.5, 100, 0.1, 100)).toBeCloseTo(0.3);
    expect(weightedRate(0.9, 0, 0.2, 50)).toBeCloseTo(0.2);
    expect(weightedRate(0.9, 0, 0.2, 0)).toBe(0);
  });

  it('reachRate is reaches/visits, 0 when there are no visits', () => {
    expect(reachRate(5, 100)).toBeCloseTo(0.05);
    expect(reachRate(5, 0)).toBe(0);
  });
});

const utm = (over: Partial<UtmStat>): UtmStat => ({
  date: '2025-01-01',
  utmSource: 'vk',
  utmMedium: 'cpc',
  utmCampaign: 'spring',
  visits: 10,
  users: 8,
  goalReaches: 2,
  conversionRate: 0.2,
  ...over,
});

describe('mergeUtmStats (ANA-16)', () => {
  it('sums duplicate (date, source, medium, campaign) rows and recomputes CR from the sums', () => {
    const merged = mergeUtmStats([
      utm({ visits: 10, users: 8, goalReaches: 1 }),
      utm({ visits: 30, users: 22, goalReaches: 5 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      visits: 40,
      users: 30,
      goalReaches: 6,
      conversionRate: 0.15,
    });
  });

  it('keeps distinct campaign keys apart', () => {
    const merged = mergeUtmStats([utm({ utmCampaign: 'spring' }), utm({ utmCampaign: 'fall' })]);
    expect(merged).toHaveLength(2);
  });
});

describe('mergeChannelStats (ANA-16)', () => {
  const channel = (over: Partial<ChannelStat> = {}): ChannelStat => ({
    date: '2025-01-01',
    channel: 'Search engine traffic',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    visits: 100,
    users: 90,
    bounceRate: 0.2,
    avgDuration: 60,
    goalReaches: 5,
    conversionRate: 0.05,
    ...over,
  });

  it('folds same-day channel rows from different chunks by (date, channel)', () => {
    const merged = mergeChannelStats([
      channel({ visits: 100, bounceRate: 0.2, avgDuration: 60, goalReaches: 5 }),
      channel({ visits: 100, bounceRate: 0.4, avgDuration: 120, goalReaches: 15 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      visits: 200,
      users: 180,
      goalReaches: 20,
      conversionRate: 0.1, // recomputed from sums, not averaged
      bounceRate: 0.3, // visit-weighted
      avgDuration: 90, // visit-weighted
    });
  });

  it('keeps different days and channels apart', () => {
    const merged = mergeChannelStats([
      channel(),
      channel({ date: '2025-01-02' }),
      channel({ channel: 'Direct traffic' }),
    ]);
    expect(merged).toHaveLength(3);
  });
});

describe('mergeGeoDeviceStats (ANA-16)', () => {
  const geo = (over: Partial<GeoDeviceStat> = {}): GeoDeviceStat => ({
    date: '2025-01-01',
    country: 'Россия',
    device: 'desktop',
    visits: 10,
    users: 8,
    goalReaches: 2,
    conversionRate: 0.2,
    ...over,
  });

  it('folds duplicate (date, country, device) rows', () => {
    const merged = mergeGeoDeviceStats([
      geo({ visits: 10, goalReaches: 2 }),
      geo({ visits: 40, goalReaches: 6 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      visits: 50,
      users: 16,
      goalReaches: 8,
      conversionRate: 0.16,
    });
  });
});

describe('mergePageStats (ANA-16)', () => {
  const page = (over: Partial<PageStat> = {}): PageStat => ({
    date: '2025-01-01',
    page: 'https://productcamp.ru',
    visits: 10,
    users: 8,
    bounceRate: 0.5,
    goalReaches: 1,
    conversionRate: 0.1,
    ...over,
  });

  it('folds duplicate (date, page) rows with visit-weighted rates', () => {
    const merged = mergePageStats([
      page({ visits: 10, bounceRate: 0.5, conversionRate: 0.2, goalReaches: 2 }),
      page({ visits: 90, bounceRate: 0.1, conversionRate: 0.0, goalReaches: 0 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      visits: 100,
      users: 16,
      goalReaches: 2,
      bounceRate: 0.14, // (0.5*10 + 0.1*90) / 100
      conversionRate: 0.02, // (0.2*10 + 0*90) / 100
    });
  });
});

describe('mergeBrowserOsStats / mergeNewReturningStats (ANA-16)', () => {
  it('folds duplicate (date, browser, os) rows', () => {
    const merged = mergeBrowserOsStats([
      {
        date: '2025-01-01',
        browser: 'Chrome',
        os: 'macOS',
        visits: 10,
        users: 8,
        goalReaches: 2,
        conversionRate: 0.2,
      },
      {
        date: '2025-01-01',
        browser: 'Chrome',
        os: 'macOS',
        visits: 15,
        users: 12,
        goalReaches: 3,
        conversionRate: 0.2,
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ visits: 25, users: 20, goalReaches: 5, conversionRate: 0.2 });
  });

  it('folds duplicate (date, segment) rows', () => {
    const merged = mergeNewReturningStats([
      {
        date: '2025-01-01',
        segment: 'NW',
        visits: 10,
        users: 10,
        goalReaches: 1,
        conversionRate: 0.1,
      },
      {
        date: '2025-01-01',
        segment: 'NW',
        visits: 40,
        users: 40,
        goalReaches: 3,
        conversionRate: 0.075,
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      segment: 'NW',
      visits: 50,
      goalReaches: 4,
      conversionRate: 0.08,
    });
  });
});

describe('mergeGoalDayRows (ANA-16)', () => {
  it('sums repeated (date, goalId) pairs instead of double-inserting them', () => {
    const merged = mergeGoalDayRows([
      { date: '2025-01-01', goalId: 80, reaches: 2 },
      { date: '2025-01-01', goalId: 80, reaches: 3 },
      { date: '2025-01-02', goalId: 80, reaches: 1 },
      { date: '2025-01-01', goalId: 90, reaches: 5 },
    ]);
    expect(merged).toEqual([
      { date: '2025-01-01', goalId: 80, reaches: 5 },
      { date: '2025-01-02', goalId: 80, reaches: 1 },
      { date: '2025-01-01', goalId: 90, reaches: 5 },
    ]);
  });
});
