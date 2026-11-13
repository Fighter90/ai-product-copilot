/** ANA-151: admin model catalog — OpenRouter parsing, 1h TTL cache, static sets, admin endpoint. */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import {
  ModelCatalog,
  OPENROUTER_MODELS_URL,
  parseOpenRouterModels,
  staticCatalog,
} from '../../src/llm/model-catalog';
import { LlmService } from '../../src/llm/service';
import { llmRoutes } from '../../src/llm/routes';
import { ProviderError, type HttpFetch } from '../../src/llm/providers';
import { freshDb } from '../db/helpers';
import type { UsersRepo } from '../../src/auth/users-repo';
import type { DB } from '../../src/db/connection';

const OR_PAYLOAD = {
  data: [
    {
      id: 'anthropic/claude-opus-4.5',
      name: 'Claude Opus 4.5',
      context_length: 200_000,
      pricing: { prompt: '0.000005', completion: '0.000025' },
    },
    {
      id: 'openai/gpt-4.1',
      name: 'OpenAI: GPT-4.1',
      context_length: 1_047_576,
      pricing: { prompt: 0.000002, completion: 0.000008 },
    },
    { id: 'vendor/free-model', name: 'Free Model', pricing: { prompt: 'oops' } },
    { id: 'no-meta' },
    { name: 'junk entry without id' },
  ],
};

const fetchOf = (payload: unknown, status = 200): { fetch: HttpFetch; calls: () => number } => {
  const fn = vi.fn(async () => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(payload),
  }));
  return { fetch: fn as unknown as HttpFetch, calls: () => fn.mock.calls.length };
};

describe('parseOpenRouterModels', () => {
  it('maps id/name/context and converts per-token prices to per-1M', () => {
    const models = parseOpenRouterModels(OR_PAYLOAD);
    expect(models).toHaveLength(4);
    expect(models[0]).toEqual({
      id: 'anthropic/claude-opus-4.5',
      name: 'Claude Opus 4.5',
      contextLength: 200_000,
      promptPricePerM: 5,
      completionPricePerM: 25,
    });
    // numeric prices are accepted too
    expect(models[1]).toMatchObject({
      id: 'openai/gpt-4.1',
      promptPricePerM: 2,
      completionPricePerM: 8,
    });
    // unparsable/missing prices and metadata are simply omitted
    expect(models[2]).toEqual({ id: 'vendor/free-model', name: 'Free Model' });
    expect(models[3]).toEqual({ id: 'no-meta' });
  });

  it('throws a ProviderError on a non-array payload', () => {
    expect(() => parseOpenRouterModels({ data: 'nope' })).toThrow(ProviderError);
    expect(() => parseOpenRouterModels(null)).toThrow(ProviderError);
  });

  it('skips blank ids, empty names and negative prices (edge branches)', () => {
    const models = parseOpenRouterModels({
      data: [
        // whitespace-only id trims to empty → the entry is skipped entirely
        { id: '   ', name: 'blank id' },
        // empty name after the typeof check and negative prices are simply omitted
        { id: 'edge/negative-price', name: '', pricing: { prompt: '-0.5', completion: -1 } },
      ],
    });
    expect(models).toEqual([{ id: 'edge/negative-price' }]);
  });
});

describe('staticCatalog', () => {
  it('exposes the extended full static set for non-openrouter providers', () => {
    expect(staticCatalog('anthropic').map((m) => m.id)).toEqual(
      expect.arrayContaining([
        'claude-sonnet-5-5',
        'claude-opus-5-5',
        'claude-haiku-5-5',
        'claude-fable-5-1',
        'claude-opus-4-8',
        'claude-sonnet-4-6',
      ]),
    );
    expect(staticCatalog('yandexgpt').map((m) => m.id)).toEqual(
      expect.arrayContaining([
        'yandexgpt-5.1',
        'yandexgpt-5-pro',
        'yandexgpt/latest',
        'yandexgpt/rc',
        'aliceai-llm',
        'deepseek-v4.1-flash',
      ]),
    );
    expect(staticCatalog('gigachat').map((m) => m.id)).toEqual(
      expect.arrayContaining(['GigaChat-2', 'GigaChat-2-Pro', 'GigaChat-2-Max', 'GigaChat-2-Lite']),
    );
    // yandexgpt-5-lite is officially discontinued on 2026-11-15 — must not be offered to admins.
    expect(staticCatalog('yandexgpt').map((m) => m.id)).not.toContain('yandexgpt-5-lite');
  });
});

