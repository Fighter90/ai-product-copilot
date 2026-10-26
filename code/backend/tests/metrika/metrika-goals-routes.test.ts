import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { UsersRepo } from '../../src/auth/users-repo';
import { MetrikaHttpError, type MetrikaClient } from '../../src/metrika/client';
import { metrikaGoalsRoutes } from '../../src/routes/metrika-goals';

/** MetrikaClient double: records post() calls and returns scripted results/errors. */
function fakeManager() {
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('/unarchive')) return { success: true };
    if (path.includes('/archive')) return { success: true };
    return { goal: { id: 222, name: 'Created goal', type: 'url' } };
  });
  return { client: { post } as unknown as MetrikaClient, post };
}

interface Harness {
  app: FastifyInstance;
  post: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
}

async function build(
  over: { token?: string; counterId?: number; postImpl?: (path: string) => Promise<unknown> } = {},
): Promise<Harness> {
  const mgr = fakeManager();
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
  });
  await app.ready();
  return { app, post: mgr.post, audit };
}

const validSpec = {
  name: 'Cart view',
  type: 'url',
  conditions: [{ type: 'contains', url: '/cart' }],
};

let h: Harness;
beforeEach(async () => {
  h = await build();
});

describe('POST /api/admin/metrika/goals', () => {
  it('creates a goal from a bare spec (the route wraps it), 201 + audited', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: validSpec,
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

  it('also accepts the {"goal": ...} envelope', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { goal: validSpec },
    });
    expect(res.statusCode).toBe(201);
    expect(h.post.mock.calls[0]?.[2]).toEqual({ goal: validSpec });
  });

  it('rejects an invalid spec locally with 400 (no HTTP call)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: { name: 'x', type: 'teleport' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_INPUT');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('maps a Metrika 400 "No object" body to 404 GOAL_NOT_FOUND, and 403 to METRIKA_FORBIDDEN', async () => {
    const notFound = await build({
      postImpl: () => {
        throw new MetrikaHttpError(400, 'Metrika 400: No object with specified ID');
      },
    });
    const res = await notFound.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: validSpec,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'GOAL_NOT_FOUND' });

    const forbidden = await build({
      postImpl: () => {
        throw new MetrikaHttpError(403, 'Metrika 403: access denied');
      },
    });
    const res403 = await forbidden.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: validSpec,
    });
    expect(res403.statusCode).toBe(403);
    expect(res403.json().code).toBe('METRIKA_FORBIDDEN');
  });

  it('answers 409 when Metrika is not configured', async () => {
    const app409 = await build({ token: '' });
    const res = await app409.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals',
      payload: validSpec,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('METRIKA_NOT_CONFIGURED');
  });
});

describe('POST /api/admin/metrika/goals/:id/archive | /restore', () => {
  it('archives with the singular goal path and forwards folderId', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/admin/metrika/goals/456/archive',
      payload: { folderId: 3 },
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

  it('restores an archived goal', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/api/admin/metrika/goals/456/restore' });
    expect(res.statusCode).toBe(200);
    expect(h.post.mock.calls[0]?.[0]).toBe('/management/v1/counter/123/goal/456/unarchive');
    expect(h.audit).toHaveBeenCalledWith(null, 'metrika.goal_restored', '456');
  });

  it('rejects a non-numeric goal id with 400', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/api/admin/metrika/goals/abc/archive' });
    expect(res.statusCode).toBe(400);
    expect(h.post).not.toHaveBeenCalled();
  });
});
