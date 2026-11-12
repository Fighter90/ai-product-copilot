import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, type TestApp } from './helpers';

describe('GET /api/metrics/primary-goal', () => {
  it('returns the auto-detected purchase goal', async () => {
    const ctx = buildTestApp();
    ctx.deps.metrics.upsertGoals([
      { id: 5, name: 'Заявка', type: 'action', isB2b: false, isArchived: false, syncedAt: 'x' },
      {
        id: 8,
        name: 'Ecommerce: покупка',
        type: 'action',
        isB2b: false,
        isArchived: false,
        syncedAt: 'x',
      },
    ]);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/metrics/primary-goal' });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(8);
    await ctx.app.close();
    ctx.db.close();
  });

  it('404s when no goal looks like a KPI', async () => {
    const ctx = buildTestApp();
    ctx.deps.metrics.upsertGoals([
      {
        id: 3,
        name: 'Просмотр видео',
        type: 'action',
        isB2b: false,
        isArchived: false,
        syncedAt: 'x',
      },
    ]);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/metrics/primary-goal' });
    expect(res.statusCode).toBe(404);
    await ctx.app.close();
    ctx.db.close();
  });
});

let ctx: TestApp;

beforeAll(() => {
  ctx = buildTestApp();
  ctx.deps.metrics.upsertGoals([
    { id: 80, name: 'Оплата', type: 'action', isB2b: false, isArchived: false, syncedAt: 'x' },
    { id: 10, name: 'old', type: 'action', isB2b: false, isArchived: true, syncedAt: 'x' },
  ]);
  ctx.deps.metrics.upsertChannelStats([
    {
      date: '2025-01-01',
      channel: 'podcast',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      visits: 100,
      users: 90,
      bounceRate: 0.2,
      avgDuration: 65,
      goalReaches: 5,
      conversionRate: 0.05,
    },
    {
      date: '2025-01-09',
      channel: 'direct',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      visits: 50,
      users: 45,
      bounceRate: 0.3,
      avgDuration: 40,
      goalReaches: 2,
      conversionRate: 0.04,
    },
  ]);
  ctx.deps.metrics.upsertUtmStats([
    {
      date: '2025-01-01',
      utmSource: 'vk',
      utmMedium: 'cpc',
      utmCampaign: 'spring',
      visits: 80,
      users: 70,
      goalReaches: 4,
      conversionRate: 0.05,
    },
    {
      date: '2025-01-09',
      utmSource: 'tg',
      utmMedium: 'social',
      utmCampaign: 'launch',
      visits: 30,
      users: 28,
      goalReaches: 1,
      conversionRate: 0.03,
    },
  ]);
  ctx.deps.metrics.upsertGeoDeviceStats([
    {
      date: '2025-01-01',
      country: 'Россия',
      device: 'mobile',
      visits: 60,
      users: 55,
      goalReaches: 3,
      conversionRate: 0.05,
    },
    {
      date: '2025-01-09',
      country: 'Казахстан',
      device: 'desktop',
      visits: 20,
      users: 18,
      goalReaches: 1,
      conversionRate: 0.05,
    },
  ]);
  ctx.deps.metrics.upsertPageStats([
    {
      date: '2025-01-01',
      page: '/lp',
      visits: 70,
      users: 60,
      bounceRate: 0.25,
      goalReaches: 4,
      conversionRate: 0.05,
    },
    {
      date: '2025-01-09',
      page: '/pricing',
      visits: 25,
      users: 22,
      bounceRate: 0.4,
      goalReaches: 1,
      conversionRate: 0.04,
    },
  ]);
  ctx.deps.metrics.upsertExitPageStats([
    {
      date: '2025-01-01',
      page: '/checkout',
      visits: 40,
      users: 35,
      bounceRate: 0.6,
      goalReaches: 2,
      conversionRate: 0.05,
    },
    {
      date: '2025-01-09',
      page: '/thanks',
      visits: 10,
      users: 9,
      bounceRate: 0.1,
      goalReaches: 1,
      conversionRate: 0.1,
    },
  ]);
});
afterAll(async () => {
  await ctx.app.close();
  ctx.db.close();
});

