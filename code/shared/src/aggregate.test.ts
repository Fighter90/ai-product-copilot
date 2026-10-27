import { describe, it, expect } from 'vitest';
import {
  aggregatePeriod,
  distinctCount,
  mergeByKey,
  reachRate,
  weightedAverage,
  weightedBounce,
  weightedRate,
} from './aggregate';

describe('mergeByKey', () => {
  it('collapses rows by key preserving first-seen order', () => {
    const out = mergeByKey(
      [
        { k: 'a', n: 1 },
        { k: 'b', n: 2 },
        { k: 'a', n: 3 },
      ],
      (r) => r.k,
      (x, y) => ({ k: x.k, n: x.n + y.n }),
    );
    expect(out).toEqual([
      { k: 'a', n: 4 },
      { k: 'b', n: 2 },
    ]);
  });
});

describe('rates', () => {
  it('weightedRate weights by visits and guards zero visits', () => {
    expect(weightedRate(1, 1, 0, 99)).toBeCloseTo(0.01);
    expect(weightedRate(0.5, 0, 0.5, 0)).toBe(0);
  });

  it('reachRate is reaches/visits, 0 without visits', () => {
    expect(reachRate(5, 100)).toBe(0.05);
    expect(reachRate(5, 0)).toBe(0);
  });

  it('weightedBounce is visit-weighted, not a plain mean (ANA-16)', () => {
    const rows = [
      { visits: 1000, bounceRate: 0.1 },
      { visits: 1, bounceRate: 1 },
    ];
    // Plain mean would be 55%; the weighted value stays ≈10%.
    expect(weightedBounce(rows)).toBeCloseTo((100 + 1) / 1001);
    expect(weightedBounce([])).toBe(0);
  });

  it('weightedAverage accepts any rate accessor', () => {
    expect(weightedAverage([{ visits: 2, cr: 0.5 }], (r) => r.cr)).toBe(0.5);
  });
});

describe('aggregatePeriod', () => {
  const day = (date: string, page: string, visits: number, bounceRate: number, reaches = 0) => ({
    date,
    page,
    visits,
    users: visits,
    bounceRate,
    goalReaches: reaches,
    conversionRate: visits ? reaches / visits : 0,
  });

  it('removes duplicate keys: sums visits/reaches, weights bounce, recomputes CR', () => {
    const rows = [
      day('2026-10-12', 'https://productcamp.ru/', 263, 0.2, 3),
      day('2026-10-13', 'https://productcamp.ru/', 202, 0.4, 1),
      day('2026-10-12', 'https://productcamp.ru/b2b', 10, 0.5, 0),
    ];
    const out = aggregatePeriod(rows, (r) => r.page);
    expect(out).toHaveLength(2);
    const home = out[0]!;
    expect(home.page).toBe('https://productcamp.ru/');
    expect(home.visits).toBe(465);
    expect(home.users).toBe(465);
    expect(home.goalReaches).toBe(4);
    expect(home.bounceRate).toBeCloseTo((263 * 0.2 + 202 * 0.4) / 465);
    expect(home.conversionRate).toBeCloseTo(4 / 465);
    expect(home.date).toBe('2026-10-12');
  });

  it('keys UTM rows by source+medium+campaign and sorts by visits desc', () => {
    const utm = (c: string, visits: number) => ({
      utmSource: 'tg',
      utmMedium: 'post',
      utmCampaign: c,
      visits,
    });
    const out = aggregatePeriod(
      [utm('program', 15), utm('program', 15), utm('promo', 40), utm('program', 10)],
      (r) => `${r.utmSource}|${r.utmMedium}|${r.utmCampaign}`,
    );
    expect(out.map((r) => [r.utmCampaign, r.visits])).toEqual([
      ['program', 40],
      ['promo', 40],
    ]);
    // Optional metrics that are absent stay absent.
    expect('bounceRate' in out[0]!).toBe(false);
  });

  it('falls back to a weighted CR when reaches are unknown', () => {
    const out = aggregatePeriod(
      [
        { k: 'x', visits: 10, conversionRate: 0.1, avgDuration: 10 },
        { k: 'x', visits: 30, conversionRate: 0.5, avgDuration: 50 },
      ],
      (r) => r.k,
    );
    expect(out[0]!.conversionRate).toBeCloseTo((1 + 15) / 40);
    expect(out[0]!.avgDuration).toBeCloseTo((100 + 1500) / 40);
  });
});

describe('distinctCount', () => {
  it('counts distinct keys, not rows (channel × day ≠ channels, ANA-20)', () => {
    const rows = [
      { date: 'd1', channel: 'Direct traffic' },
      { date: 'd2', channel: 'Direct traffic' },
      { date: 'd1', channel: 'Ad traffic' },
    ];
    expect(distinctCount(rows, (r) => r.channel)).toBe(2);
  });
});
