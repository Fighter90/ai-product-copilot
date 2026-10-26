import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { UsersRepo } from '../../src/auth/users-repo';
import { registerAuth, SESSION_COOKIE } from '../../src/auth/auth';
import { MetrikaHttpError, type MetrikaClient } from '../../src/metrika/client';
import { metrikaGoalsRoutes } from '../../src/routes/metrika-goals';
import { PC_GOALS_REFERENCE } from '../../src/metrika/pc-goals-reference';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

const COUNTER_GOALS = [
  {
    id: 1,
    name: 'G-01 Увидел блок билетов (price_view)',
    type: 'action',
    conditions: [{ type: 'exact', url: 'price_view' }],
  },
  { id: 2, name: 'CTA', type: 'action', conditions: [{ type: 'contain', url: 'cta_click' }] },
  { id: 3, name: 'Корзина', type: 'url', conditions: [{ type: 'contain', url: '/cart' }] },
  { id: 4, name: 'корзина ', type: 'url', conditions: [{ type: 'contain', url: '/cart' }] },
  {
    id: 5,
    name: 'Old',
    type: 'action',
    status: 'Archived',
    conditions: [{ type: 'exact', url: 'reg_open' }],
  },
];

/** MetrikaClient double: records get()/post() calls and returns scripted results/errors. */
function fakeManager(permission = 'edit') {
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('/unarchive')) return { success: true };
    if (path.includes('/archive')) return { success: true };
    return { goal: { id: 222, name: 'Created goal', type: 'url' } };
  });
  const get = vi.fn(async (path: string) => {
    if (path.endsWith('/goals')) return { goals: COUNTER_GOALS };
    return { counter: { id: 123, permission } };
  });
  return { client: { post, get } as unknown as MetrikaClient, post, get };
}

interface Harness {
  app: FastifyInstance;
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
}

async function build(
  over: {
    token?: string;
    counterId?: number;
    permission?: string;
    postImpl?: (path: string) => Promise<unknown>;
    reaches?: Map<number, number>;
  } = {},
): Promise<Harness> {
  const mgr = fakeManager(over.permission);
  if (over.postImpl) mgr.post.mockImplementation(over.postImpl as never);
  const audit = vi.fn();
  const users = { audit } as unknown as UsersRepo;
  const app = Fastify({ logger: false });
  await app.register(metrikaGoalsRoutes, {
    prefix: '/api',
    token: () => over.token ?? 'tok',
    counterId: () => over.counterId ?? 123,
    users,
    clientFactory: () => mgr.client,
    goalReaches: async (ids) =>
      over.reaches ?? new Map(ids.map((id) => [id, id === 3 ? 0 : 5] as [number, number])),
  });
  await app.ready();
  return { app, post: mgr.post, get: mgr.get, audit };
}

const validSpec = {
  name: 'Cart view',
  type: 'url',
  conditions: [{ type: 'contain', url: '/cart' }],
};

let h: Harness;
beforeEach(async () => {
  h = await build();
});