describe('GET /api/metrics', () => {
  it('returns all channel stats, and a date-filtered subset', async () => {
    const all = await ctx.app.inject({ method: 'GET', url: '/api/metrics/channels' });
    expect(all.json()).toHaveLength(2);

    const ranged = await ctx.app.inject({
      method: 'GET',
      url: '/api/metrics/channels?from=2025-01-01&to=2025-01-05',
    });
    expect(ranged.json()).toHaveLength(1);
  });

  it('returns all UTM stats, and a date-filtered subset', async () => {
    const all = await ctx.app.inject({ method: 'GET', url: '/api/metrics/utm' });
    expect(all.json()).toHaveLength(2);

    const ranged = await ctx.app.inject({
      method: 'GET',
      url: '/api/metrics/utm?from=2025-01-01&to=2025-01-05',
    });
    expect(ranged.json()).toHaveLength(1);
    expect(ranged.json()[0].utmSource).toBe('vk');
  });

  it('returns all geo/device stats, and a date-filtered subset', async () => {
    const all = await ctx.app.inject({ method: 'GET', url: '/api/metrics/geo-device' });
    expect(all.json()).toHaveLength(2);

    const ranged = await ctx.app.inject({
      method: 'GET',
      url: '/api/metrics/geo-device?from=2025-01-01&to=2025-01-05',
    });
    expect(ranged.json()).toHaveLength(1);
    expect(ranged.json()[0].country).toBe('Россия');
  });

  it('returns all page stats, and a date-filtered subset', async () => {
    const all = await ctx.app.inject({ method: 'GET', url: '/api/metrics/pages' });
    expect(all.json()).toHaveLength(2);

    const ranged = await ctx.app.inject({
      method: 'GET',
      url: '/api/metrics/pages?from=2025-01-01&to=2025-01-05',
    });
    expect(ranged.json()).toHaveLength(1);
    expect(ranged.json()[0].page).toBe('/lp');
  });

  it('returns all exit-page stats, and a date-filtered subset', async () => {
    const all = await ctx.app.inject({ method: 'GET', url: '/api/metrics/exit-pages' });
    expect(all.json()).toHaveLength(2);

    const ranged = await ctx.app.inject({
      method: 'GET',
      url: '/api/metrics/exit-pages?from=2025-01-01&to=2025-01-05',
    });
    expect(ranged.json()).toHaveLength(1);
    expect(ranged.json()[0].page).toBe('/checkout');
  });

  it('hides archived goals by default, includes them with ?archived=true', async () => {
    const def = await ctx.app.inject({ method: 'GET', url: '/api/metrics/goals' });
    expect(def.json()).toHaveLength(1);
    const all = await ctx.app.inject({ method: 'GET', url: '/api/metrics/goals?archived=true' });
    expect(all.json()).toHaveLength(2);
  });

  it('returns a raw response or 404', async () => {
    const id = ctx.deps.metrics.saveRawResponse({
      endpoint: '/stat/v1/data',
      queryHash: 'h',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-01',
      payload: { ok: true },
      fetchedAt: 't',
    });
    const found = await ctx.app.inject({ method: 'GET', url: `/api/metrics/raw/${id}` });
    expect(found.statusCode).toBe(200);
    const missing = await ctx.app.inject({ method: 'GET', url: '/api/metrics/raw/9999' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('GET /api/metrics/goal-roles', () => {
  it('lists the pc-goals reference with the funnel role of each JS-event goal', async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/metrics/goal-roles' });
    expect(res.statusCode).toBe(200);
    const { roles } = res.json() as {
      roles: Array<{ code: string; event: string; ru: string; en: string; group: string }>;
    };
    // The whole reference is served (21 entries: 5 funnel stages, 4×4 tickets, 4 applications).
    expect(roles.length).toBe(21);
    expect(roles[0]).toMatchObject({ code: 'G-01', group: 'funnel' });
    // The Goals page joins by JS-event name — codes and events are unique.
    const events = roles.map((r) => r.event);
    expect(new Set(events).size).toBe(events.length);
    const codes = roles.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    // Both locales are provided for the «Роль в воронке» column.
    for (const r of roles) {
      expect(r.ru).toBeTruthy();
      expect(r.en).toBeTruthy();
      expect(['funnel', 'ticket', 'role']).toContain(r.group);
    }
    await ctx.app.close();
    ctx.db.close();
  });
});

// ANA-148: GET /api/metrics/utm took ~10s on the 1-CPU prod. The repo caches the derived-stat
// reads with a short TTL; here we prove the route serves repeats from that cache and that a
// sync (resetSyncedWindow + upserts) makes fresh rows visible on the very next GET.
describe('GET /api/metrics/utm — response cache (ANA-148)', () => {
  const row = (date: string, source: string, campaign: string) => ({
    date,
    utmSource: source,
    utmMedium: 'cpc',
    utmCampaign: campaign,
    visits: 80,
    users: 70,
    goalReaches: 4,
    conversionRate: 0.05,
  });

  it('serves the repeat GET from the cache and refreshes after a sync invalidation', async () => {
    const ctx = buildTestApp();
    ctx.deps.metrics.upsertUtmStats([row('2025-01-01', 'vk', 'spring')]);
    const first = await ctx.app.inject({ method: 'GET', url: '/api/metrics/utm' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toHaveLength(1);

    // The row vanishes from SQLite OUTSIDE the repo (no invalidation ran) — the repeat GET
    // is still served from the cache: the «повторный GET < 300мс» acceptance criterion.
    ctx.db.prepare('DELETE FROM utm_stats').run();
    const second = await ctx.app.inject({ method: 'GET', url: '/api/metrics/utm' });
    expect(second.json()).toEqual(first.json());

    // A sync invalidates via resetSyncedWindow, then re-seeds the tables — the fresh rows
    // (here: only tg) are visible on the very next GET, never the pre-sync payload.
    ctx.deps.metrics.resetSyncedWindow('2025-01-01', '2025-01-31');
    ctx.deps.metrics.upsertUtmStats([row('2025-01-02', 'tg', 'launch')]);
    const third = await ctx.app.inject({ method: 'GET', url: '/api/metrics/utm' });
    expect(third.json()).toHaveLength(1);
    expect((third.json() as Array<{ utmSource: string }>)[0]?.utmSource).toBe('tg');

    await ctx.app.close();
    ctx.db.close();
  });

  it('caches each date range separately (from/to GETs never bleed into each other)', async () => {
    const ctx = buildTestApp();
    ctx.deps.metrics.upsertUtmStats([
      row('2025-01-01', 'vk', 'spring'),
      row('2025-01-09', 'tg', 'launch'),
    ]);
    const url = (from: string, to: string) => `/api/metrics/utm?from=${from}&to=${to}`;
    const jan01 = await ctx.app.inject({ method: 'GET', url: url('2025-01-01', '2025-01-01') });
    const jan09 = await ctx.app.inject({ method: 'GET', url: url('2025-01-09', '2025-01-09') });
    expect((jan01.json() as Array<{ utmSource: string }>).map((r) => r.utmSource)).toEqual(['vk']);
    expect((jan09.json() as Array<{ utmSource: string }>).map((r) => r.utmSource)).toEqual(['tg']);

    ctx.db.prepare('DELETE FROM utm_stats').run();
    const repeat01 = await ctx.app.inject({ method: 'GET', url: url('2025-01-01', '2025-01-01') });
    const repeat09 = await ctx.app.inject({ method: 'GET', url: url('2025-01-09', '2025-01-09') });
    expect(repeat01.json()).toEqual(jan01.json());
    expect(repeat09.json()).toEqual(jan09.json());

    await ctx.app.close();
    ctx.db.close();
  });
});