describe('ModelCatalog', () => {
  it('serves static providers without any HTTP call', async () => {
    const { fetch, calls } = fetchOf(OR_PAYLOAD);
    const catalog = new ModelCatalog(fetch, () => 0);
    await expect(catalog.get('yandexgpt')).resolves.toEqual({
      source: 'static',
      models: staticCatalog('yandexgpt'),
    });
    expect(calls()).toBe(0);
  });

  it('fetches OpenRouter live and caches it for the TTL', async () => {
    const { fetch, calls } = fetchOf(OR_PAYLOAD);
    let t = 1_000_000;
    const catalog = new ModelCatalog(fetch, () => t);
    const first = await catalog.get('openrouter');
    expect(first.source).toBe('live');
    expect(first.models).toHaveLength(4);
    expect(calls()).toBe(1);
    // within TTL the cache answers
    await catalog.get('openrouter');
    expect(calls()).toBe(1);
    // exactly at the TTL boundary the cache expires and the catalog is refetched
    t += 3_600_000;
    await catalog.get('openrouter');
    expect(calls()).toBe(2);
  });

  it('hits the public endpoint without a key', async () => {
    const { fetch, calls } = fetchOf(OR_PAYLOAD);
    const catalog = new ModelCatalog(fetch, () => 0);
    await catalog.get('openrouter');
    const [url, init] =
      calls() >= 1
        ? ((fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
            string,
            { method: string; headers: Record<string, string> },
          ])
        : [null, null];
    expect(url).toBe(OPENROUTER_MODELS_URL);
    expect(init!.method).toBe('GET');
    expect(JSON.stringify(init!.headers)).not.toMatch(/authorization|api-key/i);
  });

  it('surfaces HTTP errors as ProviderError', async () => {
    const { fetch } = fetchOf({ error: 'boom' }, 500);
    const catalog = new ModelCatalog(fetch, () => 0);
    await expect(catalog.get('openrouter')).rejects.toMatchObject({
      provider: 'openrouter',
      status: 500,
    });
  });

  it('rejects invalid JSON with a 502 ProviderError', async () => {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'not-json',
    })) as unknown as HttpFetch;
    const catalog = new ModelCatalog(fn, () => 0);
    await expect(catalog.get('openrouter')).rejects.toMatchObject({
      provider: 'openrouter',
      status: 502,
    });
  });
});

describe('GET /api/admin/ai/providers/:id/models (ANA-151)', () => {
  async function buildApp(fetch: HttpFetch): Promise<{ app: ReturnType<typeof Fastify>; db: DB }> {
    const db = freshDb();
    const llm = new LlmService(db, 'catalog-secret', fetch);
    llm.init({});
    const users = { audit: vi.fn() } as unknown as UsersRepo;
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (req) => {
      (req as unknown as { user: { email: string } }).user = { email: 'admin@x.ru' };
    });
    await app.register(llmRoutes, { prefix: '/api', llm, users });
    await app.ready();
    return { app, db };
  }

  it('serves the live OpenRouter catalog with per-1M prices', async () => {
    const { fetch } = fetchOf(OR_PAYLOAD);
    const { app, db } = await buildApp(fetch);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/ai/providers/openrouter/models',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { source: string; models: Array<Record<string, unknown>> };
      expect(body.source).toBe('live');
      expect(body.models).toHaveLength(4);
      expect(body.models[0]).toMatchObject({
        id: 'anthropic/claude-opus-4.5',
        name: 'Claude Opus 4.5',
        contextLength: 200_000,
        promptPricePerM: 5,
        completionPricePerM: 25,
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it('serves the static catalog for providers without a public endpoint', async () => {
    const { fetch, calls } = fetchOf(OR_PAYLOAD);
    const { app, db } = await buildApp(fetch);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/ai/providers/yandexgpt/models',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ source: 'static', models: staticCatalog('yandexgpt') });
      expect(calls()).toBe(0);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('unknown provider → 404', async () => {
    const { fetch } = fetchOf(OR_PAYLOAD);
    const { app, db } = await buildApp(fetch);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/ai/providers/nope/models',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
      db.close();
    }
  });
});
