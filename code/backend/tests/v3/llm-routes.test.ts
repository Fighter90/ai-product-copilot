import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { llmRoutes } from '../../src/llm/routes';
import { LlmService } from '../../src/llm/service';
import type { UsersRepo } from '../../src/auth/users-repo';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

const okFetch = (async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }], model: 'm' }),
})) as unknown as ConstructorParameters<typeof LlmService>[2];

let db: DB;
let app: FastifyInstance;
let llm: LlmService;
let audit: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  db = freshDb();
  llm = new LlmService(db, 'routes-secret', okFetch);
  llm.init({ openrouter: { secret: 'sk-or-123456', model: 'anthropic/claude-sonnet-4.5' } });
  const users = { audit: (audit = vi.fn()) } as unknown as UsersRepo;
  app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    // llmRoutes ждёт req.user (в проде ставит его registerAuth).
    (req as unknown as { user: { email: string } }).user = { email: 'admin@x.ru' };
  });
  await app.register(llmRoutes, { prefix: '/api', llm, users });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('GET routes', () => {
  it('/api/ai/available lists enabled+keyed providers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ai/available' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'openrouter', name: 'OpenRouter', model: expect.any(String) },
    ]);
  });

  it('/api/admin/ai/providers returns masked views', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/ai/providers' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(4);
    expect(list[0]).toMatchObject({ id: 'openrouter', secretMask: '••••3456', hasSecret: true });
    expect(res.body).not.toContain('sk-or');
  });

  it('/api/admin/ai/usage returns the usage aggregation', async () => {
    await llm.test('openrouter', 'admin@x.ru');
    const res = await app.inject({ method: 'GET', url: '/api/admin/ai/usage' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { provider: 'openrouter', calls: 1, failures: 0, outputChars: expect.any(Number) },
    ]);
  });
});

describe('PUT /api/admin/ai/providers/:id', () => {
  it('updates a provider and audits without the secret value', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ai/providers/anthropic',
      payload: { enabled: true, secret: 'sk-an-hidden-value' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'anthropic', enabled: true, hasSecret: true });
    const details = audit.mock.calls[0]![3] as Record<string, unknown>;
    expect(details).toEqual({ enabled: true, secret: 'changed' }); // значение секрета не логируется
    expect(JSON.stringify(audit.mock.calls)).not.toContain('sk-an-hidden-value');
  });

  it('secret: "" audits as "cleared"', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/admin/ai/providers/openrouter',
      payload: { secret: '' },
    });
    expect(audit.mock.calls[0]![3]).toMatchObject({ secret: 'cleared' });
  });

  it('unknown provider id → 404; invalid body → 400 BAD_INPUT', async () => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/admin/ai/providers/nope',
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/admin/ai/providers/openrouter',
          payload: { priority: 'high' },
        })
      ).json().code,
    ).toBe('BAD_INPUT');
  });
});

describe('POST /api/admin/ai/providers/:id/test', () => {
  it('runs the connectivity test and audits the outcome', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ai/providers/openrouter/test',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(audit).toHaveBeenCalledWith(expect.anything(), 'ai.provider_test', 'openrouter', {
      ok: true,
    });
  });

  it('unknown provider → 404', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/ai/providers/xyz/test' })).statusCode,
    ).toBe(404);
  });
});
