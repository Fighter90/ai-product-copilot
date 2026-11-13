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
// ANA-113: range-ответ (dimensions начинаются с ym:s:date) — те же данные с датой первой
// размерностью; responder отдаёт только строки внутри запрошенного окна (как настоящая Метрика).
const statRangeFixture = {
  data: Array.from({ length: 7 }, (_, i) => ({
    dimensions: [{ name: `2025-01-0${i + 1}` }, { name: 'podcast' }],
    metrics: [100, 90, 0.2, 65],
  })),
};

function statResponder() {
  return (_path: string, params?: Record<string, unknown>) => {
    const dims = String(params?.['dimensions'] ?? '');
    if (dims.startsWith('ym:s:date')) {
      const from = String(params?.['date1'] ?? '');
      const to = String(params?.['date2'] ?? '');
      return {
        data: statRangeFixture.data.filter((r) => {
          const d = String(r.dimensions[0]?.name ?? '');
          return d >= from && d <= to;
        }),
      };
    }
    return statFixture;
  };
}
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
    get: vi.fn(async (path: string, params?: Record<string, unknown>) =>
      path.includes('/goals')
        ? goalsFixture
        : path.includes('bytime')
          ? bytimeFixture
          : statResponder()(path, params),
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
  it('one range request for a short window — every day still lands on its own date (ANA-113; keeps the ANA-65 №7 invariant)', async () => {
    const { days, rows } = await svc.syncTraffic('2025-01-01', '2025-01-03');
    expect(days).toBe(3);
    expect(rows).toBe(3);
    const dates = metrics
      .listChannelStats()
      .map((r) => r.date)
      .sort();
    expect(dates).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
  });

  it('splits a wide range (>31 days) into per-day chunks — the range row-cap fallback', async () => {
    const { days, rows } = await svc.syncTraffic('2025-01-01', '2025-02-01');
    expect(days).toBe(32);
    expect(rows).toBe(32);
    expect(metrics.listChannelStats()).toHaveLength(32);
  });
});

