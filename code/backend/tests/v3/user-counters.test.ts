import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from '../../src/auth/auth';
import { UsersRepo, type User } from '../../src/auth/users-repo';
import { UserCountersRepo } from '../../src/auth/user-counters-repo';
import {
  grantOnCreate,
  isCounterDataPath,
  registerCounterGuard,
  userCountersRoutes,
} from '../../src/auth/user-counters';
import type { FetchLike } from '../../src/metrika/client';
import { buildServer } from '../../src/app';
import { AppSettings } from '../../src/settings/app-settings';
import { LlmService } from '../../src/llm/service';
import type { HttpFetch } from '../../src/llm/providers';
import { buildTestApp } from '../api/helpers';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

const COUNTER = 54280963;

interface Ctx {
  app: FastifyInstance;
  db: DB;
  users: UsersRepo;
  access: UserCountersRepo;
  admin: User;
  analyst: User;
  adminCookie: string;
  analystCookie: string;
  counterId: { value: number };
  token: { value: string };
  fetchFn: ReturnType<typeof vi.fn>;
}

async function build(): Promise<Ctx> {
  const db = freshDb();
  // Guard tests start from a migrated install whose one-off legacy grant was already consumed.
  db.prepare('DELETE FROM user_counters_legacy_grant').run();
  const users = new UsersRepo(db);
  const access = new UserCountersRepo(db);
  const admin = users.create({
    email: 'admin@x.ru',
    name: 'A',
    role: 'admin',
    password: 'p'.repeat(12),
  });
  const analyst = users.create({
    email: 'analyst@x.ru',
    name: 'B',
    role: 'analyst',
    password: 'p'.repeat(12),
  });
  const counterId = { value: COUNTER };
  const token = { value: '' };
  const fetchFn = vi.fn();
  const app = Fastify({ logger: false });
  registerAuth(app, {
    users,
    cookieSecure: false,
    sessionDays: 1,
    onUserCreated: grantOnCreate(access, () => counterId.value),
  });
  registerCounterGuard(app, { access, counterId: () => counterId.value });
  app.register(userCountersRoutes, {
    prefix: '/api',
    access,
    users,
    counterId: () => counterId.value,
    token: () => token.value,
    fetchFn: fetchFn as unknown as FetchLike,
  });
  for (const url of [
    '/api/metrics/channels',
    '/api/live/summary',
    '/api/report/snapshots',
    '/api/integrations/datalens/datasets',
    '/api/hypotheses',
  ]) {
    app.get(url, async () => ({ ok: true }));
  }
  app.post('/api/integrations/datalens/webhook/:token', async () => ({ ok: true }));
  await app.ready();
  return {
    app,
    db,
    users,
    access,
    admin,
    analyst,
    adminCookie: `pca_session=${users.createSession(admin.id, 1)}`,
    analystCookie: `pca_session=${users.createSession(analyst.id, 1)}`,
    counterId,
    token,
    fetchFn,
  };
}

let ctx: Ctx;
beforeEach(async () => {
  ctx = await build();
});
afterEach(async () => {
  await ctx.app.close();
  ctx.db.close();
});

const get = (url: string, cookie: string) =>
  ctx.app.inject({ method: 'GET', url, headers: { cookie } });

const DATA_URLS = [
  '/api/metrics/channels',
  '/api/live/summary',
  '/api/report/snapshots',
  '/api/integrations/datalens/datasets',
  '/api/%6Detrics/channels', // percent-encoded path must not dodge the guard
];

describe('isCounterDataPath', () => {
  it('matches metrics / live / report / datalens, not own-work routes', () => {
    expect(isCounterDataPath('/api/metrics/channels?from=1')).toBe(true);
    expect(isCounterDataPath('//api//live/goals')).toBe(true);
    expect(isCounterDataPath('/api/report/download/x/pdf')).toBe(true);
    expect(isCounterDataPath('/api/integrations/datalens/export/a.csv')).toBe(true);
    expect(isCounterDataPath('/api/hypotheses')).toBe(false);
    expect(isCounterDataPath('/api/decisions')).toBe(false);
    expect(isCounterDataPath('/api/auth/me')).toBe(false);
  });
});

