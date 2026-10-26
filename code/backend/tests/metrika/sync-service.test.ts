import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DB } from '../../src/db/connection';
import { MetricsRepo } from '../../src/db/repositories/metrics-repo';
import { SyncService } from '../../src/metrika/sync-service';
import type { MetrikaClient } from '../../src/metrika/client';
import { freshDb } from '../db/helpers';

const goalsFixture = {
  goals: [
    { id: 80, name: 'payment', type: 'action' },
    { id: 10, name: 'old', type: 'action' },
  ],
};
const statFixture = {
  data: [{ dimensions: [{ name: 'podcast' }], metrics: [100, 90, 0.2, 65] }],
};
// bytime shape: data[0].metrics[i] = per-day values of metric i (one series per goal metric).
const bytimeFixture = {
  data: [
    {
      dimensions: [],
      metrics: [
        [1, 1, 1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0, 0, 0],
      ],
    },
  ],
};

function fakeClient(): MetrikaClient {
  return {
    get: vi.fn(async (path: string) =>
      path.includes('/goals')
        ? goalsFixture
        : path.includes('bytime')
          ? bytimeFixture
          : statFixture,
    ),
  } as unknown as MetrikaClient;
}

let db: DB;
let metrics: MetricsRepo;
let svc: SyncService;

beforeEach(() => {
  db = freshDb();
  metrics = new MetricsRepo(db);
  svc = new SyncService({
    client: fakeClient(),
    metrics,
    counterId: 12345678,
    archivedThreshold: 77,
    now: () => '2025-01-20T00:00:00.000Z',
  });
});
afterEach(() => db.close());

describe('SyncService.syncGoals', () => {
  it('upserts goals and flags those below the archive threshold', async () => {
    const goals = await svc.syncGoals();
    expect(goals.map((g) => g.id)).toEqual([80, 10]); // returned in API order, pre-archive-filter
    expect(metrics.listGoals().map((g) => g.id)).toEqual([80]); // 10 is archived (< 77)
    expect(metrics.listGoals(true).map((g) => g.id)).toEqual([10, 80]);
  });

  it('trusts Metrika’s own archived flag / status over the id-threshold fallback (ANA-23)', async () => {
    // Real counter shape: all ids are huge (≥ 173M), so the id<77 fallback flags nothing —
    // the archive state must come from the API fields. Only the third goal lacks both fields
    // and falls back to the threshold (id 50 < 77 → archived).
    const client = {
      get: vi.fn(async (path: string) =>
        path.includes('/goals')
          ? {
              goals: [
                { id: 173370304, name: 'live', type: 'action', status: 'Active' },
                { id: 266434954, name: 'old', type: 'action', archived: true },
                { id: 324257087, name: 'off', type: 'action', status: 'Archived' },
                { id: 50, name: 'legacy', type: 'action' },
              ],
            }
          : statFixture,
      ),
    } as unknown as MetrikaClient;
    const svc2 = new SyncService({
      client,
      metrics,
      counterId: 1,
      archivedThreshold: 77,
      now: () => 'T',
    });
    await svc2.syncGoals();
    expect(metrics.listGoals().map((g) => g.id)).toEqual([173370304]); // only the active goal
    expect(metrics.listGoals(true).map((g) => g.id)).toEqual([50, 173370304, 266434954, 324257087]);
  });
});

describe('SyncService.syncTraffic', () => {
  it('fetches a single chunk for a short range and caches raw + channel stats', async () => {
    const { days, rows } = await svc.syncTraffic('2025-01-01', '2025-01-03');
    expect(days).toBe(1);
    expect(rows).toBe(1);
    expect(metrics.listChannelStats()).toHaveLength(1);
    expect(metrics.listChannelStats()[0]?.date).toBe('2025-01-01');
  });

  it('splits a long range into per-day chunks', async () => {
    const { days, rows } = await svc.syncTraffic('2025-01-01', '2025-01-15');
    expect(days).toBe(15);
    expect(rows).toBe(15);
    expect(metrics.listChannelStats()).toHaveLength(15);
  });
});

describe('SyncService.syncUtm', () => {
  it('caches raw + UTM stats per day chunk', async () => {
    const { rows } = await svc.syncUtm('2025-01-01', '2025-01-03', 80);
    expect(rows).toBe(1);
    const utm = metrics.listUtmStats();
    expect(utm).toHaveLength(1);
    expect(utm[0]?.date).toBe('2025-01-01');
    expect(utm[0]?.utmSource).toBe('podcast');
    // The single-dimension fixture leaves medium/campaign missing → normalised to (none).
    expect(utm[0]?.utmMedium).toBe('(none)');
    expect(utm[0]?.utmCampaign).toBe('(none)');
  });

  it('sends the shared test-traffic filter and folds duplicate API rows before the upsert (ANA-16, ANA-22)', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      get: vi.fn(async (_path: string, params?: Record<string, unknown>) => {
        calls.push(params ?? {});
        return {
          data: [
            // Same (source, medium, campaign) twice — the upsert must see ONE summed row.
            {
              dimensions: [{ name: 'vk' }, { name: 'cpc' }, { name: 'spring' }],
              metrics: [10, 8, 1, 0.1],
            },
            {
              dimensions: [{ name: 'vk' }, { name: 'cpc' }, { name: 'spring' }],
              metrics: [30, 22, 5, 0.125],
            },
          ],
        };
      }),
    } as unknown as MetrikaClient;
    const svc2 = new SyncService({
      client,
      metrics,
      counterId: 1,
      archivedThreshold: 77,
      now: () => 'T',
    });
    const { rows } = await svc2.syncUtm('2025-01-01', '2025-01-01', 80);
    expect(rows).toBe(1);
    expect(calls[0]?.['filters']).toBe("ym:s:isRobot!='yes' AND ym:s:startURL!~'^file:'");
    const utm = metrics.listUtmStats();
    expect(utm).toHaveLength(1);
    expect(utm[0]).toMatchObject({
      utmSource: 'vk',
      utmMedium: 'cpc',
      utmCampaign: 'spring',
      visits: 40,
      users: 30,
      goalReaches: 6,
      conversionRate: 0.15,
    });
  });
});