describe('GET /api/admin/metrika/goals/audit', () => {
  it('diffs the pc-goals reference against the counter (read-only)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/admin/metrika/goals/audit?days=30',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toBe(30);
    expect(body.expected).toHaveLength(PC_GOALS_REFERENCE.length);
    const byEvent = (e: string) =>
      body.expected.find((r: { ref: { event: string } }) => r.ref.event === e);
    expect(byEvent('price_view')).toMatchObject({ status: 'present', goalId: 1 });
    expect(byEvent('cta_click')).toMatchObject({ status: 'mismatch', goalId: 2 });
    expect(byEvent('cta_click').issues.join()).toMatch(/expected exact/);
    expect(byEvent('reg_open')).toMatchObject({ status: 'missing', archivedGoalId: 5 });
    expect(byEvent('reg_step1')).toMatchObject({ status: 'missing' });
    expect(body.dead.map((d: { id: number }) => d.id)).toEqual([3]);
    expect(body.duplicates).toHaveLength(1);
    expect(body.duplicates[0].goals.map((g: { id: number }) => g.id)).toEqual([3, 4]);
    expect(body.permission).toBe('edit');
    expect(body.canWrite).toBe(true);
    expect(h.post).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range days with 400', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/admin/metrika/goals/audit?days=0' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/admin/metrika/goals/preview', () => {
  it('returns the exact request for a reference goal without writing', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/preview',
      payload: { ref: 'reg_step1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      method: 'POST',
      path: '/management/v1/counter/123/goals',
      body: {
        goal: {
          name: 'G-05 Оставил контакты (заказ) (reg_step1)',
          type: 'action',
          conditions: [{ type: 'exact', url: 'reg_step1' }],
        },
      },
    });
    expect(h.post).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('validates a custom spec and strips control keys', async () => {
    const ok = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/preview',
      payload: { ...validSpec, confirm: true },
    });
    expect(ok.json().body).toEqual({ goal: validSpec });
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/preview',
      payload: { name: 'x', type: 'url', conditions: [{ type: 'js', url: 'a' }] },
    });
    expect(bad.statusCode).toBe(400);
    expect(h.post).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/metrika/goals', () => {
  it('requires confirm === true (400, no write)', async () => {
    for (const confirm of [undefined, false, 'true', 'АРХИВ']) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/admin/metrika/goals',
        payload: { ...validSpec, confirm },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('CONFIRM_REQUIRED');
    }
    expect(h.post).not.toHaveBeenCalled();
  });

  it('creates with confirm (confirm is not forwarded), 201 + audited', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { ...validSpec, confirm: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ goal: { id: 222, name: 'Created goal', type: 'url' } });
    const [path, params, body] = h.post.mock.calls[0] as unknown as [string, unknown, unknown];
    expect(path).toBe('/management/v1/counter/123/goals');
    expect(params).toEqual({});
    expect(body).toEqual({ goal: validSpec });
    expect(h.audit).toHaveBeenCalledWith(null, 'metrika.goal_created', 'Created goal', {
      goalId: 222,
      type: 'url',
    });
  });

  it('accepts the {"goal": ...} envelope and {ref}', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { goal: validSpec, confirm: true },
    });
    expect(res.statusCode).toBe(201);
    expect(h.post.mock.calls[0]?.[2]).toEqual({ goal: validSpec });
    await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { ref: 'G-02', confirm: true },
    });
    expect(h.post.mock.calls[1]?.[2]).toEqual({
      goal: {
        name: 'G-02 Клик по CTA (cta_click)',
        type: 'action',
        conditions: [{ type: 'exact', url: 'cta_click' }],
      },
    });
  });

  it('rejects an invalid spec locally with 400 (no HTTP call)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { name: 'x', type: 'teleport', confirm: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_INPUT');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('refuses up front when the counter grant is view-only (no write)', async () => {
    const ro = await build({ permission: 'view' });
    const res = await ro.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { ...validSpec, confirm: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('METRIKA_WRITE_FORBIDDEN');
    expect(res.json().error).toMatch(/токену нужен доступ metrika:write/);
    expect(ro.post).not.toHaveBeenCalled();
  });

  it('maps a Metrika 403 to «токену нужен доступ metrika:write», 400 "No object" to 404', async () => {
    const forbidden = await build({
      postImpl: () => {
        throw new MetrikaHttpError(403, 'Metrika 403: access denied');
      },
    });
    const res403 = await forbidden.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { ...validSpec, confirm: true },
    });
    expect(res403.statusCode).toBe(403);
    expect(res403.json().code).toBe('METRIKA_FORBIDDEN');
    expect(res403.json().error).toMatch(/токену нужен доступ metrika:write/);

    const notFound = await build({
      postImpl: () => {
        throw new MetrikaHttpError(400, 'Metrika 400: No object with specified ID');
      },
    });
    const res = await notFound.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { ...validSpec, confirm: true },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'GOAL_NOT_FOUND' });
  });

  it('answers 409 when Metrika is not configured', async () => {
    const app409 = await build({ token: '' });
    const res = await app409.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { ...validSpec, confirm: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('METRIKA_NOT_CONFIGURED');
  });
});