describe('counter guard', () => {
  it.each(DATA_URLS)('analyst WITHOUT access → 403 COUNTER_FORBIDDEN on %s', async (url) => {
    const res = await get(url, ctx.analystCookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('COUNTER_FORBIDDEN');
  });

  it.each(DATA_URLS)('analyst WITH access → 200 on %s', async (url) => {
    ctx.access.set(ctx.analyst.id, [COUNTER]);
    expect((await get(url, ctx.analystCookie)).statusCode).toBe(200);
  });

  it('access to another counter does not help', async () => {
    ctx.access.set(ctx.analyst.id, [111]);
    expect((await get('/api/metrics/channels', ctx.analystCookie)).statusCode).toBe(403);
  });

  it.each(DATA_URLS)('admin always has access (no assignment) → 200 on %s', async (url) => {
    expect((await get(url, ctx.adminCookie)).statusCode).toBe(200);
  });

  it('own-work routes stay open for an analyst without counters', async () => {
    expect((await get('/api/hypotheses', ctx.analystCookie)).statusCode).toBe(200);
  });

  it('anonymous still gets 401 (session guard first), public webhook untouched', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/metrics/channels' })).statusCode).toBe(
      401,
    );
    const hook = await ctx.app.inject({
      method: 'POST',
      url: '/api/integrations/datalens/webhook/abc',
      payload: {},
    });
    expect(hook.statusCode).toBe(200);
  });

  it('switching COUNTER_ID re-applies the check against the new counter', async () => {
    ctx.access.set(ctx.analyst.id, [COUNTER]);
    ctx.counterId.value = 999;
    expect((await get('/api/metrics/channels', ctx.analystCookie)).statusCode).toBe(403);
  });

  it('no counter configured → nothing to protect', async () => {
    ctx.counterId.value = 0;
    expect((await get('/api/metrics/channels', ctx.analystCookie)).statusCode).toBe(200);
  });

  it('upgrade: pending legacy marker grants existing analysts on first request', async () => {
    ctx.db
      .prepare('INSERT INTO user_counters_legacy_grant (id, created_at) VALUES (1, ?)')
      .run('2026-10-27T00:00:00.000Z');
    // Fresh guard instance (marker is checked once per repo instance).
    const access = new UserCountersRepo(ctx.db);
    const app = Fastify({ logger: false });
    registerAuth(app, { users: ctx.users, cookieSecure: false, sessionDays: 1 });
    registerCounterGuard(app, { access, counterId: () => COUNTER });
    app.get('/api/metrics/channels', async () => ({ ok: true }));
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics/channels',
      headers: { cookie: ctx.analystCookie },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(access.list(ctx.analyst.id)).toEqual([COUNTER]);
  });
});

