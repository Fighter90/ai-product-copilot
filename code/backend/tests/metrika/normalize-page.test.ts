import { describe, it, expect } from 'vitest';
import type { PageStat } from '@pca/shared';
import {
  normalizePageUrl,
  aggregatePages,
  isTildaVirtualEvent,
  TILDA_EVENTS_GROUP,
} from '../../src/metrika/queries/normalize-page';

const page = (over: Partial<PageStat>): PageStat => ({
  date: '2026-05-13',
  page: 'https://productcamp.ru/',
  visits: 100,
  users: 90,
  bounceRate: 0.2,
  goalReaches: 5,
  conversionRate: 0.05,
  ...over,
});

describe('normalizePageUrl', () => {
  it('strips a trailing slash and lowercases the host', () => {
    expect(normalizePageUrl('https://ProductCamp.RU/')).toBe('https://productcamp.ru/');
    expect(normalizePageUrl('https://productcamp.ru/lp/')).toBe('https://productcamp.ru/lp');
  });

  it('drops query string and fragment', () => {
    expect(normalizePageUrl('https://productcamp.ru/lp?utm=x#top')).toBe(
      'https://productcamp.ru/lp',
    );
  });

  it('returns non-URL values trimmed (e.g. the «(none)» bucket)', () => {
    expect(normalizePageUrl('  (none)  ')).toBe('(none)');
  });
});

describe('aggregatePages', () => {
  it('merges trailing-slash variants: sums visits, visit-weights bounce/CR (C-005)', () => {
    const out = aggregatePages([
      page({
        page: 'https://productcamp.ru/',
        visits: 300,
        bounceRate: 0.2,
        conversionRate: 0.06,
        goalReaches: 18,
      }),
      page({
        page: 'https://productcamp.ru',
        visits: 100,
        bounceRate: 0.6,
        conversionRate: 0.02,
        goalReaches: 2,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.page).toBe('https://productcamp.ru/');
    expect(out[0]!.visits).toBe(400);
    expect(out[0]!.goalReaches).toBe(20);
    // visit-weighted bounce: (0.2*300 + 0.6*100) / 400 = 0.3
    expect(out[0]!.bounceRate).toBeCloseTo(0.3, 5);
  });

  it('keeps distinct pages separate', () => {
    const out = aggregatePages([
      page({ page: 'https://productcamp.ru/a' }),
      page({ page: 'https://productcamp.ru/b' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('guards division by zero for a zero-visit page', () => {
    const out = aggregatePages([
      page({ page: '(none)', visits: 0, bounceRate: 0, conversionRate: 0 }),
    ]);
    expect(out[0]!.bounceRate).toBe(0);
    expect(out[0]!.conversionRate).toBe(0);
  });
});

// ANA-22 (appended): Tilda virtual pageviews are widget EVENTS, not landing pages — they must
// group into the single «/tilda/*» bucket instead of inflating entry/exit-page tables.
describe('Tilda virtual pageviews (ANA-22)', () => {
  it('detects /tilda/* virtual URLs (absolute and path-only), but not a real /tilda page', () => {
    expect(isTildaVirtualEvent('/tilda/popup/rec123/opened')).toBe(true);
    expect(isTildaVirtualEvent('/tilda/click/rec123')).toBe(true);
    expect(isTildaVirtualEvent('/tilda/form484/submit')).toBe(true);
    expect(isTildaVirtualEvent('/tilda/cart/add/product')).toBe(true);
    expect(isTildaVirtualEvent('https://productcamp.ru/tilda/form484/submit')).toBe(true);
    expect(isTildaVirtualEvent('https://productcamp.ru/page312425509.html')).toBe(false);
    expect(isTildaVirtualEvent('/tilda')).toBe(false); // a real page, not a virtual event
    expect(isTildaVirtualEvent('/')).toBe(false);
  });

  it('groups every /tilda/* virtual pageview into the single «/tilda/*» bucket', () => {
    expect(normalizePageUrl('/tilda/popup/rec1/opened')).toBe(TILDA_EVENTS_GROUP);
    expect(normalizePageUrl('https://productcamp.ru/tilda/form484/submit?utm_source=test')).toBe(
      TILDA_EVENTS_GROUP,
    );
    expect(TILDA_EVENTS_GROUP).toBe('/tilda/*');
  });

  it('merges Tilda event rows into one aggregated row (visits summed)', () => {
    const out = aggregatePages([
      page({ page: '/tilda/popup/rec1/opened', visits: 30 }),
      page({ page: 'https://productcamp.ru/tilda/click/rec1', visits: 12 }),
      page({ page: '/tickets', visits: 50 }),
    ]);
    expect(out.map((r) => r.page).sort()).toEqual(['/tickets', '/tilda/*']);
    expect(out.find((r) => r.page === TILDA_EVENTS_GROUP)?.visits).toBe(42);
  });
});
