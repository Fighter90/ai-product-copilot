import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  duplicateGroups,
  eventOf,
  goalStatus,
  isArchivedLiveGoal,
  LIVE_CACHE_TTL_MS,
  liveRoutes,
  PC_FUNNEL,
  PC_FUNNEL_GOAL_STEPS,
  previousPeriod,
  ROLE_FUNNELS,
  TtlCache,
  type LiveDeps,
  type LiveGoal,
} from '../../src/live/live';
import type { MetrikaClient } from '../../src/metrika/client';

const goal = (over: Partial<LiveGoal> & { id: number }): LiveGoal =>
  ({
    name: `g${over.id}`,
    type: 'action',
    conditions: [{ type: 'contain', url: `event_${over.id}` }],
    ...over,
  }) as LiveGoal;

describe('pure helpers', () => {
  it('goalStatus: live / sleeping / dead', () => {
    expect(goalStatus(1, 100)).toBe('live');
    expect(goalStatus(0, 5)).toBe('sleeping');
    expect(goalStatus(0, 0)).toBe('dead');
  });

  it('eventOf extracts the URL condition of action goals only', () => {
    expect(
      eventOf(goal({ id: 1, type: 'action', conditions: [{ type: 'exact', url: 'cta_click' }] })),
    ).toBe('cta_click');
    expect(eventOf(goal({ id: 2, type: 'url', conditions: [{ url: '/x' }] }))).toBeUndefined();
    expect(eventOf(goal({ id: 3, type: 'action', conditions: [] }))).toBeUndefined();
  });

  it('duplicateGroups maps each duplicate to the others (condition-set signature)', () => {
    const goals: LiveGoal[] = [
      goal({ id: 1, type: 'action', conditions: [{ url: 'a' }, { url: 'b' }] }),
      goal({ id: 2, type: 'action', conditions: [{ url: 'b' }, { url: 'a' }] }), // same set, another order
      goal({ id: 3, type: 'action', conditions: [{ url: 'a' }, { url: 'b' }] }),
      goal({ id: 4, type: 'action', conditions: [{ url: 'c' }] }),
      goal({ id: 5, type: 'url', conditions: [{ url: 'a' }, { url: 'b' }] }), // другой тип — не дубль
      goal({ id: 6, type: 'action' }), // без условий — игнор
    ];
    const dupes = duplicateGroups(goals);
    expect(dupes.get(1)).toEqual([2, 3]);
    expect(dupes.get(2)).toEqual([1, 3]);
    expect(dupes.get(3)).toEqual([1, 2]);
    expect(dupes.has(4)).toBe(false);
    expect(dupes.has(5)).toBe(false);
    expect(dupes.has(6)).toBe(false);
  });

  it('isArchivedLiveGoal: explicit flag wins, else the Management API status', () => {
    expect(isArchivedLiveGoal({ archived: true, status: 'Active' })).toBe(true);
    expect(isArchivedLiveGoal({ archived: false, status: 'Archived' })).toBe(false);
    expect(isArchivedLiveGoal({ status: 'Archived' })).toBe(true);
    expect(isArchivedLiveGoal({ status: 'Active' })).toBe(false);
    expect(isArchivedLiveGoal({})).toBe(false);
  });

  it('previousPeriod: same length, ending the day before', () => {
    expect(previousPeriod('2025-06-10', '2025-06-10')).toEqual({
      from: '2025-06-09',
      to: '2025-06-09',
    });
    expect(previousPeriod('2025-06-08', '2025-06-14')).toEqual({
      from: '2025-06-01',
      to: '2025-06-07',
    });
  });

  it('PC_FUNNEL ordering is stable for the frontend funnel: Визит → goals → Оплата', () => {
    expect(PC_FUNNEL.map((s) => s.key)).toEqual([
      'visits',
      'price_view',
      'cta_click',
      'reg_open',
      'cart_open',
      'reg_step1',
      'payment',
    ]);
    expect(PC_FUNNEL[0]).toMatchObject({ source: 'visits', ru: 'Визит' });
    expect(PC_FUNNEL.at(-1)).toMatchObject({ source: 'payment', ru: 'Оплата' });
    expect(PC_FUNNEL_GOAL_STEPS.map((s) => s.event)).toEqual([
      'price_view',
      'cta_click',
      'reg_open',
      'cart_open',
      'reg_step1',
    ]);
  });

  it('ROLE_FUNNELS: C-level has the two-part form, other roles view → start → apply', () => {
    const clevel = ROLE_FUNNELS.find((f) => f.key === 'clevel')!;
    expect(clevel.steps.map((s) => s.key)).toEqual(['view', 'start', 'part1', 'part2', 'apply']);
    expect(clevel.steps[0]!.events).toEqual(['clevel_view', 'clevel_form_view']);
    expect(clevel.steps.at(-1)!.events).toEqual(['clevel_apply']);
    for (const key of ['speaker', 'volunteer', 'partner'])
      expect(ROLE_FUNNELS.find((f) => f.key === key)!.steps.map((s) => s.key)).toEqual([
        'view',
        'start',
        'apply',
      ]);
  });
});