describe('SyncService.syncGeoDevice', () => {
  it('caches raw + geo/device stats per day chunk', async () => {
    const { rows } = await svc.syncGeoDevice('2025-01-01', '2025-01-03', 80);
    expect(rows).toBe(1);
    const geo = metrics.listGeoDeviceStats();
    expect(geo).toHaveLength(1);
    expect(geo[0]?.date).toBe('2025-01-01');
    expect(geo[0]?.country).toBe('podcast'); // single-dimension fixture → country = first dim
    expect(geo[0]?.device).toBe('(none)'); // second dim missing → normalised
  });
});

describe('SyncService.syncPages', () => {
  it('caches raw + page stats per day chunk', async () => {
    const { rows } = await svc.syncPages('2025-01-01', '2025-01-03', 80);
    expect(rows).toBe(1);
    const pages = metrics.listPageStats();
    expect(pages).toHaveLength(1);
    expect(pages[0]?.date).toBe('2025-01-01');
    expect(pages[0]?.page).toBe('podcast'); // single-dimension fixture → page = first dim
  });
});

describe('SyncService.syncExitPages', () => {
  it('caches raw + exit-page stats per day chunk', async () => {
    const { rows } = await svc.syncExitPages('2025-01-01', '2025-01-03', 80);
    expect(rows).toBe(1);
    const pages = metrics.listExitPageStats();
    expect(pages).toHaveLength(1);
    expect(pages[0]?.date).toBe('2025-01-01');
    expect(pages[0]?.page).toBe('podcast'); // single-dimension fixture → page = first dim
  });
});

describe('SyncService.syncAll', () => {
  it('returns a combined summary including UTM + geo/device + page + exit-page + new slices', async () => {
    const summary = await svc.syncAll('2025-01-01', '2025-01-07', 80);
    expect(summary).toEqual({
      goals: 2,
      resolvedGoalId: 80, // explicit goalId passed through
      days: 1,
      channelRows: 1,
      utmRows: 1,
      geoDeviceRows: 1,
      pageRows: 1,
      exitPageRows: 1,
      // bytime: both goals' series × 7 days (fixture carries 2 series of 7 daily values).
      goalReachesRows: 14,
      browserOsRows: 1,
      newReturningRows: 1,
    });
  });

  it('auto-detects the primary KPI goal when no goalId is passed', async () => {
    // The goals fixture has a purchase-looking goal (id 80 «Оплата») → selected automatically.
    const summary = await svc.syncAll('2025-01-01', '2025-01-07');
    expect(summary.resolvedGoalId).toBe(80);
  });

  it('skips a breakdown whose query the API rejects, still completing the rest', async () => {
    const client = {
      get: vi.fn(async (path: string, params?: { dimensions?: string }) => {
        if (path.includes('/goals')) return goalsFixture;
        if (params?.dimensions?.includes('UTMSource')) {
          throw new Error('Metrika 400: invalid attribute ym:s:UTMSource');
        }
        return statFixture;
      }),
    } as unknown as MetrikaClient;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc2 = new SyncService({
      client,
      metrics,
      counterId: 1,
      archivedThreshold: 77,
      now: () => 'T',
    });

    const summary = await svc2.syncAll('2025-01-01', '2025-01-03', 80);
    expect(summary.utmRows).toBe(0); // skipped
    expect(summary.channelRows).toBe(1); // rest still synced
    expect(summary.exitPageRows).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('utm skipped'));
    warn.mockRestore();
  });

  it('resets synced data on each run but preserves user-entered B2B deals', async () => {
    db.prepare(
      `INSERT INTO b2b_manual (company, tickets, stage, date_added)
       VALUES ('Acme', 5, 'paid', '2025-01-01')`,
    ).run();
    await svc.syncAll('2025-01-01', '2025-01-07', 80);
    await svc.syncAll('2025-01-01', '2025-01-07', 80);
    // Two runs over the same range → no duplicate rows (reset+reload each time).
    expect(metrics.listChannelStats()).toHaveLength(1);
    expect(metrics.listGoals(true)).toHaveLength(2);
    // User-entered B2B data survives the reset.
    expect((db.prepare('SELECT COUNT(*) AS n FROM b2b_manual').get() as { n: number }).n).toBe(1);
  });

  it('aborts without wiping existing data when the goals call fails (e.g. expired token)', async () => {
    // Seed a prior successful sync.
    await svc.syncAll('2025-01-01', '2025-01-07', 80);
    expect(metrics.listChannelStats().length).toBeGreaterThan(0);
    expect(metrics.listGoals(true).length).toBeGreaterThan(0);

    // Next sync's auth fails on the (first) goals call.
    const failing = {
      get: vi.fn(async (path: string) => {
        if (path.includes('/goals')) throw new Error('Metrika 401: token expired');
        return statFixture;
      }),
    } as unknown as MetrikaClient;
    const svc2 = new SyncService({
      client: failing,
      metrics,
      counterId: 1,
      archivedThreshold: 77,
      now: () => 'T',
    });

    await expect(svc2.syncAll('2025-01-01', '2025-01-07', 80)).rejects.toThrow('token expired');
    // Existing dataset is untouched — reset only runs after the goals call succeeds.
    expect(metrics.listChannelStats().length).toBeGreaterThan(0);
    expect(metrics.listGoals(true).length).toBeGreaterThan(0);
  });
});