describe('SyncService.syncUtm', () => {
  it('caches raw + UTM stats per day chunk', async () => {
    const { rows } = await svc.syncUtm('2025-01-01', '2025-01-03', 80);
    expect(rows).toBe(3);
    const utm = metrics.listUtmStats();
    expect(utm).toHaveLength(3);
    expect(utm.map((r) => r.date).sort()).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
    expect(utm[0]?.utmSource).toBe('podcast');
    // The single-dimension fixture leaves medium/campaign missing → normalised to (none).
    expect(utm[0]?.utmMedium).toBe('(none)');
    expect(utm[0]?.utmCampaign).toBe('(none)');
    expect(utm.every((r) => r.utmSource === 'podcast')).toBe(true);
  });

  it('sends the shared test-traffic filter and folds duplicate API rows before the upsert (ANA-16, ANA-22)', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      get: vi.fn(async (_path: string, params?: Record<string, unknown>) => {
        calls.push(params ?? {});
        return {
          data: [
            // Same (source, medium, campaign) twice — the upsert must see ONE summed row.
            // ANA-113: 1-day window still goes through the range variant (ym:s:date first).
            {
              dimensions: [
                { name: '2025-01-01' },
                { name: 'vk' },
                { name: 'cpc' },
                { name: 'spring' },
              ],
              metrics: [10, 8, 1, 0.1],
            },
            {
              dimensions: [
                { name: '2025-01-01' },
                { name: 'vk' },
                { name: 'cpc' },
                { name: 'spring' },
              ],
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
    expect(calls[0]?.['filters']).toBe("ym:s:startURL!~'^file:'");
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
    expect(rows).toBe(3);
    const geo = metrics.listGeoDeviceStats();
    expect(geo).toHaveLength(3);
    expect(geo.map((r) => r.date).sort()).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
    expect(geo[0]?.country).toBe('podcast'); // single-dimension fixture → country = first dim
    expect(geo[0]?.device).toBe('(none)'); // second dim missing → normalised
  });
});

describe('SyncService.syncPages', () => {
  it('caches raw + page stats per day chunk', async () => {
    const { rows } = await svc.syncPages('2025-01-01', '2025-01-03', 80);
    expect(rows).toBe(3);
    const pages = metrics.listPageStats();
    expect(pages).toHaveLength(3);
    expect(pages.map((r) => r.date).sort()).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
    expect(pages[0]?.page).toBe('podcast'); // single-dimension fixture → page = first dim
  });
});

describe('SyncService.syncExitPages', () => {
  it('caches raw + exit-page stats per day chunk', async () => {
    const { rows } = await svc.syncExitPages('2025-01-01', '2025-01-03', 80);
    expect(rows).toBe(3);
    const pages = metrics.listExitPageStats();
    expect(pages).toHaveLength(3);
    expect(pages.map((r) => r.date).sort()).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
    expect(pages[0]?.page).toBe('podcast'); // single-dimension fixture → page = first dim
  });
});

describe('SyncService.syncAll', () => {
  it('returns a combined summary including UTM + geo/device + page + exit-page + new slices', async () => {
    const summary = await svc.syncAll('2025-01-01', '2025-01-07', 80);
    expect(summary).toEqual({
      goals: 2,
      resolvedGoalId: 80, // explicit goalId passed through
      days: 7, // window length (range request for the 5 small breakdowns, ANA-113)
      channelRows: 7,
      utmRows: 7,
      geoDeviceRows: 7,
      pageRows: 7,
      exitPageRows: 7,
      // bytime group=day over the whole range: both goals' series × 7 days.
      goalReachesRows: 14,
      browserOsRows: 7,
      newReturningRows: 7,
      errors: [], // ANA-15: every optional step passed
      skippedZero: 0, // ANA-153: nothing needed protection on a live counter
    });
  });

  it('auto-detects the primary KPI goal when no goalId is passed', async () => {
    // The goals fixture has a purchase-looking goal (id 80 «Оплата») → selected automatically.
    const summary = await svc.syncAll('2025-01-01', '2025-01-07');
    expect(summary.resolvedGoalId).toBe(80);
  });

  it('skips a breakdown whose query the API rejects, still completing the rest', async () => {
    const client = {
      get: vi.fn(async (path: string, params?: Record<string, unknown>) => {
        if (path.includes('/goals')) return goalsFixture;
        if (String(params?.['dimensions'] ?? '').includes('UTMSource')) {
          throw new Error('Metrika 400: invalid attribute ym:s:UTMSource');
        }
        return statResponder()(path, params);
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
    expect(summary.channelRows).toBe(3); // rest still synced, one row per day
    expect(summary.exitPageRows).toBe(3);
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
    expect(metrics.listChannelStats()).toHaveLength(7);
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

// ANA-113: усечённый range-ответ (row-cap 10000) не роняет синк, но обязан попасть
// в summary.errors — /api/sync/status и админка обязаны показать неполноту окна.
describe('SyncService — truncation guard (ANA-113)', () => {
  it('flags a truncated range response in summary.errors without failing the sync', async () => {
    const client = {
      get: vi.fn(async (path: string, params?: Record<string, unknown>) => {
        if (path.includes('/goals')) return goalsFixture;
        if (path.includes('bytime')) return bytimeFixture;
        return { ...statResponder()(path, params), total_rows: 50_000 };
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
    warn.mockRestore();
    // 4 range-таблицы (utm/geo/browser/nr) обязаны пометить усечение; pages/exit — per-day, нет.
    const flagged = (summary.errors ?? []).filter((e) => e.message.includes('усечён'));
    expect(flagged.map((e) => e.step).sort()).toEqual([
      'browser-os',
      'geo-device',
      'new-returning',
      'utm',
    ]);
    // Данные при этом загружены (частичные лучше нулей).
    expect(metrics.listUtmStats().length).toBeGreaterThan(0);
  });

  it('a complete range response produces no truncation errors', async () => {
    const summary = await svc.syncAll('2025-01-01', '2025-01-03', 80);
    expect((summary.errors ?? []).some((e) => e.message.includes('усечён'))).toBe(false);
  });
});

describe('SyncService.syncAll — failure safety (Metrika 429 quota)', () => {
  it('restores the whole window when the required traffic step fails after the wipe', async () => {
    await svc.syncAll('2025-01-01', '2025-01-07', 80);
    const before = {
      channels: metrics.listChannelStats().length,
      utm: metrics.listUtmStats().length,
      pages: metrics.listPageStats().length,
      goals: metrics.listGoals(true).length,
    };
    expect(before.channels).toBeGreaterThan(0);

    const quota = Object.assign(new Error('Metrika 429: quota_requests_by_uid'), { status: 429 });
    const client = {
      get: vi.fn(async (path: string) => {
        if (path.includes('/goals')) return goalsFixture;
        throw quota;
      }),
    } as unknown as MetrikaClient;
    const failing = new SyncService({
      client,
      metrics,
      counterId: 12345678,
      archivedThreshold: 77,
      now: () => 'T',
    });
    await expect(failing.syncAll('2025-01-01', '2025-01-07', 80)).rejects.toThrow(/429/);

    expect(metrics.listChannelStats()).toHaveLength(before.channels);
    expect(metrics.listUtmStats()).toHaveLength(before.utm);
    expect(metrics.listPageStats()).toHaveLength(before.pages);
    expect(metrics.listGoals(true)).toHaveLength(before.goals);
  });

  it('restores an optional table whose step failed (0 rows) when it had data before', async () => {
    await svc.syncAll('2025-01-01', '2025-01-07', 80);
    const utmBefore = metrics.listUtmStats().length;
    expect(utmBefore).toBeGreaterThan(0);
    const client = {
      get: vi.fn(async (path: string, params?: { dimensions?: string }) => {
        if (path.includes('/goals')) return goalsFixture;
        if (String(params?.['dimensions'] ?? '').includes('UTMSource'))
          throw new Error('Metrika 429');
        return path.includes('bytime') ? bytimeFixture : statResponder()(path, params);
      }),
    } as unknown as MetrikaClient;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const partial = new SyncService({
      client,
      metrics,
      counterId: 12345678,
      archivedThreshold: 77,
      now: () => 'T',
    });
    const summary = await partial.syncAll('2025-01-01', '2025-01-07', 80);
    expect(summary.utmRows).toBe(0);
    expect(metrics.listUtmStats()).toHaveLength(utmBefore);
    warn.mockRestore();
  });
});

// ANA-18/15 (appended): after a successful sync the demo dataset must be gone (live rows kept),
// and per-step failures must surface in summary.errors for the sync-status UI.
describe('SyncService.syncAll — demo wipe + error surface (ANA-18, ANA-15)', () => {
  it('wipes demo seed rows after a successful sync; user-entered live rows survive', async () => {
    // Seed-shaped demo rows (is_demo = 1), OUTSIDE the synced window so the wipe below is
    // attributable to the demo cleanup, not the routine window reset.
    metrics.upsertChannelStats([
      {
        date: '2024-12-01',
        channel: 'podcast',
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        visits: 420,
        users: 378,
        bounceRate: 0.2,
        avgDuration: 60,
        goalReaches: 12,
        conversionRate: 12 / 420,
        isDemo: true,
      },
    ]);
    const { B2bRepo } = await import('../../src/db/repositories/b2b-repo');
    const { B2cPaymentsRepo } = await import('../../src/db/repositories/b2c-payments-repo');
    const b2b = new B2bRepo(db);
    b2b.create({
      company: 'BigCorp',
      tickets: 20,
      stage: 'paid',
      dateAdded: '2024-12-01',
      isDemo: true,
    });
    b2b.create({ company: 'RealCo', tickets: 5, stage: 'lead', dateAdded: '2024-12-02' });
    const b2c = new B2cPaymentsRepo(db);
    b2c.upsert(
      { date: '2024-12-01', tickets: 6 },
      { source: 'manual', isDemo: true, now: () => 'T' },
    );
    b2c.upsert({ date: '2024-12-02', tickets: 3 }, { source: 'manual', now: () => 'T' });

    const summary = await svc.syncAll('2025-01-01', '2025-01-07', 80);

    expect(summary.errors ?? []).toEqual([]); // ANA-15: no errors on the happy path
    expect(metrics.listChannelStats().every((c) => !c.isDemo)).toBe(true);
    expect(metrics.listChannelStats().length).toBeGreaterThan(0); // synced (live) rows present
    expect(metrics.demoStatus().demo).toBe(false);
    // b2b_manual is user-entered: only the demo deal is removed.
    const deals = b2b.list();
    expect(deals.map((d) => d.company)).toEqual(['RealCo']);
    expect(b2c.list().map((p) => p.date)).toEqual(['2024-12-02']);
  });

  it('collects a failed optional step into summary.errors (not only console.warn)', async () => {
    const client = {
      get: vi.fn(async (path: string, params?: { dimensions?: string }) => {
        if (path.includes('/goals')) return goalsFixture;
        if (String(params?.['dimensions'] ?? '').includes('UTMSource'))
          throw new Error('Metrika 400: bad attr');
        return path.includes('bytime') ? bytimeFixture : statResponder()(path, params);
      }),
    } as unknown as MetrikaClient;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const partial = new SyncService({
      client,
      metrics,
      counterId: 12345678,
      archivedThreshold: 77,
      now: () => 'T',
    });
    const summary = await partial.syncAll('2025-01-01', '2025-01-07', 80);
    warn.mockRestore();
    expect(summary.errors).toEqual([{ step: 'utm', message: 'Metrika 400: bad attr' }]);
  });
});

// ANA-153 zero-protection round-trip: the counter's statistics were RESET (~2026-11-06) after the
// real history was restored from raw_responses (ANA-150). Metrika now answers zero rows for the
// pre-reset dates, so a wide sync would INSERT OR REPLACE the restored rows with zeros. The sync
// must leave every non-zero row intact, count the defended rows in summary.skippedZero, and only
// an explicit force may overwrite the history.
describe('SyncService.syncAll — zero-protection round-trip (ANA-153)', () => {
  /** Same response shapes as statResponder, but every metric zeroed (the reset counter). */
  function zeroResponder() {
    return (_path: string, params?: Record<string, unknown>) => {
      const dims = String(params?.['dimensions'] ?? '');
      if (dims.startsWith('ym:s:date')) {
        const from = String(params?.['date1'] ?? '');
        const to = String(params?.['date2'] ?? '');
        return {
          data: statRangeFixture.data
            .filter((r) => {
              const d = String(r.dimensions[0]?.name ?? '');
              return d >= from && d <= to;
            })
            .map((r) => ({ ...r, metrics: [0, 0, 0, 0] })),
        };
      }
      return { data: [{ dimensions: [{ name: 'podcast' }], metrics: [0, 0, 0, 0] }] };
    };
  }

  function zeroSvc(): SyncService {
    return new SyncService({
      client: {
        get: vi.fn(async (path: string, params?: Record<string, unknown>) =>
          path.includes('/goals')
            ? goalsFixture
            : path.includes('bytime')
              ? bytimeFixture
              : zeroResponder()(path, params),
        ),
      } as unknown as MetrikaClient,
      metrics,
      counterId: 12345678,
      archivedThreshold: 77,
      now: () => '2025-01-20T00:00:00.000Z',
    });
  }

  it('a wide sync over the reset counter keeps every restored non-zero row', async () => {
    // Round 1: a normal sync fills the window with real (non-zero) Metrika data.
    await svc.syncAll('2025-01-01', '2025-01-07', 80);
    expect(metrics.listChannelStats().every((r) => r.visits === 100)).toBe(true);

    // Round 2: the counter is reset — every response carries zeros now, with the same keys.
    const summary = await zeroSvc().syncAll('2025-01-01', '2025-01-07', 80);

    // 7 days × 5 stat tables defended against the zero overwrite.
    expect(summary.skippedZero).toBe(35);
    expect(metrics.listChannelStats().every((r) => r.visits === 100)).toBe(true);
    expect(metrics.listUtmStats().every((r) => r.visits === 100)).toBe(true);
    expect(metrics.listGeoDeviceStats().every((r) => r.visits === 100)).toBe(true);
    expect(metrics.listPageStats().every((r) => r.visits === 100)).toBe(true);
    expect(metrics.listExitPageStats().every((r) => r.visits === 100)).toBe(true);
    expect(metrics.countProtectedDays()).toBe(7); // the audited defended dates
  });

  it('force lets the admin deliberately overwrite the restored history with the zeros', async () => {
    await svc.syncAll('2025-01-01', '2025-01-07', 80);
    const summary = await zeroSvc().syncAll('2025-01-01', '2025-01-07', 80, { force: true });

    expect(summary.skippedZero).toBe(0);
    expect(metrics.listChannelStats().every((r) => r.visits === 0)).toBe(true);
    expect(metrics.listUtmStats().every((r) => r.visits === 0)).toBe(true);
    expect(metrics.listGeoDeviceStats().every((r) => r.visits === 0)).toBe(true);
    expect(metrics.listPageStats().every((r) => r.visits === 0)).toBe(true);
    expect(metrics.listExitPageStats().every((r) => r.visits === 0)).toBe(true);
    expect(metrics.countProtectedDays()).toBe(0);
  });
});
