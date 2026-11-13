import { describe, it, expect } from 'vitest';
import { ENDPOINTS } from '../../src/metrika/endpoints';
import { recoverHistoryFromRaw, detectReport } from '../../src/metrika/recovery';
import { MetricsRepo } from '../../src/db/repositories/metrics-repo';
import { stableHash } from '../../src/utils/hash';
import { UTM_NONE } from '@pca/shared';
import { freshDb } from '../db/helpers';

/**
 * ANA-150 round-trip fixtures: Metrika Stat API responses shaped like the chunks the sync stored
 * in raw_responses before the counter reset — `query.dimensions` echoes the report identity.
 * Numbers are the real-order-of-magnitude values from the 2025-05-01 chunk (Direct = 53 visits).
 */

const TRAFFIC_METRICS = [
  'ym:s:visits',
  'ym:s:users',
  'ym:s:bounceRate',
  'ym:s:avgVisitDurationSeconds',
];

interface StatQuery {
  readonly dimensions: readonly string[];
  readonly metrics: readonly string[];
  readonly date1?: string;
  readonly date2?: string;
}

function statQuery(dimensions: readonly string[], metrics: readonly string[]): StatQuery {
  return { dimensions, metrics };
}

/** Per-day channels chunk (the 365-day backfill shape): no ym:s:date dimension. */
function channelPayload(day: string, directVisits: number, goalId?: number): unknown {
  const adVisits = Math.max(directVisits - 10, 0);
  const metrics = goalId
    ? [...TRAFFIC_METRICS, `ym:s:goal${goalId}reaches`, `ym:s:goal${goalId}conversionRate`]
    : TRAFFIC_METRICS;
  const rowMetrics = goalId
    ? [directVisits, directVisits - 5, 21.4, 92, 3, 5.6]
    : [directVisits, directVisits - 5, 21.4, 92];
  return {
    data: [
      { dimensions: [{ name: 'Прямые заходы' }], metrics: rowMetrics },
      {
        dimensions: [{ name: 'Переходы по ссылкам на сайтах' }],
        metrics: [adVisits, adVisits - 2, 33, 61],
      },
    ],
    query: { ...statQuery(['ym:s:lastsignTrafficSource'], metrics), date1: day, date2: day },
    total_rows: 2,
  };
}

/** Range channels chunk (the ≤31-day sync shape): rows carry ym:s:date as the first dimension. */
function channelPayloadRange(days: readonly string[], visits: readonly number[]): unknown {
  return {
    data: days.map((d, i) => ({
      dimensions: [{ name: d }, { name: 'Ad traffic' }],
      metrics: [visits[i], (visits[i] ?? 0) - 1, 10, 60],
    })),
    query: statQuery(['ym:s:date', 'ym:s:lastsignTrafficSource'], TRAFFIC_METRICS),
    total_rows: days.length,
  };
}

function utmPayload(day: string): unknown {
  return {
    data: [
      {
        dimensions: [{ name: 'ambassador' }, { name: 'cpc' }, { name: 'spring26' }],
        metrics: [17, 15],
      },
      { dimensions: [{ name: null }, { name: null }, { name: null }], metrics: [36, 30] },
    ],
    query: {
      ...statQuery(
        ['ym:s:lastsignUTMSource', 'ym:s:lastsignUTMMedium', 'ym:s:lastsignUTMCampaign'],
        ['ym:s:visits', 'ym:s:users'],
      ),
      date1: day,
      date2: day,
    },
    total_rows: 2,
  };
}

function geoPayload(day: string): unknown {
  return {
    data: [
      { dimensions: [{ name: 'Россия' }, { name: 'desktop' }], metrics: [40, 35] },
      { dimensions: [{ name: 'Германия' }, { name: 'mobile' }], metrics: [13, 12] },
    ],
    query: {
      ...statQuery(['ym:s:regionCountry', 'ym:s:deviceCategory'], ['ym:s:visits', 'ym:s:users']),
      date1: day,
      date2: day,
    },
    total_rows: 2,
  };
}