describe('POST /api/admin/metrika/goals/:id/archive | /restore', () => {
  it('archive requires the typed word АРХИВ', async () => {
    for (const confirm of [undefined, true, 'архив', 'ARCHIVE']) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/admin/metrika/goals/456/archive',
        payload: { confirm },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('CONFIRM_REQUIRED');
    }
    expect(h.post).not.toHaveBeenCalled();
  });

  it('archives with the singular goal path and forwards folderId', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/456/archive',
      payload: { folderId: 3, confirm: 'АРХИВ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(h.post.mock.calls[0]?.slice(0, 3)).toEqual([
      '/management/v1/counter/123/goal/456/archive',
      { folderid: 3 },
      {},
    ]);
    expect(h.audit).toHaveBeenCalledWith(null, 'metrika.goal_archived', '456');
  });

  it('restore requires confirm: true, then unarchives', async () => {
    const no = await h.app.inject({ method: 'POST', url: '/api/admin/metrika/goals/456/restore' });
    expect(no.statusCode).toBe(400);
    expect(h.post).not.toHaveBeenCalled();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/456/restore',
      payload: { confirm: true },
    });
    expect(res.statusCode).toBe(200);
    expect(h.post.mock.calls[0]?.[0]).toBe('/management/v1/counter/123/goal/456/unarchive');
    expect(h.audit).toHaveBeenCalledWith(null, 'metrika.goal_restored', '456');
  });

  it('rejects a non-numeric goal id with 400', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/abc/archive',
      payload: { confirm: 'АРХИВ' },
    });
    expect(res.statusCode).toBe(400);
    expect(h.post).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/metrika/goals/archive-bulk', () => {
  it('requires АРХИВ (400, no write)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/archive-bulk',
      payload: { ids: [3, 4], confirm: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CONFIRM_REQUIRED');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('archives each id once, audits each + a summary', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/archive-bulk',
      payload: { ids: [3, 4, 3], confirm: 'АРХИВ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ archived: [3, 4], failed: [], skipped: [] });
    expect(h.post.mock.calls.map((c) => c[0])).toEqual([
      '/management/v1/counter/123/goal/3/archive',
      '/management/v1/counter/123/goal/4/archive',
    ]);
    expect(h.audit).toHaveBeenCalledWith(null, 'metrika.goal_archived', '3', { bulk: true });
    expect(h.audit).toHaveBeenCalledWith(null, 'metrika.goals_archived_bulk', '2', {
      archived: [3, 4],
      failed: [],
      skipped: [],
    });
  });

  it('reports per-goal failures and stops on a 403', async () => {
    let n = 0;
    const partial = await build({
      postImpl: async () => {
        n += 1;
        if (n === 2) throw new MetrikaHttpError(400, 'Metrika 400: No object with specified ID');
        if (n === 3) throw new MetrikaHttpError(403, 'Metrika 403: denied');
        return { success: true };
      },
    });
    const res = await partial.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/archive-bulk',
      payload: { ids: [1, 2, 3, 4], confirm: 'АРХИВ' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.archived).toEqual([1]);
    expect(body.failed.map((f: { id: number }) => f.id)).toEqual([2, 3]);
    expect(body.skipped).toEqual([4]);
    expect(partial.post).toHaveBeenCalledTimes(3);
  });

  it('a 403 on the first write answers 403 with the metrika:write message', async () => {
    const denied = await build({
      postImpl: async () => {
        throw new MetrikaHttpError(403, 'Metrika 403: denied');
      },
    });
    const res = await denied.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/archive-bulk',
      payload: { ids: [1, 2], confirm: 'АРХИВ' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/токену нужен доступ metrika:write/);
    expect(denied.post).toHaveBeenCalledTimes(1);
  });

  it('rejects empty / oversized id lists', async () => {
    for (const ids of [[], Array.from({ length: 101 }, (_, i) => i + 1)]) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/admin/metrika/goals/archive-bulk',
        payload: { ids, confirm: 'АРХИВ' },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('role guard', () => {
  let db: DB;
  let app: FastifyInstance;
  let post: ReturnType<typeof vi.fn>;
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('analyst gets 403 ADMIN_ONLY on every goals route; nothing reaches Metrika', async () => {
    db = freshDb();
    const repo = new UsersRepo(db);
    const analyst = repo.create({
      email: 'an@x.ru',
      name: 'Analyst',
      role: 'analyst',
      password: 'analyst-pass-123',
    });
    const token = repo.createSession(analyst.id, 1);
    const mgr = fakeManager();
    post = mgr.post;
    app = Fastify({ logger: false });
    registerAuth(app, { users: repo, cookieSecure: false, sessionDays: 1 });
    await app.register(metrikaGoalsRoutes, {
      prefix: '/api',
      token: () => 'tok',
      counterId: () => 123,
      users: repo,
      clientFactory: () => mgr.client,
    });
    await app.ready();
    const cookie = `${SESSION_COOKIE}=${token}`;
    const calls: Array<[string, string, unknown?]> = [
      ['GET', '/api/admin/metrika/goals/audit'],
      ['POST', '/api/admin/metrika/goals/preview', validSpec],
      ['POST', '/api/admin/metrika/goals', { ...validSpec, confirm: true }],
      ['POST', '/api/admin/metrika/goals/archive-bulk', { ids: [1], confirm: 'АРХИВ' }],
      ['POST', '/api/admin/metrika/goals/1/archive', { confirm: 'АРХИВ' }],
      ['POST', '/api/admin/metrika/goals/1/restore', { confirm: true }],
    ];
    for (const [method, url, payload] of calls) {
      const res = await app.inject({
        method: method as 'GET' | 'POST',
        url,
        headers: { cookie },
        ...(payload ? { payload: payload as object } : {}),
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().code).toBe('ADMIN_ONLY');
    }
    expect(post).not.toHaveBeenCalled();
    expect(mgr.get).not.toHaveBeenCalled();
  });
});
