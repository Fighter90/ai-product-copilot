import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LlmService,
  PURPOSE_TIMEOUT_MS,
  chainAsAnthropicFetch,
  type ProviderSeeds,
} from '../../src/llm/service';
import {
  PROVIDERS,
  PROVIDER_IDS,
  ProviderError,
  clearGigaChatTokenCache,
  parseRetryAfter,
  redactSecrets,
  type HttpFetch,
  type ProviderId,
} from '../../src/llm/providers';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

interface Res {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}

const res = (status: number, body: unknown, headers: Record<string, string> = {}): Res => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
});

interface Fixture {
  /** Substring of the completion endpoint URL. */
  readonly match: string;
  readonly seed: { secret: string; model: string; extra?: Record<string, string> };
  readonly ok: unknown;
  readonly truncated: unknown;
}

const ADAPTERS: Record<ProviderId, Fixture> = {
  openrouter: {
    match: 'openrouter.ai',
    seed: { secret: 'sk-or-v1-0123456789abcdef0123456789', model: 'or-model' },
    ok: {
      model: 'or-model',
      choices: [{ message: { content: 'ответ' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    },
    truncated: {
      model: 'or-model',
      choices: [{ message: { content: 'обрезано' }, finish_reason: 'length' }],
    },
  },
  anthropic: {
    match: 'api.anthropic.com',
    seed: { secret: 'sk-ant-api03-SECRETsecret0123456789', model: 'claude-x' },
    ok: {
      content: [{ type: 'text', text: 'ответ' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 11, output_tokens: 22 },
    },
    truncated: { content: [{ type: 'text', text: 'обрезано' }], stop_reason: 'max_tokens' },
  },
  yandexgpt: {
    match: 'llm.api.cloud.yandex.net',
    seed: {
      secret: 'AQVN1abcdefghijklmnopqrstuvwxyz0123',
      model: 'yandexgpt/latest',
      extra: { folderId: 'b1gfolder' },
    },
    ok: {
      result: {
        alternatives: [{ message: { text: 'ответ' }, status: 'ALTERNATIVE_STATUS_FINAL' }],
        usage: { inputTextTokens: '11', completionTokens: '22', totalTokens: '33' },
      },
    },
    truncated: {
      result: {
        alternatives: [
          { message: { text: 'обрезано' }, status: 'ALTERNATIVE_STATUS_TRUNCATED_FINAL' },
        ],
      },
    },
  },
  gigachat: {
    match: 'gigachat.devices.sberbank.ru',
    seed: {
      secret: 'MDE5YTAwMDAtZmFrZS1jbGllbnQ6ZmFrZS1zZWNyZXQ=',
      model: 'GigaChat-2',
      extra: { scope: 'GIGACHAT_API_PERS' },
    },
    ok: {
      model: 'GigaChat-2',
      choices: [{ message: { content: 'ответ' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    },
    truncated: {
      model: 'GigaChat-2',
      choices: [{ message: { content: 'обрезано' }, finish_reason: 'length' }],
    },
  },
};

const fallbackOf = (id: ProviderId): ProviderId =>
  id === 'openrouter' ? 'anthropic' : 'openrouter';

let db: DB;
let sleep: ReturnType<typeof vi.fn>;
beforeEach(() => {
  db = freshDb();
  sleep = vi.fn(async () => {});
  clearGigaChatTokenCache();
});

/**
 * Service with `tested` first in the chain and a healthy fallback after it. `primary(n)` answers
 * the n-th (0-based) request to the tested provider's completion endpoint.
 */
function setup(
  tested: ProviderId,
  primary: (n: number, signal?: AbortSignal) => Res | Promise<Res>,
  opts: { withFallback?: boolean } = {},
) {
  const fallback = fallbackOf(tested);
  const calls = { primary: 0, fallback: 0 };
  const fetchFn = (async (url: string, init: { signal?: AbortSignal }) => {
    if (url.includes('ngw.devices.sberbank.ru')) {
      return res(200, { access_token: 'giga-access-token', expires_at: Date.now() + 3600_000 });
    }
    if (url.includes(ADAPTERS[tested].match)) return primary(calls.primary++, init.signal);
    if (url.includes(ADAPTERS[fallback].match)) {
      calls.fallback++;
      return res(200, ADAPTERS[fallback].ok);
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as HttpFetch;
  const svc = new LlmService(db, 'resilience-secret', fetchFn, undefined, { sleep });
  const seeds: ProviderSeeds = { [tested]: ADAPTERS[tested].seed };
  if (opts.withFallback ?? true) seeds[fallback] = ADAPTERS[fallback].seed;
  svc.init(seeds);
  svc.update(tested, { priority: 1 }, 'test');
  return { svc, calls, fallback };
}

const req = { system: 's', user: 'u' };

const usageRows = () =>
  db
    .prepare('SELECT provider, ok, error, input_tokens, output_tokens FROM ai_usage ORDER BY id')
    .all() as Array<{
    provider: string;
    ok: number;
    error: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
  }>;

/** fetch response that only settles when the caller's AbortController fires. */
const hang = (signal?: AbortSignal): Promise<Res> =>
  new Promise((_, reject) => {
    signal?.addEventListener('abort', () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });

describe.each(PROVIDER_IDS)('%s adapter through LlmService', (id) => {
  const fx = ADAPTERS[id];

  it('success: text, usage and stop_reason are returned and usage tokens stored', async () => {
    const { svc, calls } = setup(id, () => res(200, fx.ok));
    const out = await svc.complete(req, { purpose: 'test' });
    expect(out).toMatchObject({
      provider: id,
      text: 'ответ',
      stopReason: 'end_turn',
      usage: { inputTokens: 11, outputTokens: 22 },
    });
    expect(calls).toEqual({ primary: 1, fallback: 0 });
    expect(usageRows()).toEqual([
      { provider: id, ok: 1, error: null, input_tokens: 11, output_tokens: 22 },
    ]);
  });

  it('truncation maps to stop_reason max_tokens (and to the Anthropic envelope)', async () => {
    const { svc } = setup(id, () => res(200, fx.truncated));
    expect((await svc.complete(req, { purpose: 'test' })).stopReason).toBe('max_tokens');

    const fetchFn = chainAsAnthropicFetch(svc, { purpose: 'report-hypotheses' });
    const r = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ messages: [{ content: 'x' }] }),
    });
    const envelope = JSON.parse(await r.text());
    expect(envelope.stop_reason).toBe('max_tokens');
    expect(envelope.content[0].text).toBe('обрезано');
  });

  it('401: no retry, falls back to the next provider', async () => {
    const { svc, calls, fallback } = setup(id, () => res(401, { error: 'unauthorized' }));
    const out = await svc.complete(req, { purpose: 'test' });
    expect(out.provider).toBe(fallback);
    expect(calls).toEqual({ primary: 1, fallback: 1 });
    expect(sleep).not.toHaveBeenCalled();
    const rows = usageRows();
    expect(rows.map((r) => [r.provider, r.ok])).toEqual([
      [id, 0],
      [fallback, 1],
    ]);
    expect(rows[0]!.error).toContain('HTTP 401');
  });

  it('429: retries honouring Retry-After, then succeeds on the same provider', async () => {
    const { svc, calls } = setup(id, (n) =>
      n === 0
        ? res(429, 'slow down', { 'retry-after': '3' })
        : n === 1
          ? res(429, 'slow down', { 'retry-after': '60' }) // capped at 10 s
          : res(200, fx.ok),
    );
    const out = await svc.complete(req, { purpose: 'test' });
    expect(out.provider).toBe(id);
    expect(calls).toEqual({ primary: 3, fallback: 0 });
    expect(sleep.mock.calls).toEqual([[3000], [10_000]]);
    expect(usageRows()).toHaveLength(1);
  });

  it('5xx: exponential backoff, after 2 retries falls back to the next provider', async () => {
    const { svc, calls, fallback } = setup(id, () => res(503, 'unavailable'));
    const out = await svc.complete(req, { purpose: 'test' });
    expect(out.provider).toBe(fallback);
    expect(calls).toEqual({ primary: 3, fallback: 1 });
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it('timeout: not retried, falls back to the next provider', async () => {
    const { svc, calls, fallback } = setup(id, (_n, signal) => hang(signal));
    const out = await svc.complete({ ...req, timeoutMs: 20 }, { purpose: 'test' });
    expect(out.provider).toBe(fallback);
    expect(calls).toEqual({ primary: 1, fallback: 1 });
    expect(sleep).not.toHaveBeenCalled();
    expect(usageRows()[0]!.error).toContain('timeout after 20 ms');
  });

  it('never leaks the secret into thrown, stored or returned error text', async () => {
    const secret = fx.seed.secret;
    const echo = () =>
      res(
        401,
        `{"error":"invalid key ${secret}","echo":"Authorization: Bearer ${secret}","b":"Basic ${secret}"}`,
      );
    const { svc } = setup(id, echo, { withFallback: false });

    let thrown = '';
    try {
      await svc.complete(req, { purpose: 'test' });
    } catch (err) {
      thrown = (err as Error).message;
    }
    expect(thrown).toContain('HTTP 401');
    expect(thrown).not.toContain(secret);

    const chained = await chainAsAnthropicFetch(svc, { purpose: 'report' })('u', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ messages: [{ content: 'x' }] }),
    });
    expect(chained.ok).toBe(false);
    expect(await chained.text()).not.toContain(secret);

    const tested = await svc.test(id, 'admin@x.ru');
    expect(tested.ok).toBe(false);
    expect(tested.message).not.toContain(secret);

    const stored = JSON.stringify(
      db
        .prepare('SELECT error FROM ai_usage UNION ALL SELECT last_test_message FROM ai_providers')
        .all(),
    );
    expect(stored).toContain('HTTP 401');
    expect(stored).not.toContain(secret);
  });

  it('network error text containing the secret is redacted too', async () => {
    const secret = fx.seed.secret;
    const { svc } = setup(
      id,
      () => {
        throw new Error(`connect ECONNREFUSED key=${secret}`);
      },
      { withFallback: false },
    );
    const err = await svc.complete(req, { purpose: 'test' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toContain('ECONNREFUSED');
    expect((err as Error).message).not.toContain(secret);
    expect(JSON.stringify(usageRows())).not.toContain(secret);
  });
});

describe('PROVIDERS registry', () => {
  it('exposes an LlmProvider per id; test() sends a tiny probe', async () => {
    expect(Object.keys(PROVIDERS)).toEqual([...PROVIDER_IDS]);
    const fetchFn = vi.fn(async () => res(200, ADAPTERS.openrouter.ok));
    const out = await PROVIDERS.openrouter.test(
      { id: 'openrouter', model: 'm', secret: 'k', extra: {} },
      fetchFn as unknown as HttpFetch,
    );
    expect(out.text).toBe('ответ');
    const body = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body.max_tokens).toBe(20);
  });
});

describe('chainAsAnthropicFetch timeouts and usage', () => {
  it('report-hypotheses / report-decisions get 240 s; others keep the adapter default', async () => {
    expect(PURPOSE_TIMEOUT_MS['report-hypotheses']).toBe(240_000);
    expect(PURPOSE_TIMEOUT_MS['report-decisions']).toBe(240_000);
    const fetchFn = (async () => res(200, ADAPTERS.openrouter.ok)) as unknown as HttpFetch;
    const svc = new LlmService(db, 's', fetchFn, undefined, { sleep });
    svc.init({ openrouter: ADAPTERS.openrouter.seed });
    const spy = vi.spyOn(svc, 'complete');
    const body = JSON.stringify({ messages: [{ content: 'x' }] });
    const init = { method: 'POST', headers: {}, body };
    await chainAsAnthropicFetch(svc, { purpose: 'report-hypotheses' })('u', init);
    await chainAsAnthropicFetch(svc, { purpose: 'report-insights' })('u', init);
    await chainAsAnthropicFetch(svc, { purpose: 'report-insights', timeoutMs: 5000 })('u', init);
    expect(spy.mock.calls.map(([r]) => r.timeoutMs)).toEqual([240_000, undefined, 5000]);
  });

  it('passes usage through in the Anthropic envelope', async () => {
    const svc = new LlmService(
      db,
      's',
      (async () => res(200, ADAPTERS.openrouter.ok)) as unknown as HttpFetch,
      undefined,
      { sleep },
    );
    svc.init({ openrouter: ADAPTERS.openrouter.seed });
    const r = await chainAsAnthropicFetch(svc, { purpose: 'report' })('u', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ messages: [{ content: 'x' }] }),
    });
    expect(JSON.parse(await r.text())).toMatchObject({
      stop_reason: 'end_turn',
      usage: { input_tokens: 11, output_tokens: 22 },
    });
    expect(svc.usage()[0]).toMatchObject({ inputTokens: 11, outputTokens: 22 });
  });
});

describe('redactSecrets / parseRetryAfter', () => {
  it('redacts auth headers, known key prefixes, long base64 and exact secrets', () => {
    const out = redactSecrets(
      'Bearer abc.def-123 | Basic Zm9vOmJhcg== | Api-Key qwe | sk-ant-api03-xyz12345 | ' +
        'AQVNabc123 | y0_AgAAAAB123 | dGhpcyBpcyBhIGxvbmcgYmFzZTY0IHN0cmluZzEyMw== | short-secret!',
      ['short-secret!'],
    );
    expect(out).toBe('Bearer *** | Basic *** | Api-Key *** | *** | *** | *** | *** | ***');
  });

  it('keeps ordinary error text readable', () => {
    const text =
      'anthropic HTTP 401: {"type":"authentication_error","message":"invalid x-api-key"}';
    expect(redactSecrets(text)).toBe(text);
  });

  it('parses delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('garbage')).toBeUndefined();
    const now = Date.parse('2026-10-26T10:00:00Z');
    expect(parseRetryAfter('Mon, 26 Oct 2026 10:00:05 GMT', now)).toBe(5000);
  });
});

describe('network error diagnostics', () => {
  it('surfaces the TLS cause code (e.g. missing Russian Trusted Root CA for GigaChat)', async () => {
    const tls = (async () => {
      const e = new TypeError('fetch failed') as TypeError & { cause?: unknown };
      e.cause = { code: 'SELF_SIGNED_CERT_IN_CHAIN' };
      throw e;
    }) as unknown as HttpFetch;
    await expect(
      PROVIDERS.gigachat.complete(
        { id: 'gigachat', model: 'GigaChat-2', secret: 'k'.repeat(10), extra: {} },
        req,
        tls,
      ),
    ).rejects.toMatchObject({
      status: 0,
      message: 'gigachat: fetch failed (SELF_SIGNED_CERT_IN_CHAIN)',
    });
  });
});