/** Entry pages: two URL variants of the same page + a Tilda virtual pageview (ANA-22 grouping). */
function pagesPayload(day: string): unknown {
  return {
    data: [
      { dimensions: [{ name: 'https://productcamp.ru/' }], metrics: [60, 50, 12.5] },
      { dimensions: [{ name: 'https://productcamp.ru' }], metrics: [15, 12, 20] },
      { dimensions: [{ name: 'https://productcamp.ru/tilda/popup/123' }], metrics: [7, 7, 0] },
    ],
    query: {
      ...statQuery(['ym:s:startURL'], ['ym:s:visits', 'ym:s:users', 'ym:s:bounceRate']),
      date1: day,
      date2: day,
    },
    total_rows: 3,
  };
}

function exitPagesPayload(day: string): unknown {
  return {
    data: [{ dimensions: [{ name: 'https://productcamp.ru/tickets' }], metrics: [25, 20, 8] }],
    query: {
      ...statQuery(['ym:s:endURL'], ['ym:s:visits', 'ym:s:users', 'ym:s:bounceRate']),
      date1: day,
      date2: day,
    },
    total_rows: 1,
  };
}

function browserOsPayload(): unknown {
  return {
    data: [{ dimensions: [{ name: 'Chrome' }, { name: 'Windows' }], metrics: [50, 45] }],
    query: statQuery(['ym:s:browser', 'ym:s:operatingSystem'], TRAFFIC_METRICS),
    total_rows: 1,
  };
}

function newReturningPayload(): unknown {
  return {
    data: [{ dimensions: [{ name: 'Новые' }], metrics: [30, 25] }],
    query: statQuery(['ym:s:isNewUser'], ['ym:s:visits', 'ym:s:users']),
    total_rows: 1,
  };
}

function goalByTimePayload(): unknown {
  return {
    data: [
      {
        dimensions: [],
        metrics: [
          [1, 2],
          [3, 4],
        ],
      },
    ],
    query: { metrics: ['ym:s:goal173reaches', 'ym:s:goal174reaches'], group: 'day' },
    total_rows: 1,
  };
}

/** A chunk whose `query` echo is missing — report identity cannot be proven from the payload. */
function opaquePayload(): unknown {
  return { data: [{ dimensions: [{ name: 'Direct' }], metrics: [53, 48] }] };
}

function seedRaw(
  metrics: MetricsRepo,
  day: string,
  kind: string,
  payload: unknown,
  endpoint: string = ENDPOINTS.statData,
): void {
  metrics.saveRawResponse({
    endpoint,
    queryHash: stableHash({ q: kind, day }),
    dateFrom: day,
    dateTo: day,
    payload,
    fetchedAt: '2026-11-03T12:00:00Z',
  });
}

function rawCount(metrics: MetricsRepo): number {
  const rows = metrics.iterateRawResponsesBetween('2000-01-01', '2999-12-31');
  return [...rows].length;
}