describe('admin assignment API', () => {
  const put = (id: number, payload: object, cookie = ctx.adminCookie) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/api/users/${id}/counters`,
      headers: { cookie },
      payload,
    });

  it('PUT /api/users/:id/counters stores the list, audits it, unlocks the data', async () => {
    const res = await put(ctx.analyst.id, { counterIds: [COUNTER, COUNTER, 42] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: ctx.analyst.id, counterIds: [42, COUNTER] });
    expect((await get('/api/metrics/channels', ctx.analystCookie)).statusCode).toBe(200);
    const audit = ctx.users.listAudit(1)[0]!;
    expect(audit).toMatchObject({
      action: 'users.counters',
      target: 'analyst@x.ru',
      userEmail: 'admin@x.ru',
    });
    expect(JSON.parse(audit.details!)).toEqual({ counterIds: [42, COUNTER] });

    // Revoke → 403 again.
    expect((await put(ctx.analyst.id, { counterIds: [] })).json().counterIds).toEqual([]);
    expect((await get('/api/metrics/channels', ctx.analystCookie)).statusCode).toBe(403);
  });

  it('PUT validates the body and the user', async () => {
    expect((await put(ctx.analyst.id, { counterIds: ['x'] })).statusCode).toBe(400);
    expect((await put(ctx.analyst.id, { counterIds: [0] })).statusCode).toBe(400);
    expect((await put(ctx.analyst.id, {})).statusCode).toBe(400);
    expect((await put(9999, { counterIds: [1] })).statusCode).toBe(404);
  });

  it('analyst → 403 ADMIN_ONLY on every assignment endpoint (cannot grant itself)', async () => {
    const self = await put(ctx.analyst.id, { counterIds: [COUNTER] }, ctx.analystCookie);
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe('ADMIN_ONLY');
    for (const url of ['/api/admin/counters', '/api/admin/user-counters']) {
      const res = await get(url, ctx.analystCookie);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().code).toBe('ADMIN_ONLY');
    }
    expect(ctx.access.list(ctx.analyst.id)).toEqual([]);
  });

  it('GET /api/admin/user-counters → map userId → counters', async () => {
    ctx.access.set(ctx.analyst.id, [COUNTER]);
    const res = await get('/api/admin/user-counters', ctx.adminCookie);
    expect(res.json()).toEqual({ [ctx.analyst.id]: [COUNTER] });
  });

  it('GET /api/admin/counters without a token → configured counter + assigned ones', async () => {
    ctx.access.set(ctx.analyst.id, [42]);
    const res = await get('/api/admin/counters', ctx.adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      configured: COUNTER,
      counters: [
        { id: COUNTER, name: null, site: null, configured: true, source: 'settings' },
        { id: 42, name: null, site: null, configured: false, source: 'assigned' },
      ],
    });
    expect(ctx.fetchFn).not.toHaveBeenCalled();
  });

  it('GET /api/admin/counters merges the Metrika management list (names, extra counters)', async () => {
    ctx.token.value = 'tok-secret';
    ctx.fetchFn.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        rows: 2,
        counters: [
          { id: 7, name: 'Second', site: 'b.ru' },
          { id: COUNTER, name: 'ProductCamp', site: 'productcamp.ru' },
        ],
      }),
      text: async () => '',
    });
    const res = await get('/api/admin/counters', ctx.adminCookie);
    expect(res.json().counters).toEqual([
      {
        id: COUNTER,
        name: 'ProductCamp',
        site: 'productcamp.ru',
        configured: true,
        source: 'settings',
      },
      { id: 7, name: 'Second', site: 'b.ru', configured: false, source: 'metrika' },
    ]);
    const [url, init] = ctx.fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('https://api-metrika.yandex.net/management/v1/counters');
    expect(init.headers.Authorization).toBe('OAuth tok-secret');
  });

  it('GET /api/admin/counters: Metrika failure is reported without leaking the token', async () => {
    ctx.token.value = 'tok-secret';
    ctx.fetchFn.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'access denied',
    });
    const body = (await get('/api/admin/counters', ctx.adminCookie)).json();
    expect(body.counters.map((c: { id: number }) => c.id)).toEqual([COUNTER]);
    expect(body.metrikaError).toContain('403');
    expect(JSON.stringify(body)).not.toContain('tok-secret');
  });

  it('POST /api/users: new analyst gets the configured counter by default', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: ctx.adminCookie },
      payload: { email: 'new@x.ru', name: 'N', role: 'analyst' },
    });
    expect(res.statusCode).toBe(201);
    expect(ctx.access.list(res.json().user.id)).toEqual([COUNTER]);
  });

  it('POST /api/users: explicit counterIds win (empty = no access); admins get no rows', async () => {
    const create = (payload: object) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/users',
        headers: { cookie: ctx.adminCookie },
        payload,
      });
    const none = await create({ email: 'n1@x.ru', name: 'N', role: 'analyst', counterIds: [] });
    expect(ctx.access.list(none.json().user.id)).toEqual([]);
    const some = await create({ email: 'n2@x.ru', name: 'N', role: 'analyst', counterIds: [5] });
    expect(ctx.access.list(some.json().user.id)).toEqual([5]);
    const adm = await create({ email: 'n3@x.ru', name: 'N', role: 'admin' });
    expect(ctx.access.list(adm.json().user.id)).toEqual([]);
    const bad = await create({ email: 'n4@x.ru', name: 'N', role: 'analyst', counterIds: [-1] });
    expect(bad.statusCode).toBe(400);
  });
});

describe('full cabinet app: real data endpoints enforce counter access', () => {
  let app: FastifyInstance;
  let db: DB;
  let access: UserCountersRepo;
  let analyst: User;
  let analystCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    const base = buildTestApp();
    await base.app.close();
    db = base.db;
    db.prepare('DELETE FROM user_counters_legacy_grant').run();
    const users = new UsersRepo(db);
    access = new UserCountersRepo(db);
    const admin = users.create({
      email: 'admin@x.ru',
      name: 'A',
      role: 'admin',
      password: 'p'.repeat(12),
    });
    analyst = users.create({
      email: 'an@x.ru',
      name: 'B',
      role: 'analyst',
      password: 'p'.repeat(12),
    });
    app = buildServer({
      ...base.deps,
      cabinet: {
        db,
        users,
        settings: new AppSettings(db, 'uc-test-secret', { COUNTER_ID: String(COUNTER) }),
        llm: new LlmService(db, 'uc-test-secret', vi.fn() as unknown as HttpFetch),
        helpDir: tmpdir(),
        cookieSecure: false,
        sessionDays: 1,
        tz: 'Europe/Moscow',
      },
    });
    await app.ready();
    adminCookie = `pca_session=${users.createSession(admin.id, 1)}`;
    analystCookie = `pca_session=${users.createSession(analyst.id, 1)}`;
  });
  afterAll(async () => {
    await app.close();
    db.close();
  });

  const REAL = [
    '/api/metrics/channels',
    '/api/metrics/kpi-target',
    '/api/live/summary',
    '/api/report/snapshots',
    '/api/integrations/datalens/datasets',
  ];

  it.each(REAL)('analyst without access → 403 on %s; admin → not 403', async (url) => {
    access.set(analyst.id, []);
    const denied = await app.inject({ method: 'GET', url, headers: { cookie: analystCookie } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('COUNTER_FORBIDDEN');
    const adm = await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } });
    expect(adm.statusCode).not.toBe(403);
  });

  it('admin assigns the counter via the API → analyst reads metrics', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/users/${analyst.id}/counters`,
      headers: { cookie: adminCookie },
      payload: { counterIds: [COUNTER] },
    });
    expect(res.statusCode).toBe(200);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/metrics/channels',
      headers: { cookie: analystCookie },
    });
    expect(ok.statusCode).toBe(200);
  });
});
