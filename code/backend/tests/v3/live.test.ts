import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  duplicateGroups,
  eventOf,
  goalStatus,
  isArchivedLiveGoal,
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
    expect(body.tickets).toHaveLength(3);
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