describe('detectReport', () => {
  it('identifies report kinds from the echoed query dimensions', () => {
    expect(detectReport(channelPayload('2025-05-01', 53))).toEqual({
      kind: 'channels',
      dateDimension: false,
    });
    expect(detectReport(utmPayload('2025-05-01'))).toEqual({ kind: 'utm', dateDimension: false });
    expect(detectReport(geoPayload('2025-05-01'))).toEqual({
      kind: 'geoDevice',
      dateDimension: false,
    });
    expect(detectReport(pagesPayload('2025-05-01'))).toEqual({
      kind: 'pages',
      dateDimension: false,
    });
    expect(detectReport(exitPagesPayload('2025-05-01'))).toEqual({
      kind: 'exitPages',
      dateDimension: false,
    });
    expect(detectReport(browserOsPayload())).toEqual({
      kind: 'browserOs',
      dateDimension: false,
    });
    expect(detectReport(newReturningPayload())).toEqual({
      kind: 'newReturning',
      dateDimension: false,
    });
  });

  it('detects the range variant and the goal from query metrics', () => {
    expect(detectReport(channelPayloadRange(['2026-10-20'], [9]))).toEqual({
      kind: 'channels',
      dateDimension: true,
      goalId: undefined,
    });
    const withGoal = channelPayload('2025-05-01', 53, 173);
    expect(detectReport(withGoal)).toEqual({ kind: 'channels', dateDimension: false, goalId: 173 });
  });

  it('classifies bytime goal-series chunks by endpoint and unidentifiable chunks as unknown', () => {
    expect(detectReport(goalByTimePayload(), ENDPOINTS.statByTime)).toEqual({
      kind: 'goalReaches',
      dateDimension: false,
    });
    expect(detectReport(opaquePayload())).toEqual({ kind: 'unknown', dateDimension: false });
  });

  it('never throws on null payloads or non-array query fields (defensive branches)', () => {
    // The stored payload column is parsed JSON, so the recovery loop can feed `detectReport`
    // arbitrary shapes: a null payload short-circuits the optional chain, and query fields that
    // are not arrays must degrade to "no dimensions / no goal" instead of crashing.
    expect(detectReport(null)).toEqual({ kind: 'unknown', dateDimension: false });
    expect(detectReport(undefined)).toEqual({ kind: 'unknown', dateDimension: false });
    expect(detectReport({ query: null })).toEqual({ kind: 'unknown', dateDimension: false });
    expect(
      detectReport({
        query: { dimensions: 'ym:s:lastsignTrafficSource', metrics: 'ym:s:visits' },
      }),
    ).toEqual({ kind: 'unknown', dateDimension: false });
  });
});

