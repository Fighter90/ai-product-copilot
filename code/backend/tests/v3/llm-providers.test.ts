import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearGigaChatTokenCache,
  completeAnthropic,
  completeGigaChat,
  completeOpenRouter,
  completeYandexGpt,
  PROVIDER_IDS,
  PROVIDER_META,
  ProviderError,
  type HttpFetch,
  type ProviderConfig,
} from '../../src/llm/providers';

const cfg = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'openrouter',
  model: 'test-model',
  secret: 'sk-test',
  extra: {},
  ...over,
});

const req = { system: 'sys', user: 'usr' };

/** fetch double returning the given JSON with ok/status. */
const fetchOk = (body: unknown): HttpFetch =>
  (async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  })) as unknown as HttpFetch;

/** Ready response object (not a fetch fn) — for fetch doubles that pick a response per URL. */
const resOk = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

const fetchStatus = (status: number, body: string): HttpFetch =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  })) as unknown as HttpFetch;

describe('ProviderError', () => {
  it('retryable for network/429/5xx, not for 4xx', () => {
    expect(new ProviderError('anthropic', 0, 'x').retryable).toBe(true);
    expect(new ProviderError('anthropic', 429, 'x').retryable).toBe(true);
    expect(new ProviderError('anthropic', 502, 'x').retryable).toBe(true);
    expect(new ProviderError('anthropic', 400, 'x').retryable).toBe(false);
  });
});

describe('PROVIDER_META', () => {
  it('covers all four providers with models and docs', () => {
    expect(PROVIDER_IDS).toEqual(['openrouter', 'anthropic', 'yandexgpt', 'gigachat']);
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_META[id].models.length).toBeGreaterThan(0);
      expect(PROVIDER_META[id].docs).toMatch(/^https?:\/\//);
    }
    expect(PROVIDER_META.yandexgpt.extras.map((e) => e.key)).toEqual(['folderId']);
    expect(PROVIDER_META.gigachat.extras.map((e) => e.key)).toEqual(['scope']);
  });
});

describe('completeOpenRouter', () => {
  it('sends an OpenAI-compatible request and extracts the message', async () => {
    const fetchFn = vi.fn(
      fetchOk({ model: 'm/1', choices: [{ message: { content: ' привет ' } }] }),
    );
    const res = await completeOpenRouter(
      cfg(),
      { ...req, temperature: 0.7, maxTokens: 100 },
      fetchFn as unknown as HttpFetch,
    );
    expect(res).toEqual({
      text: 'привет',
      provider: 'openrouter',
      model: 'm/1',
      stopReason: 'end_turn',
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'test-model', max_tokens: 100, temperature: 0.7 });
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('maps HTTP errors and invalid JSON to ProviderError', async () => {
    await expect(completeOpenRouter(cfg(), req, fetchStatus(401, 'denied'))).rejects.toMatchObject({
      provider: 'openrouter',
      status: 401,
      message: expect.stringContaining('openrouter HTTP 401'),
    });
    await expect(completeOpenRouter(cfg(), req, fetchStatus(200, '<html>'))).rejects.toMatchObject({
      provider: 'openrouter',
      status: 502,
      message: expect.stringContaining('invalid JSON'),
    });
  });

  it('empty completion → 502; network failure → status 0', async () => {
    await expect(
      completeOpenRouter(cfg(), req, fetchOk({ choices: [{ message: { content: '  ' } }] })),
    ).rejects.toMatchObject({ status: 502 });
    const boom = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as HttpFetch;
    await expect(completeOpenRouter(cfg(), req, boom)).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('ECONNRESET'),
    });
  });

  it('abort (timeout) → status 0 with a timeout message', async () => {
    const aborts = (async (_url: string, init: { signal?: AbortSignal }) => {
      // Никогда не резолвится сам — вызывающий AbortController прервёт через таймер.
      return new Promise<never>((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    }) as unknown as HttpFetch;
    await expect(
      completeOpenRouter(cfg(), { ...req, timeoutMs: 20 }, aborts),
    ).rejects.toMatchObject({ status: 0, message: expect.stringContaining('timeout after 20 ms') });
  });
});

describe('completeAnthropic', () => {
  it('joins text blocks and omits temperature unless requested', async () => {
    const fetchFn = vi.fn(
      fetchOk({
        content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }],
      }),
    );
    const res = await completeAnthropic(
      cfg({ id: 'anthropic' }),
      req,
      fetchFn as unknown as HttpFetch,
    );
    expect(res).toEqual({
      text: 'a\nb',
      provider: 'anthropic',
      model: 'test-model',
      stopReason: 'end_turn',
    });
    const body = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(4000); // default

    await completeAnthropic(
      cfg({ id: 'anthropic' }),
      { ...req, temperature: 0.1 },
      fetchFn as unknown as HttpFetch,
    );
    expect(
      JSON.parse((fetchFn.mock.calls[1] as unknown as [string, { body: string }])[1].body)
        .temperature,
    ).toBe(0.1);
    expect(
      (fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1]
        .headers['x-api-key'],
    ).toBe('sk-test');
  });

  it('rejects an empty text result', async () => {
    await expect(
      completeAnthropic(cfg({ id: 'anthropic' }), req, fetchOk({ content: [] })),
    ).rejects.toMatchObject({
      provider: 'anthropic',
      status: 502,
    });
  });
});

