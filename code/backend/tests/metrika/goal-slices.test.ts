import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DB } from '../../src/db/connection';
import { MetricsRepo } from '../../src/db/repositories/metrics-repo';
import { SyncService } from '../../src/metrika/sync-service';
import type { MetrikaClient, QueryParams } from '../../src/metrika/client';
import {
  GOAL_METRICS_BATCH,
  batchGoalIds,
  daysBetween,
  goalReachMetrics,
  goalReachesByDay,
} from '../../src/metrika/queries/goal-reaches-by-day';
import { browserOsBreakdown } from '../../src/metrika/queries/browser-os-breakdown';
import { newReturningBreakdown } from '../../src/metrika/queries/new-returning';
import { freshDb } from '../db/helpers';

const goalsFixture = { goals: [{ id: 80, name: 'payment', type: 'action' }] };
const statFixture = {
  data: [{ dimensions: [{ name: 'podcast' }], metrics: [100, 90, 0.2, 65] }],
};
// ANA-113: range-ответ (ym:s:date первой размерностью) для окон ≤ 31 день; responder отдаёт
// только дни внутри запрошенного окна — как настоящая Метрика.
const statRangeFixture = {
  data: Array.from({ length: 3 }, (_, i) => ({
    dimensions: [{ name: `2025-01-0${i + 1}` }, { name: 'podcast' }],
    metrics: [100, 90, 0.2, 65],
  })),
};

function statResponder(
  _path: string,
  params?: { date1?: string; date2?: string; dimensions?: string },
) {
  if (String(params?.dimensions ?? '').startsWith('ym:s:date')) {
    const from = params?.date1 ?? '';
    const to = params?.date2 ?? '';
    return {
      data: statRangeFixture.data.filter((r) => {
        const d = String(r.dimensions[0]?.name ?? '');
        return d >= from && d <= to;
      }),
    };
  }
  return statFixture;
}
// bytime shape: data[0].metrics[i] = per-day values of metric i.
const bytimeFixture = {
  data: [
    {
      dimensions: [],
      metrics: [
        [2, 0, 1],
        [5, 1, 3],
      ],
    },
  ],
};

/** Client double that records GET params per endpoint family. */
function fakeClient() {
  const calls: Array<{ path: string; params: QueryParams }> = [];
  const get = vi.fn(async (path: string, params: QueryParams) => {
    calls.push({ path, params });
    if (path.includes('/goals')) return goalsFixture;
    if (path.includes('bytime')) return bytimeFixture;
    return statResponder(path, params);
  });
  return { client: { get } as unknown as MetrikaClient, calls };
}