describe('recoverHistoryFromRaw', () => {
  it('round-trips the control week 2025-05-01..07: per-day visits match the payloads exactly', () => {
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    const week: Array<[string, number]> = [
      ['2025-05-01', 53],
      ['2025-05-02', 61],
      ['2025-05-03', 47],
      ['2025-05-04', 55],
      ['2025-05-05', 70],
      ['2025-05-06', 44],
      ['2025-05-07', 38],
    ];
    for (const [day, visits] of week) seedRaw(metrics, day, 'traffic', channelPayload(day, visits));
    const before = rawCount(metrics);

    const summary = recoverHistoryFromRaw(metrics, { from: '2025-04-29', to: '2026-11-05' });

    // Raw audit trail is read-only for the recovery.
    expect(rawCount(metrics)).toBe(before);
    expect(summary.scanned).toBe(7);
    expect(summary.skippedUnknown).toBe(0);
    // 2 channels per day, one channel_stats row per (date, channel).
    expect(summary.channelRows).toBe(14);
    const restored = metrics.listChannelStats();
    expect(restored).toHaveLength(14);
    for (const [day, visits] of week) {
      const direct = restored.find((r) => r.date === day && r.channel === 'Прямые заходы');
      expect(direct?.visits).toBe(visits);
      expect(direct?.users).toBe(visits - 5);
      expect(direct?.bounceRate).toBeCloseTo(0.214, 6);
      expect(direct?.avgDuration).toBe(92);
      expect(direct?.goalReaches).toBe(0);
      const ad = restored.find(
        (r) => r.date === day && r.channel === 'Переходы по ссылкам на сайтах',
      );
      expect(ad?.visits).toBe(visits - 10);
    }
    // Restored rows are real (is_demo = 0), not demo seeds.
    const dbRow = db
      .prepare('SELECT visits, is_demo FROM channel_stats WHERE date = ? AND channel = ?')
      .get('2025-05-01', 'Прямые заходы') as { visits: number; is_demo: number };
    expect(dbRow.visits).toBe(53);
    expect(dbRow.is_demo).toBe(0);
    db.close();
  });

  it('parses goal metrics when the stored query carries them', () => {
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    seedRaw(metrics, '2025-05-01', 'traffic', channelPayload('2025-05-01', 53, 173));

    recoverHistoryFromRaw(metrics, { from: '2025-05-01', to: '2025-05-01' });

    const row = metrics.listChannelStats()[0];
    expect(row?.goalReaches).toBe(3);
    expect(row?.conversionRate).toBeCloseTo(0.056, 6);
    db.close();
  });

  it('keeps the goal-bearing chunk when a goalless chunk for the same natural key is stored later', () => {
    // The goalless traffic chunk maps goalReaches: 0 / conversionRate: 0 — absence of the goal
    // metrics in ITS query, not a measured zero. With the raw id order deciding the merge a
    // later goalless chunk would silently erase the real goal data of the earlier goal-bearing
    // one; the goal-bearing row must win the natural-key collision regardless of storage order.
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    seedRaw(metrics, '2025-05-01', 'traffic-goal', channelPayload('2025-05-01', 60, 173));
    seedRaw(metrics, '2025-05-01', 'traffic-no-goal', channelPayload('2025-05-01', 53));

    recoverHistoryFromRaw(metrics, { from: '2025-05-01', to: '2025-05-01' });

    const rows = metrics.listChannelStats();
    expect(rows).toHaveLength(2);
    // The whole row stays the goal chunk's version (visits AND goal metrics from one real
    // payload) — no Frankenstein mix of two chunks for the same natural key.
    const direct = rows.find((r) => r.channel === 'Прямые заходы');
    expect(direct).toMatchObject({ date: '2025-05-01', visits: 60, users: 55, goalReaches: 3 });
    expect(direct?.conversionRate).toBeCloseTo(0.056, 6);
    const ad = rows.find((r) => r.channel === 'Переходы по ссылкам на сайтах');
    expect(ad?.visits).toBe(50);
    db.close();
  });

  it('restores range-mode chunks onto the dates carried by the ym:s:date dimension', () => {
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    metrics.saveRawResponse({
      endpoint: ENDPOINTS.statData,
      queryHash: stableHash({ q: 'traffic-range', window: '2026-10-13..26' }),
      dateFrom: '2026-10-13',
      dateTo: '2026-10-26',
      payload: channelPayloadRange(['2026-10-20', '2026-10-21'], [9, 12]),
      fetchedAt: '2026-10-27T00:00:00Z',
    });

    const summary = recoverHistoryFromRaw(metrics, { from: '2026-10-13', to: '2026-11-05' });

    expect(summary.channelRows).toBe(2);
    const rows = metrics.listChannelStats();
    expect(rows.map((r) => [r.date, r.channel, r.visits])).toEqual([
      ['2026-10-20', 'Ad traffic', 9],
      ['2026-10-21', 'Ad traffic', 12],
    ]);
    db.close();
  });

  it('restores utm, geo, entry and exit pages from their chunks (none-normalisation, URL merge, tilda bucket)', () => {
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    seedRaw(metrics, '2025-05-01', 'utm', utmPayload('2025-05-01'));
    seedRaw(metrics, '2025-05-01', 'geo', geoPayload('2025-05-01'));
    seedRaw(metrics, '2025-05-01', 'pages', pagesPayload('2025-05-01'));
    seedRaw(metrics, '2025-05-01', 'exit', exitPagesPayload('2025-05-01'));

    const summary = recoverHistoryFromRaw(metrics, { from: '2025-05-01', to: '2025-05-01' });

    expect(summary.utmRows).toBe(2);
    const utm = metrics.listUtmStats();
    const ambassador = utm.find((u) => u.utmSource === 'ambassador');
    expect(ambassador).toMatchObject({ utmMedium: 'cpc', utmCampaign: 'spring26', visits: 17 });
    // Null dimension values normalise to the same sentinel the sync uses.
    expect(utm.find((u) => u.utmSource === UTM_NONE)?.visits).toBe(36);

    expect(summary.geoDeviceRows).toBe(2);
    expect(metrics.listGeoDeviceStats()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ country: 'Россия', device: 'desktop', visits: 40 }),
        expect.objectContaining({ country: 'Германия', device: 'mobile', visits: 13 }),
      ]),
    );

    // URL variants collapse (trailing slash), Tilda virtual pageviews go to the /tilda/* bucket.
    expect(summary.pageRows).toBe(2);
    const pages = metrics.listPageStats();
    expect(pages.find((p) => p.page === 'https://productcamp.ru/')?.visits).toBe(75);
    expect(pages.find((p) => p.page === '/tilda/*')?.visits).toBe(7);

    expect(summary.exitPageRows).toBe(1);
    expect(metrics.listExitPageStats()[0]).toMatchObject({
      page: 'https://productcamp.ru/tickets',
      visits: 25,
    });
    db.close();
  });

  it('skips chunks without a derived stat table and unidentifiable chunks without throwing', () => {
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    seedRaw(metrics, '2025-05-01', 'browser-os', browserOsPayload());
    seedRaw(metrics, '2025-05-01', 'new-returning', newReturningPayload());
    seedRaw(metrics, '2025-05-01', 'goal-bytime', goalByTimePayload(), ENDPOINTS.statByTime);
    // Six chunks with no query echo + one chunk whose dimensions are recognisable but whose
    // payload fails the Stat API response schema (no data array) — all skipped, none crash.
    const opaqueDays = [
      '2025-05-01',
      '2025-05-02',
      '2025-05-03',
      '2025-05-04',
      '2025-05-05',
      '2025-05-06',
    ];
    for (const [i, day] of opaqueDays.entries()) {
      seedRaw(metrics, day, `opaque-${i}`, opaquePayload());
    }
    seedRaw(metrics, '2025-05-10', 'schema-broken', {
      query: statQuery(['ym:s:lastsignTrafficSource'], TRAFFIC_METRICS),
    });

    const summary = recoverHistoryFromRaw(metrics, { from: '2025-05-01', to: '2025-05-10' });

    expect(summary.scanned).toBe(10);
    expect(summary.skippedNoTable).toBe(3);
    expect(summary.skippedUnknown).toBe(7);
    expect(summary.unknownSamples).toHaveLength(5);
    expect(summary.channelRows).toBe(0);
    expect(metrics.listChannelStats()).toEqual([]);
    expect(metrics.listUtmStats()).toEqual([]);
    db.close();
  });

  it('is idempotent: a second run rewrites the same rows instead of doubling visits', () => {
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    seedRaw(metrics, '2025-05-01', 'traffic', channelPayload('2025-05-01', 53));
    seedRaw(metrics, '2025-05-02', 'traffic', channelPayload('2025-05-02', 61));

    const first = recoverHistoryFromRaw(metrics, { from: '2025-04-29', to: '2026-11-05' });
    const second = recoverHistoryFromRaw(metrics, { from: '2025-04-29', to: '2026-11-05' });

    expect(second).toEqual(first);
    const total = metrics.listChannelStats().reduce((sum, r) => sum + r.visits, 0);
    expect(total).toBe(53 + 43 + 61 + 51);
    db.close();
  });

  it('does not write when write:false (dry run)', () => {
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    seedRaw(metrics, '2025-05-01', 'traffic', channelPayload('2025-05-01', 53));

    const summary = recoverHistoryFromRaw(
      metrics,
      { from: '2025-05-01', to: '2025-05-01' },
      { write: false },
    );

    expect(summary.channelRows).toBe(2);
    expect(metrics.listChannelStats()).toEqual([]);
    db.close();
  });

  it('extends statsCoverage to the real history start (acceptance: coverage from=2025-04-29)', () => {
    const db = freshDb();
    const metrics = new MetricsRepo(db);
    seedRaw(metrics, '2025-04-29', 'traffic', channelPayload('2025-04-29', 30));
    seedRaw(metrics, '2026-11-05', 'traffic', channelPayload('2026-11-05', 33));

    recoverHistoryFromRaw(metrics, { from: '2025-04-29', to: '2026-11-05' });

    expect(metrics.statsCoverage()).toEqual({ from: '2025-04-29', to: '2026-11-05', days: 556 });
    db.close();
  });
});
