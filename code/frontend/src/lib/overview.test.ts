import { describe, it, expect } from 'vitest';
import type { ChannelStat, B2bDeal, PageStat, UtmStat } from '@pca/shared';import {
  summarizeChannels,
  channelMixOption,
  dailyReachesOption,
  weakSpots,
  b2bDailyPoints,
  topPages,
  topUtmRows,} from './overview';

function stat(over: Partial<ChannelStat>): ChannelStat {
  return {
    date: '2025-01-01',
    channel: 'podcast',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    visits: 10,
    users: 9,
    bounceRate: 0.2,
    avgDuration: 60,
    goalReaches: 1,
    conversionRate: 0.1,
    ...over,
  };
}

describe('summarizeChannels', () => {
  it('application goal: paid = B2B paid only; gap = target - B2B paid (заявка ≠ оплата)', () => {
    const deals: B2bDeal[] = [
      { id: 1, company: 'A', tickets: 10, stage: 'paid', dateAdded: '2025-01-01' },
      { id: 2, company: 'B', tickets: 5, stage: 'lead', dateAdded: '2025-01-01' },
    ];
    const kpi = summarizeChannels([stat({ goalReaches: 5 }), stat({ goalReaches: 3 })], deals);
    // applications (8) are NOT payments → paid = 10, gap = 300 - 10.
    expect(kpi).toEqual({
      target: 300,
      applications: 8,
      b2bPaid: 10,
      b2cPaid: 0,
      paid: 10,
      gap: 290,
    });
  });

  it('defaults paid/gap to 0/300 when no payments are entered', () => {
    const kpi = summarizeChannels([stat({ goalReaches: 5 })], []);
    expect(kpi).toEqual({
      target: 300,
      applications: 5,
      b2bPaid: 0,
      b2cPaid: 0,
      paid: 0,
      gap: 300,
    });
  });

  it('uses the admin KPI target when passed (target + gap follow it)', () => {
    const kpi = summarizeChannels([stat({ goalReaches: 5 })], [], true, 120);
    expect(kpi).toEqual({
      target: 120,
      applications: 5,
      b2bPaid: 0,
      b2cPaid: 0,
      paid: 0,
      gap: 120,
    });
  });

  it('ANA-19: goal reaches NEVER count as payments, even for a purchase goal', () => {
    // A purchase goal's reaches are ORDERS (контакты оставлены, переход к оплате) — «Оплачено»
    // counts confirmed money only.
    const kpi = summarizeChannels([stat({ goalReaches: 52 })], [], true);
    expect(kpi).toEqual({
      target: 300,
      applications: 52,
      b2bPaid: 0,
      b2cPaid: 0,
      paid: 0,
      gap: 300,
    });
  });

  it('ANA-19: «Оплачено» = B2C paid (manual/CSV) + B2B paid; gap clamps at 0', () => {
    const deals: B2bDeal[] = [
      { id: 1, company: 'A', tickets: 280, stage: 'paid', dateAdded: '2025-01-01' },
    ];
    const kpi = summarizeChannels([stat({ goalReaches: 50 })], deals, true, 300, 40);
    // paid = 40 (B2C) + 280 (B2B) = 320 > 300 → gap clamped to 0; reaches (50) excluded.
    expect(kpi).toEqual({
      target: 300,
      applications: 50,
      b2bPaid: 280,
      b2cPaid: 40,
      paid: 320,
      gap: 0,
    });
  });
});

describe('weakSpots', () => {
  it('flags channels with traffic but below-overall conversion, sorted by visits desc', () => {
    // overall CR = (1+1+9) / (100+50+10) = 11/160 ≈ 0.069.
    // podcast CR 0.01 (<overall, high traffic), direct CR 0.02 (<overall), vip CR 0.9 (>overall).
    const spots = weakSpots([
      stat({ channel: 'podcast', visits: 100, goalReaches: 1 }),
      stat({ channel: 'direct', visits: 50, goalReaches: 1 }),
      stat({ channel: 'vip', visits: 10, goalReaches: 9 }),
      stat({ channel: 'empty', visits: 0, goalReaches: 0 }), // zero visits → CR 0, excluded
    ]);
    expect(spots.map((s) => s.channel)).toEqual(['podcast', 'direct']);
    expect(spots[0]?.conversionRate).toBeCloseTo(0.01);
  });

  it('returns an empty list when there is no data (no divide-by-zero)', () => {
    expect(weakSpots([])).toEqual([]);
  });
});

describe('channelMixOption', () => {
  it('aggregates visits by channel (incl. repeated channel)', () => {
    const o = channelMixOption([
      stat({ channel: 'podcast', visits: 10 }),
      stat({ channel: 'podcast', visits: 5 }),
      stat({ channel: 'direct', visits: 2 }),
    ]) as { series: { data: { name: string; value: number }[] }[] };
    const byName = new Map(o.series[0]?.data.map((d) => [d.name, d.value]));
    expect(byName.get('podcast')).toBe(15);
    expect(byName.get('direct')).toBe(2);
  });

  it('includes a legend with channel names', () => {
    const o = channelMixOption([
      stat({ channel: 'podcast', visits: 10 }),
      stat({ channel: 'direct', visits: 2 }),
    ]) as { legend: { data: string[] } };
    expect(o.legend.data).toContain('podcast');
    expect(o.legend.data).toContain('direct');
  });
});