describe('TtlCache', () => {
  it('caches within ttl, reloads after expiry, honours a per-call ttl', async () => {
    let t = 0;
    const cache = new TtlCache(100, () => t);
    const load = vi.fn(async () => 'v1');
    expect(await cache.get('k', load)).toEqual({ value: 'v1', cachedAt: 0 });
    expect(await cache.get('k', load)).toEqual({ value: 'v1', cachedAt: 0 });
    expect(load).toHaveBeenCalledTimes(1);

    t = 99;
    expect(await cache.get('k', load, 1000)).toEqual({ value: 'v1', cachedAt: 0 }); // per-call ttl ещё жив
    t = 150;
    load.mockResolvedValue('v2');
    expect(await cache.get('k', load)).toEqual({ value: 'v2', cachedAt: 150 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry past 500 keys', async () => {
    let t = 0;
    const cache = new TtlCache(10_000, () => t);
    for (let i = 0; i <= 500; i++) await cache.get(`k${i}`, async () => i);
    t = 1;
    // Первый ключ вытеснен → перезагрузка; последний 500-й — ещё в кэше.
    const load1 = vi.fn(async () => 'again');
    await cache.get('k0', load1);
    expect(load1).toHaveBeenCalledTimes(1);
    const load500 = vi.fn(async () => 'x');
    await cache.get('k500', load500);
    expect(load500).not.toHaveBeenCalled();
  });
});

describe('liveRoutes', () => {
  let app: FastifyInstance;
  let get: ReturnType<typeof vi.fn>;
  let deps: { token: string; counterId: number };

  /** Script get() calls: /stat/v1/data → stat payload, goals path → goals payload. */
  const statPayload = (
    totals: number[],
    data: Array<{ dimensions: unknown[]; metrics: number[] }> = [],
  ) => ({
    totals,
    data,
  });

  const build = async (over: Partial<LiveDeps> = {}) => {
    get = vi.fn(async (path: string) => {
      if (path === '/stat/v1/data')
        return statPayload(
          [10, 8, 20, 25, 120],
          [{ dimensions: [{ name: '2025-06-01' }], metrics: [10, 8] }],
        );
      if (path.includes('/goals'))
        return {
          goals: [
            goal({ id: 11, conditions: [{ url: 'reg_step1' }] }),
            goal({ id: 12, type: 'url', conditions: [{ url: '/pricing' }] }),
            goal({ id: 13, type: 'url', conditions: [{ url: '/old' }], status: 'Archived' }),
          ],
        };
      return {};
    });
    deps = { token: 'tok', counterId: 123 };
    const client = { get } as unknown as MetrikaClient;
    app = Fastify({ logger: false });
    await app.register(liveRoutes, {
      prefix: '/api',
      token: over.token ?? (() => deps.token),
      counterId: over.counterId ?? (() => deps.counterId),
      clientFactory: over.clientFactory ?? (() => client),
      today: over.today ?? (() => '2025-06-15'),
      orderGoalId: over.orderGoalId,
    });
    await app.ready();
  };

  afterEach(async () => {
    await app.close();
  });

  it('409 when Metrika is not configured (no token or counter)', async () => {
    await build({ token: () => '' });
    const res = await app.inject({ method: 'GET', url: '/api/live/summary' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('METRIKA_NOT_CONFIGURED');

    await build({ counterId: () => 0 });
    expect((await app.inject({ method: 'GET', url: '/api/live/goals' })).statusCode).toBe(409);
  });

  it('400 on a malformed range', async () => {
    await build();
    const res = await app.inject({ method: 'GET', url: '/api/live/summary?from=01.06.2025' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid range');
  });

  it('GET /live/summary: totals + hourly series for a single day', async () => {
    await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/live/summary?from=2025-06-01&to=2025-06-01',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      from: '2025-06-01',
      to: '2025-06-01',
      totals: { visits: 10, users: 8, pageviews: 20, bounceRate: 25, avgDurationSec: 120 },
    });
    expect(body.series).toEqual([{ bucket: '2025-06-01', visits: 10, users: 8 }]);
    // Тест-фильтр применяется к обоим запросам.
    const statCalls = (
      get.mock.calls as unknown as Array<[string, Record<string, unknown>]>
    ).filter(([p]) => p === '/stat/v1/data');
    expect(statCalls.length).toBeGreaterThanOrEqual(2);
    for (const [, params] of statCalls)
      expect(String(params.filters)).toContain("startURL!~'^file:'");
  });

  it('GET /live/goals: reaches, conversion, previous period, status and duplicates', async () => {
    await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/live/goals?from=2025-06-01&to=2025-06-07',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.previous).toEqual({ from: '2025-05-25', to: '2025-05-31' });
    expect(body.visits).toBe(10);
    expect(body.goals).toHaveLength(3);
    // Archive state is passed through so the frontend can honour the «Архивные цели» filter.
    expect(body.goals.map((x: { archived: boolean }) => x.archived)).toEqual([false, false, true]);
    const g = body.goals[0];
    expect(g).toMatchObject({
      id: 11,
      event: 'reg_step1',
      reaches: expect.any(Number),
      status: expect.stringMatching(/^(live|sleeping|dead)$/),
    });
    expect(typeof g.delta).toBe('number');
    expect(g.duplicateOf).toEqual([]);
    // test=1 снимает тест-фильтр
    await app.inject({ method: 'GET', url: '/api/live/goals?test=1' });
    const statCalls = (
      get.mock.calls as unknown as Array<[string, Record<string, unknown>]>
    ).filter(([p]) => p === '/stat/v1/data');
    expect(statCalls.at(-1)![1].filters).toBeUndefined();
  });

  it('GET /live/goals/:id: 404 for an unknown goal, payload with breakdowns otherwise', async () => {
    await build();
    expect((await app.inject({ method: 'GET', url: '/api/live/goals/999' })).statusCode).toBe(404);

    const res = await app.inject({
      method: 'GET',
      url: '/api/live/goals/11?from=2025-06-01&to=2025-06-01',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goal).toMatchObject({ id: 11, event: 'reg_step1', archived: false });
    expect(body.totals).toEqual({ visits: 10, reaches: 8, conversionRate: 20 });
    // Фейковый клиент отдаёт в строке данных только 2 метрики → третья (conversionRate) = 0
    expect(body.bySource).toEqual([
      { key: '2025-06-01', visits: 10, reaches: 8, conversionRate: 0 },
    ]);
    expect(body.byCountry).toHaveLength(1);
  });

  it('GET /live/funnel: stage ratios, tickets and missing events', async () => {
    await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/live/funnel?from=2025-06-01&to=2025-06-07',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const visits = body.stages[0];
    expect(visits).toMatchObject({ key: 'visits', value: 10, fromPrevious: null, fromFirst: null });
    // Ни одна pc-цель не настроена в фейковом клиенте → все стадии 0 и полный missing.
    expect(body.stages[1]!.value).toBe(0);
    expect(body.missing).toContain('price_view');
    expect(body.missing).toContain('ticket_pick_standard');
    expect(body.missing).toContain('volunteer_apply');
    expect(body.tickets).toHaveLength(4);
    expect(body.roles).toHaveLength(4);
  });

  it('GET /live/table/:preset: 404 unknown preset; grid with goal metric for a known one', async () => {
    await build();
    expect((await app.inject({ method: 'GET', url: '/api/live/table/nope' })).statusCode).toBe(404);

    const res = await app.inject({
      method: 'GET',
      url: '/api/live/table/sources?from=2025-06-01&to=2025-06-07',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goalId).toBe(11); // дефолт: pc-goals reg_step1
    expect(body.columns).toContain('ym:s:goal11reaches');
    expect(body.rows).toEqual([{ dims: ['2025-06-01'], values: [10, 8] }]);

    // Явный goal= идёт в метрики; days сортируется по дате.
    await app.inject({ method: 'GET', url: '/api/live/table/days?goal=77' });
    const last = (get.mock.calls as unknown as Array<[string, Record<string, unknown>]>).at(-1)![1];
    expect(String(last.metrics)).toContain('ym:s:goal77reaches');
    expect(last.sort).toBe('ym:s:date');
  });

  it('TTL: повторный вызов в пределах 60 c не бьёт в Метрику', async () => {
    await build();
    await app.inject({ method: 'GET', url: '/api/live/summary?from=2025-06-01&to=2025-06-01' });
    const afterFirst = get.mock.calls.length;
    await app.inject({ method: 'GET', url: '/api/live/summary?from=2025-06-01&to=2025-06-01' });
    expect(get.mock.calls.length).toBe(afterFirst); // из кэша
  });
});

describe('backupToken fallback (ANA-107: резервный аккаунт)', () => {
  it('default clientFactory passes the backup token to the client', async () => {
    const seen: Array<{ token: string; backup?: string }> = [];
    const app = Fastify({ logger: false });
    await app.register(liveRoutes, {
      prefix: '/live-t',
      token: () => 'primary-token',
      counterId: () => 123,
      backupToken: () => 'backup-token',
      clientFactory: (t, backup) => {
        seen.push({ token: t, backup });
        return { get: vi.fn(async () => ({ data: [], totals: [] })) } as unknown as MetrikaClient;
      },
    });
    await app.ready();
    await app.inject({
      method: 'GET',
      url: '/live-t/live/summary?from=2025-01-01&to=2025-01-07',
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.backup).toBe('backup-token');
    expect(seen[0]!.token).toBe('primary-token');
    await app.close();
  });
});

describe('ANA-125: параллельные чанки reach() + TTL живого периода', () => {
  it('LIVE_CACHE_TTL_MS: 180–300 c (прежние 60 c перечитывали живой период каждую минуту)', () => {
    expect(LIVE_CACHE_TTL_MS).toBeGreaterThanOrEqual(180_000);
    expect(LIVE_CACHE_TTL_MS).toBeLessThanOrEqual(300_000);
  });

  it('кэш с новым TTL держит источник 4 минуты, потом перечитывает', async () => {
    let t = 0;
    const cache = new TtlCache(LIVE_CACHE_TTL_MS, () => t);
    const load = vi.fn(async () => 'x');
    await cache.get('k', load);
    t = 120_000; // 2 минуты — старый TTL 60 c уже истёк бы
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
    t = LIVE_CACHE_TTL_MS + 1;
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  /**
   * 25 целей → 3 чанка текущего периода (по 10, с visits) + 2+2+2 чанка сравнительных
   * (по 20). Чанки одного периода должны уйти в Метрику одновременно (раньше — строго
   * по очереди), но суммарно в полёте — не больше 4 запросов, как при прежнем
   * меж-периодном Promise.all. Число запросов и payload не меняются.
   */
  it('/live/goals: чанки одного периода в полёте одновременно, в полёте ≤4 запросов', async () => {
    const manyGoals = Array.from({ length: 25 }, (_, i) => goal({ id: 100 + i }));
    let chunkMetrics: string[] = [];
    let atMaxMetrics: string[] = [];
    const gates: Array<() => void> = [];
    const get = vi.fn(async (_path: string, params: Record<string, unknown>) => {
      if (_path !== '/stat/v1/data') return { goals: manyGoals }; // Management API: список целей
      const metrics = String(params.metrics ?? '');
      const isChunk = /goal\d+reaches/.test(metrics); // visits-запрос периода — не чанк
      if (isChunk) {
        chunkMetrics = [...chunkMetrics, metrics];
        if (chunkMetrics.length > atMaxMetrics.length) atMaxMetrics = [...chunkMetrics];
      }
      await new Promise<void>((r) => gates.push(r)); // держим запрос в полёте
      if (isChunk) chunkMetrics = chunkMetrics.filter((m) => m !== metrics);
      return { totals: [10], data: [] };
    });
    const app = Fastify({ logger: false });
    await app.register(liveRoutes, {
      prefix: '/api',
      token: () => 'tok',
      counterId: () => 123,
      clientFactory: () => ({ get }) as unknown as MetrikaClient,
      today: () => '2025-06-15',
    });
    await app.ready();
    const pending = app.inject({
      method: 'GET',
      url: '/api/live/goals?from=2025-06-01&to=2025-06-07',
    });
    try {
      // Первый запрос — visits текущего периода, он один и его надо пропустить; дальше
      // прокачиваем обработчик, пока чанк-запросы не упрутся в семафор и не перестанут
      // стартовать (стабильное состояние: 4 в полёте, очередь ждёт).
      let released = false;
      let stable = 0;
      let prev = -1;
      for (let i = 0; i < 200; i++) {
        if (!released && gates.length > 0) {
          gates.shift()!();
          released = true;
          stable = 0;
          await new Promise((r) => setTimeout(r, 2));
          continue;
        }
        const calls = get.mock.calls.length;
        stable = released && calls === prev ? stable + 1 : 0;
        prev = calls;
        if (stable >= 2) break; // два опроса подряд без роста — устойчивое состояние
        await new Promise((r) => setTimeout(r, 2));
      }
      expect(gates).toHaveLength(4); // ровно 4 запроса Метрики в полёте — лимит не наращён
      // Цель — единственный период с метриками goal*Nvisits: ≥2 таких чанка в полёте
      // одновременно доказывают параллельность чанков одного периода.
      const curChunksAtMax = atMaxMetrics.filter((m) => /goal\d+visits/.test(m));
      expect(curChunksAtMax.length).toBeGreaterThanOrEqual(2);
    } finally {
      // Отпускаем ворота волнами: освобождение слота пускает следующий чанк из очереди
      // семафора, он в свою очередь встаёт на новые ворота — ждём, пока очередь иссякнет.
      while (gates.length > 0) {
        for (const r of gates.splice(0)) r();
        await new Promise((r) => setTimeout(r, 2));
      }
    }
    const res = await pending;
    expect(res.statusCode).toBe(200);
    const statCalls = (
      get.mock.calls as unknown as Array<[string, Record<string, unknown>]>
    ).filter(([p]) => p === '/stat/v1/data');
    expect(statCalls).toHaveLength(10); // 1 visits + 9 чанков — число запросов не изменилось
    const body = res.json();
    expect(body.goals).toHaveLength(25);
    expect(body.goals[0]).toMatchObject({
      id: 100,
      reaches: expect.any(Number),
      goalVisits: expect.any(Number),
      conversionRate: expect.any(Number),
      previousReaches: expect.any(Number),
      reaches14: expect.any(Number),
      reaches90: expect.any(Number),
    });
    await app.close();
  });

  it('429 по квоте после успеха → /live/goals отдаёт прошлые данные (stale-cache), а не 503', async () => {
    let ok = true;
    const cache = new TtlCache(0); // ttl 0 → каждый запрос перечитывает источник
    const makeErr = () => {
      const e = new Error('Metrika 429: quota_requests_by_uid') as Error & { status: number };
      e.status = 429;
      e.name = 'MetrikaHttpError';
      return e;
    };
    const app = Fastify({ logger: false });
    await app.register(liveRoutes, {
      prefix: '/live-t',
      token: () => 'tok',
      counterId: () => 123,
      cache,
      clientFactory: () =>
        ({
          get: async (path: string) => {
            if (path.includes('/goals')) return { goals: [goal({ id: 11 })] };
            if (!ok) throw makeErr();
            return { totals: [7], data: [] };
          },
        }) as unknown as MetrikaClient,
    });
    await app.ready();
    const url = '/live-t/live/goals?from=2025-06-01&to=2025-06-07';
    const ok1 = await app.inject({ method: 'GET', url });
    expect(ok1.statusCode).toBe(200);
    const reachesBefore = (ok1.json() as { goals: Array<{ reaches: number }> }).goals.map(
      (g) => g.reaches,
    );
    ok = false; // дальше Метрика отвечает 429 по квоте
    const ok2 = await app.inject({ method: 'GET', url });
    expect(ok2.statusCode).toBe(200); // stale-cache, а не 503 METRIKA_QUOTA
    const reachesAfter = (ok2.json() as { goals: Array<{ reaches: number }> }).goals.map(
      (g) => g.reaches,
    );
    expect(reachesAfter).toEqual(reachesBefore);
    await app.close();
  });
});

describe('TtlCache stale-on-error (v3.4.1: live-страницы переживают сбой Метрики)', () => {
  it('returns the last good value flagged stale when the source fails', async () => {
    const cache = new TtlCache(0); // ttl 0 → каждый get перезагружает источник
    await cache.get('k', async () => ({ n: 1 })); // первое — успех, ложится в кэш
    const failing = vi.fn(async () => {
      throw new Error('Metrika 400: query_error');
    });
    const r = await cache.get('k', failing);
    expect(r.stale).toBe(true);
    expect(r.value).toEqual({ n: 1 });
    expect(failing).toHaveBeenCalledTimes(1); // источник дёргался, но ответ — из кэша
  });

  it('propagates the error when there is no last-good value', async () => {
    const cache = new TtlCache(0);
    await expect(
      cache.get('empty', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('live-роуты: человекочитаемая деградация (v3.4.1)', () => {
  function makeApp(opts: { failAfter?: number } = {}) {
    let calls = 0;
    const cache = new TtlCache(0); // без кэширования — предсказуемый вызов источника
    const app = Fastify({ logger: false });
    void app.register(liveRoutes, {
      prefix: '/live-t',
      token: () => 'primary-token',
      counterId: () => 123,
      cache,
      clientFactory: () =>
        ({
          get: async () => {
            calls++;
            if (opts.failAfter !== undefined && calls > opts.failAfter) {
              const e = new Error('Metrika 400: query_error') as Error & { status: number };
              e.status = 400;
              e.name = 'MetrikaHttpError';
              throw e;
            }
            return {
              data: [{ dimensions: [{ name: '2025-01-01' }], metrics: [1, 2] }],
              totals: [3],
              query: { date1: '2025-01-01', date2: '2025-01-01' },
            };
          },
        }) as unknown as MetrikaClient,
    });
    return { app, calls: () => calls };
  }

  it('400 query_error → 503 с человекочитаемым текстом и кодом (без кэша)', async () => {
    const { app } = makeApp({ failAfter: 0 });
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/live-t/live/summary?from=2025-01-01&to=2025-01-07',
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: string; code: string };
    expect(body.code).toBe('METRIKA_QUERY_TOO_COMPLEX');
    expect(body.error).toContain('Метрика');
    await app.close();
  });

  it('после успеха сбой отдаёт прошлые данные со stale-флагом', async () => {
    const { app } = makeApp({ failAfter: 2 }); // первый запрос (2 stat-вызова) — успех, дальше сбой
    await app.ready();
    const ok1 = await app.inject({
      method: 'GET',
      url: '/live-t/live/summary?from=2025-01-01&to=2025-01-07',
    });
    expect(ok1.statusCode).toBe(200);
    expect(ok1.json()).not.toHaveProperty('stale');
    const ok2 = await app.inject({
      method: 'GET',
      url: '/live-t/live/summary?from=2025-01-01&to=2025-01-07',
    });
    expect(ok2.statusCode).toBe(200);
    expect(ok2.json()).toHaveProperty('stale', true);
    await app.close();
  });
});