describe('batchGoalIds / goalReachMetrics', () => {
  it('splits ids into batches of the Metrika metric cap (10)', () => {
    expect(GOAL_METRICS_BATCH).toBe(10);
    expect(batchGoalIds([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(batchGoalIds(Array.from({ length: 25 }, (_, i) => i + 1))).toEqual([
      Array.from({ length: 10 }, (_, i) => i + 1),
      Array.from({ length: 10 }, (_, i) => i + 11),
      [21, 22, 23, 24, 25],
    ]);
    expect(batchGoalIds([])).toEqual([]);
  });

  it('builds ym:s:goal{id}reaches metric names', () => {
    expect(goalReachMetrics([80, 90])).toBe('ym:s:goal80reaches,ym:s:goal90reaches');
  });

  it('expands an inclusive day range', () => {
    expect(daysBetween('2025-01-30', '2025-02-01')).toEqual([
      '2025-01-30',
      '2025-01-31',
      '2025-02-01',
    ]);
  });
});

describe('goalReachesByDay', () => {
  it('requests group=day over the whole range and unrolls the nested series into (date, goal) rows', async () => {
    const { client, calls } = fakeClient();
    const { raw, rows } = await goalReachesByDay(client, {
      counterId: 1,
      from: '2025-01-01',
      to: '2025-01-03',
      goalIds: [80, 90],
    });
    expect(calls[0]?.path).toBe('/stat/v1/data/bytime');
    expect(calls[0]?.params).toMatchObject({
      ids: 1,
      metrics: 'ym:s:goal80reaches,ym:s:goal90reaches',
      group: 'day',
      date1: '2025-01-01',
      date2: '2025-01-03',
    });
    expect(raw).toBe(bytimeFixture);
    expect(rows).toEqual([
      { date: '2025-01-01', goalId: 80, reaches: 2 },
      { date: '2025-01-02', goalId: 80, reaches: 0 },
      { date: '2025-01-03', goalId: 80, reaches: 1 },
      { date: '2025-01-01', goalId: 90, reaches: 5 },
      { date: '2025-01-02', goalId: 90, reaches: 1 },
      { date: '2025-01-03', goalId: 90, reaches: 3 },
    ]);
  });

  it('validates with a schema that accepts the real nested bytime metrics (prod sync bug)', async () => {
    const { client } = fakeClient();
    await goalReachesByDay(client, {
      counterId: 1,
      from: '2025-01-01',
      to: '2025-01-03',
      goalIds: [80, 90],
    });
    const get = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
    const schema = get.mock.calls[0]?.[2] as { safeParse: (v: unknown) => { success: boolean } };
    // Live response captured from Metrika: metrics[i] is the per-day series of metric i.
    const live = {
      data: [
        {
          dimensions: [],
          metrics: [
            [0.0, 2.0, 0.0],
            [24.0, 32.0, 5.0],
          ],
        },
      ],
      totals: [
        [0.0, 2.0, 0.0],
        [24.0, 32.0, 5.0],
      ],
    };
    expect(schema.safeParse(live).success).toBe(true);
    expect(schema.safeParse(bytimeFixture).success).toBe(true);
  });

  it('returns no rows for an empty data response', async () => {
    const client = {
      get: vi.fn(async () => ({ data: [] })),
    } as unknown as MetrikaClient;
    const { rows } = await goalReachesByDay(client, {
      counterId: 1,
      from: '2025-01-01',
      to: '2025-01-01',
      goalIds: [80],
    });
    expect(rows).toEqual([]);
  });
});

describe('browserOsBreakdown', () => {
  it('groups by browser + operatingSystem and maps missing OS to (none)', async () => {
    const { client, calls } = fakeClient();
    const { stats } = await browserOsBreakdown(client, {
      counterId: 1,
      from: '2025-01-01',
      to: '2025-01-01',
      goalId: 80,
    });
    expect(calls[0]?.params).toMatchObject({
      dimensions: 'ym:s:browser,ym:s:operatingSystem',
      metrics: 'ym:s:visits,ym:s:users,ym:s:goal80reaches,ym:s:goal80conversionRate',
    });
    // statFixture has a single dimension row → browser = 'podcast', OS missing.
    expect(stats[0]).toEqual({
      date: '2025-01-01',
      browser: 'podcast',
      os: '(none)',
      visits: 100,
      users: 90,
      goalReaches: 0.2,
      conversionRate: 0.65, // ratio() normalises the API's percent (65) to a share
    });
  });
});

describe('newReturningBreakdown', () => {
  it('uses the ym:s:isNewUser dimension', async () => {
    const { client, calls } = fakeClient();
    const { stats } = await newReturningBreakdown(client, {
      counterId: 1,
      from: '2025-01-01',
      to: '2025-01-01',
    });
    expect(calls[0]?.params).toMatchObject({
      dimensions: 'ym:s:isNewUser',
      metrics: 'ym:s:visits,ym:s:users',
    });
    expect(stats[0]?.segment).toBe('podcast');
    expect(stats[0]?.visits).toBe(100);
  });
});

describe('SyncService new slices', () => {
  let db: DB;
  let metrics: MetricsRepo;
  let svc: SyncService;
  let calls: Array<{ path: string; params: QueryParams }>;

  beforeEach(() => {
    db = freshDb();
    metrics = new MetricsRepo(db);
    const fake = fakeClient();
    calls = fake.calls;
    svc = new SyncService({
      client: fake.client,
      metrics,
      counterId: 12345678,
      archivedThreshold: 77,
      now: () => '2025-01-20T00:00:00.000Z',
    });
  });
  afterEach(() => db.close());

  it('syncGoalReachesByDay caches one raw bytime response per batch and returns row counts', async () => {
    const goalIds = Array.from({ length: 12 }, (_, i) => i + 1);
    const { batches, rows } = await svc.syncGoalReachesByDay('2025-01-01', '2025-01-03', goalIds);
    expect(batches).toBe(2); // 12 goals → batches of 10 + 2
    // Each batch's fixture carries 2 metric series × 3 days → 6 (date, goal) pairs per batch.
    expect(rows).toBe(12);
    expect(calls.filter((c) => c.path.includes('bytime')).length).toBe(2);
  });

  it('syncAll runs the new slices best-effort and reports their row counts', async () => {
    const summary = await svc.syncAll('2025-01-01', '2025-01-03', 80);
    expect(summary).toEqual({
      goals: 1,
      resolvedGoalId: 80,
      days: 3, // window length (small breakdowns go as ONE range request, ANA-113)
      channelRows: 3,
      utmRows: 3,
      geoDeviceRows: 3,
      pageRows: 3,
      exitPageRows: 3,
      // goals fixture has 1 goal → one bytime batch; the fixture's first series carries 3 daily
      // values → 3 (date, goal) pairs (extra fixture series beyond the batch are ignored).
      goalReachesRows: 3,
      browserOsRows: 3,
      newReturningRows: 3,
      // ANA-153 zero-protection: the fixtures carry real visits, nothing gets skipped.
      skippedZero: 0,
      errors: [], // ANA-15: every slice passed
    });
  });

  it('skips a failing new slice without aborting the rest', async () => {
    const failing = {
      get: vi.fn(
        async (path: string, params?: { date1?: string; date2?: string; dimensions?: string }) => {
          if (path.includes('/goals')) return goalsFixture;
          if (path.includes('bytime')) throw new Error('Metrika 400: invalid metric');
          return statResponder(path, params);
        },
      ),
    } as unknown as MetrikaClient;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc2 = new SyncService({
      client: failing,
      metrics,
      counterId: 1,
      archivedThreshold: 77,
      now: () => 'T',
    });
    const summary = await svc2.syncAll('2025-01-01', '2025-01-03', 80);
    expect(summary.goalReachesRows).toBe(0);
    expect(summary.channelRows).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('goal-reaches-by-day skipped'));
    warn.mockRestore();
  });
});