describe('dailyReachesOption', () => {
  it('aggregates reaches by date, sorted (incl. repeated date)', () => {
    const o = dailyReachesOption([
      stat({ date: '2025-01-02', goalReaches: 2 }),
      stat({ date: '2025-01-01', goalReaches: 1 }),
      stat({ date: '2025-01-01', goalReaches: 3 }),
    ]) as { xAxis: { data: string[] }; series: { data: number[] }[] };
    expect(o.xAxis.data).toEqual(['2025-01-01', '2025-01-02']);
    expect(o.series[0]?.data).toEqual([4, 2]);
  });
});

describe('b2bDailyPoints (БАГ-11)', () => {
  it('collapses paid deals by payment date (tickets = reaches), sorted; ignores unpaid', () => {
    const deals: B2bDeal[] = [
      {
        id: 1,
        company: 'A',
        tickets: 10,
        stage: 'paid',
        dateAdded: '2025-01-01',
        datePaid: '2025-01-03',
      },
      { id: 2, company: 'B', tickets: 5, stage: 'lead', dateAdded: '2025-01-02' },
      {
        id: 3,
        company: 'C',
        tickets: 2,
        stage: 'paid',
        dateAdded: '2025-01-01',
        datePaid: '2025-01-03',
      },
      {
        id: 4,
        company: 'D',
        tickets: 4,
        stage: 'paid',
        dateAdded: '2025-01-01',
        datePaid: '2025-01-02',
      },
    ];
    expect(b2bDailyPoints(deals)).toEqual([
      { date: '2025-01-02', visits: 0, reaches: 4 },
      { date: '2025-01-03', visits: 0, reaches: 12 },
    ]);
  });

  it('a paid deal without datePaid falls back to dateAdded; empty input → empty series', () => {
    expect(
      b2bDailyPoints([{ id: 1, company: 'A', tickets: 7, stage: 'paid', dateAdded: '2025-01-05' }]),
    ).toEqual([{ date: '2025-01-05', visits: 0, reaches: 7 }]);
    expect(b2bDailyPoints([])).toEqual([]);
  });
});

describe('topPages (БАГ-07 — дубли топа страниц)', () => {
  const page = (over: Partial<PageStat>): PageStat => ({
    date: '2025-01-01',
    page: '/',
    visits: 10,
    users: 9,
    bounceRate: 0.2,
    goalReaches: 1,
    conversionRate: 0.1,
    ...over,
  });

  it('collapses «/» with different query strings into one summed row (Обзор: 5 строк «/»)', () => {
    const out = topPages([
      page({ date: '2025-01-01', visits: 20, goalReaches: 2 }),
      page({ date: '2025-01-02', page: '/?utm_source=tg', visits: 18, goalReaches: 1 }),
      page({ date: '2025-01-03', page: '/#top', visits: 12, goalReaches: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ page: '/', visits: 50, users: 27, goalReaches: 4 });
    // CR is recomputed from sums, bounce is visit-weighted.
    expect(out[0]!.conversionRate).toBeCloseTo(4 / 50);
    expect(out[0]!.bounceRate).toBeCloseTo((20 * 0.2 + 18 * 0.2 + 12 * 0.2) / 50);
  });

  it('unifies the trailing slash and sorts by summed visits desc, cutting to top N', () => {
    const out = topPages(
      [
        page({ page: '/b2b/', visits: 5 }),
        page({ page: '/b2b', visits: 7 }),
        page({ page: '/lp', visits: 30 }),
        page({ page: '/rare', visits: 1 }),
      ],
      2,
    );
    expect(out.map((p) => [p.page, p.visits])).toEqual([
      ['/lp', 30],
      ['/b2b', 12],
    ]);
  });

  it('keeps pages distinct when only the path differs', () => {
    const out = topPages([page({ page: '/a', visits: 3 }), page({ page: '/b', visits: 4 })]);
    expect(out).toHaveLength(2);
  });
});

describe('topUtmRows (БАГ-07 — дубли UTM-разбивки)', () => {
  const utm = (over: Partial<UtmStat>): UtmStat => ({
    date: '2025-01-01',
    utmSource: 'tg',
    utmMedium: 'post',
    utmCampaign: 'general',
    visits: 10,
    users: 9,
    goalReaches: 1,
    conversionRate: 0.1,
    ...over,
  });

  it('collapses «tg/post/general» 20+18 into one row of 38 (trim + lowercase)', () => {
    const out = topUtmRows([
      utm({ visits: 20, goalReaches: 3 }),
      utm({ utmSource: 'TG', utmMedium: ' Post ', visits: 18, goalReaches: 2 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      utmSource: 'tg',
      utmMedium: 'post',
      utmCampaign: 'general',
      visits: 38,
      goalReaches: 5,
    });
    expect(out[0]!.conversionRate).toBeCloseTo(5 / 38);
  });

  it('collapses «Id123450/referral/refProg» 81+16 into one row of 97', () => {
    const out = topUtmRows([
      utm({ utmSource: 'Id123450', utmMedium: 'referral', utmCampaign: 'refProg', visits: 81 }),
      utm({ utmSource: 'id123450', utmMedium: 'referral', utmCampaign: 'refprog', visits: 16 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      utmSource: 'id123450',
      utmMedium: 'referral',
      utmCampaign: 'refprog',
      visits: 97,
    });
  });

  it('keeps distinct triplets apart and cuts to top N by summed visits', () => {
    const out = topUtmRows(
      [
        utm({ utmCampaign: 'promo', visits: 40 }),
        utm({ utmCampaign: 'general', visits: 10 }),
        utm({ utmCampaign: 'general', visits: 8 }),
      ],
      1,
    );
    expect(out.map((u) => [u.utmCampaign, u.visits])).toEqual([['promo', 40]]);
  });
});