describe('completeYandexGpt', () => {
  it('requires folderId', async () => {
    const fetchFn = vi.fn();
    await expect(
      completeYandexGpt(cfg({ id: 'yandexgpt' }), req, fetchFn as unknown as HttpFetch),
    ).rejects.toMatchObject({
      provider: 'yandexgpt',
      status: 400,
      message: expect.stringContaining('folderId'),
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends modelUri gpt://folder/model and extracts the alternative text', async () => {
    const fetchFn = vi.fn(
      fetchOk({ result: { alternatives: [{ message: { text: 'ответ' } }], modelVersion: 'v9' } }),
    );
    const res = await completeYandexGpt(
      cfg({ id: 'yandexgpt', model: 'yandexgpt/latest', extra: { folderId: 'b1gv87' } }),
      { ...req, maxTokens: 9000 }, // clamped to 7400
      fetchFn as unknown as HttpFetch,
    );
    expect(res).toEqual({
      text: 'ответ',
      provider: 'yandexgpt',
      model: 'yandexgpt/latest',
      stopReason: 'end_turn',
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toContain('foundationModels/v1/completion');
    expect(init.headers.authorization).toBe('Api-Key sk-test');
    expect(init.headers['x-folder-id']).toBe('b1gv87');
    const body = JSON.parse(init.body);
    expect(body.modelUri).toBe('gpt://b1gv87/yandexgpt/latest');
    expect(body.completionOptions.maxTokens).toBe('7400');
  });

  it('accepts an already-qualified gpt:// model unchanged', async () => {
    const fetchFn = vi.fn(fetchOk({ result: { alternatives: [{ message: { text: 'x' } }] } }));
    await completeYandexGpt(
      cfg({ id: 'yandexgpt', model: 'gpt://f/custom', extra: { folderId: 'f' } }),
      req,
      fetchFn as unknown as HttpFetch,
    );
    expect(
      JSON.parse((fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body).modelUri,
    ).toBe('gpt://f/custom');
  });
});

describe('completeGigaChat', () => {
  beforeEach(() => clearGigaChatTokenCache());

  const gigaCfg = () =>
    cfg({ id: 'gigachat', secret: 'basic-auth-key-123456', extra: { scope: 'GIGACHAT_API_B2B' } });
  const okChat = resOk({ model: 'GigaChat', choices: [{ message: { content: 'ок' } }] });
  const okOauth = resOk({ access_token: 'tok123', expires_at: Date.now() + 3600_000 });

  it('requests an OAuth token then posts the chat completion with it', async () => {
    const fetchFn = vi.fn((url: string) => (url.includes('/oauth') ? okOauth : okChat));
    const res = await completeGigaChat(gigaCfg(), req, fetchFn as unknown as HttpFetch);
    expect(res).toEqual({
      text: 'ок',
      provider: 'gigachat',
      model: 'GigaChat',
      stopReason: 'end_turn',
    });
    const calls = fetchFn.mock.calls as unknown as Array<
      [string, { headers: Record<string, string>; body: string }]
    >;
    expect(calls[0]![0]).toContain('/api/v2/oauth');
    expect(calls[0]![1].headers.authorization).toBe('Basic basic-auth-key-123456');
    expect(calls[0]![1].body).toBe('scope=GIGACHAT_API_B2B');
    expect(calls[1]![1].headers.authorization).toBe('Bearer tok123');
  });

  it('caches the token per (secret-tail, scope); expires_at fallback when absent', async () => {
    const fetchFn = vi.fn((url: string) =>
      url.includes('/oauth') ? resOk({ access_token: 'tok2' }) : okChat,
    );
    await completeGigaChat(gigaCfg(), req, fetchFn as unknown as HttpFetch);
    await completeGigaChat(gigaCfg(), req, fetchFn as unknown as HttpFetch);
    const oauthCalls = (fetchFn.mock.calls as unknown as Array<[string]>).filter(([u]) =>
      u.includes('/oauth'),
    );
    expect(oauthCalls).toHaveLength(1); // второй вызов взял токен из кэша
  });

  it('a missing access_token in the OAuth response → 502', async () => {
    await expect(
      completeGigaChat(gigaCfg(), req, fetchOk({ error: 'no token' })),
    ).rejects.toMatchObject({ provider: 'gigachat', status: 502 });
  });
});
