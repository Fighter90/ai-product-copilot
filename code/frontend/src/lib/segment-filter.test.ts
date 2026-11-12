import { describe, it, expect } from 'vitest';
import {
  filterBySegment,
  filterUtmBySegment,
  filterGeoBySegment,
  filterPagesBySegment,
} from './segment-filter';
import type { ChannelStat, UtmStat, GeoDeviceStat, PageStat } from '@pca/shared';

const makeChannel = (channel: string, visits = 100, goalReaches = 10): ChannelStat => ({
  date: '2025-01-01',
  channel,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  visits,
  users: 90,
  bounceRate: 0.2,
  avgDuration: 60,
  goalReaches,
  conversionRate: goalReaches / visits,
});

const makeUtm = (
  source: string,
  medium: string,
  campaign: string,
  visits = 50,
  goalReaches = 5,
): UtmStat => ({
  date: '2025-01-01',
  utmSource: source,
  utmMedium: medium,
  utmCampaign: campaign,
  visits,
  users: visits,
  goalReaches,
  conversionRate: goalReaches / visits,
});

describe('segment classification by Metrika lastTrafficSource ids (ANA-17)', () => {
  it('b2c keeps every Metrika source incl. en names AND ru/legacy aliases', () => {
    const channels = [
      makeChannel('Ad traffic'),
      makeChannel('Direct traffic'),
      makeChannel('Search engine traffic'),
      makeChannel('Link traffic'),
      makeChannel('Social network traffic'), // Метрика: singular, не «Social networks traffic»
      makeChannel('Recommendation system traffic'),
      makeChannel('Cached page traffic'),
      makeChannel('Mailing traffic'),
      makeChannel('Messenger traffic'),
      makeChannel('Internal traffic'),
      makeChannel('Переходы из поисковых систем'), // ru alias → resolves to 'organic'
      makeChannel('Unknown custom channel'),
    ];
    const result = filterBySegment(channels, 'b2c');
    expect(result).toHaveLength(11);
    expect(result.map((c) => c.channel)).not.toContain('Unknown custom channel');
  });

  it('b2b keeps only rows NOT classified as Metrika sources (b2b_manual)', () => {
    const channels = [
      makeChannel('Direct traffic', 100, 10),
      makeChannel('Search engine traffic', 80, 8),
      makeChannel('b2b_manual', 34, 20),
    ];
    const result = filterBySegment(channels, 'b2b');
    expect(result).toHaveLength(1);
    expect(result[0]!.channel).toBe('b2b_manual');
  });

  it('b2c_b2b returns both sources unchanged', () => {
    const channels = [makeChannel('Direct traffic'), makeChannel('b2b_manual')];
    expect(filterBySegment(channels, 'b2c_b2b')).toHaveLength(2);
  });
});

describe('filterBySegment', () => {
  it('returns all channels for b2c_b2b segment', () => {
    const channels = [makeChannel('Direct traffic'), makeChannel('Search engine traffic')];
    expect(filterBySegment(channels, 'b2c_b2b')).toHaveLength(2);
  });

  it('returns only B2C channels for b2c segment', () => {
    const channels = [
      makeChannel('Direct traffic', 100, 10),
      makeChannel('Search engine traffic', 80, 8),
      makeChannel('Social networks traffic', 60, 3),
    ];
    const result = filterBySegment(channels, 'b2c');
    expect(result).toHaveLength(3);
    expect(result.every((c) => c.channel)).toBe(true);
  });

  it('returns empty array for b2b segment (no B2B channels defined by default)', () => {
    const channels = [makeChannel('Direct traffic'), makeChannel('Search engine traffic')];
    expect(filterBySegment(channels, 'b2b')).toHaveLength(0);
  });

  it('handles empty input', () => {
    expect(filterBySegment([], 'b2c')).toEqual([]);
    expect(filterBySegment([], 'b2b')).toEqual([]);
    expect(filterBySegment([], 'b2c_b2b')).toEqual([]);
  });
});

// ANA-139: the UTM breakdown is its own Metrika dataset and does not inherit the channel
// segment filter. The old «active sources» cross-filter derived UTM sources from
// channel_stats.utmSource — permanently null since the M-004 fix (the channel query uses a
// single lastsignTrafficSource dimension) — so the whole UTM table, Sankey and coverage
// read empty in the B2C/B2B segments while Metrika had the data.
describe('filterUtmBySegment — ANA-139', () => {
  const utm = [makeUtm('vk', 'cpc', 'spring', 40, 4), makeUtm('telegram', 'social', 'post', 20, 2)];

  it('returns all UTM data for b2c_b2b segment', () => {
    expect(filterUtmBySegment(utm, 'b2c_b2b')).toEqual(utm);
  });

  it('b2c keeps the whole UTM breakdown even though channel rows carry no UTM (M-004 shape)', () => {
    const channels = [makeChannel('Ad traffic'), makeChannel('Search engine traffic')];
    expect(channels.every((c) => c.utmSource === null)).toBe(true);
    expect(filterUtmBySegment(utm, 'b2c')).toEqual(utm);
  });

  it('b2c shows UTM data even when the segment leaves no channel rows', () => {
    expect(filterUtmBySegment(utm, 'b2c')).toEqual(utm);
  });

  it('b2b stays manual-only: Metrika UTM rows never belong to the B2B segment', () => {
    expect(filterUtmBySegment(utm, 'b2b')).toEqual([]);
  });

  it('handles empty UTM data', () => {
    expect(filterUtmBySegment([], 'b2c')).toEqual([]);
    expect(filterUtmBySegment([], 'b2b')).toEqual([]);
    expect(filterUtmBySegment([], 'b2c_b2b')).toEqual([]);
  });
});

describe('filterGeoBySegment', () => {
  it('returns all geo data unchanged for any segment', () => {
    const geo: GeoDeviceStat[] = [
      {
        date: '2025-01-01',
        country: 'Россия',
        device: 'mobile',
        visits: 60,
        users: 55,
        goalReaches: 3,
        conversionRate: 0.05,
      },
    ];
    expect(filterGeoBySegment(geo, 'b2c')).toEqual(geo);
    expect(filterGeoBySegment(geo, 'b2b')).toEqual(geo);
    expect(filterGeoBySegment(geo, 'b2c_b2b')).toEqual(geo);
  });

  it('handles empty input', () => {
    expect(filterGeoBySegment([], 'b2c')).toEqual([]);
  });
});

describe('filterPagesBySegment', () => {
  it('returns all page data unchanged for any segment', () => {
    const pages: PageStat[] = [
      {
        date: '2025-01-01',
        page: '/lp',
        visits: 100,
        users: 90,
        bounceRate: 0.2,
        goalReaches: 5,
        conversionRate: 0.05,
      },
    ];
    expect(filterPagesBySegment(pages, 'b2c')).toEqual(pages);
    expect(filterPagesBySegment(pages, 'b2b')).toEqual(pages);
    expect(filterPagesBySegment(pages, 'b2c_b2b')).toEqual(pages);
  });

  it('handles empty input', () => {
    expect(filterPagesBySegment([], 'b2c')).toEqual([]);
  });
});

describe('filterBySegment — channel with no channel property', () => {
  it('filters out items with falsy channel when not b2c_b2b', () => {
    // Items without a channel field should be excluded when filtering by segment
    const itemsWithNoChannel = [{ channel: undefined, visits: 10, goalReaches: 1 }] as Array<{
      channel?: string;
      visits: number;
      goalReaches: number;
    }>;
    expect(filterBySegment(itemsWithNoChannel, 'b2c')).toHaveLength(0);
  });
});
