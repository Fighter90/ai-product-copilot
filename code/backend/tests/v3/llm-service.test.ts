import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmService, chainAsAnthropicFetch, type ProviderSeeds } from '../../src/llm/service';
import { ProviderError, type CompletionRequest, type HttpFetch } from '../../src/llm/providers';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

const APP_SECRET = 'llm-test-secret';

/** fetch double: always a valid OpenRouter-style answer. */
const okFetch: HttpFetch = (async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { content: 'answer' } }], model: 'm' }),
})) as unknown as HttpFetch;

/** fetch double that always fails with an HTTP error. */
const failFetch: HttpFetch = (async () => ({
  ok: false,
  status: 500,
  text: async () => 'boom',
})) as unknown as HttpFetch;

let db: DB;
beforeEach(() => {
  db = freshDb();
});
/** Retries without real waiting. */
const NO_WAIT = { sleep: async () => {} };
const make = (fetchFn: HttpFetch = okFetch, now = () => new Date()) =>
  new LlmService(db, APP_SECRET, fetchFn, now, NO_WAIT);

describe('LlmService.init / list / available', () => {
  it('init creates one row per provider, seeded from env; list masks secrets', () => {
    const seeds: ProviderSeeds = {
      openrouter: { secret: 'sk-or-123456', model: 'anthropic/claude-sonnet-4.5' },
      yandexgpt: {
        secret: 'yandex-key-123',
        model: 'yandexgpt/latest',
        extra: { folderId: 'b1g' },
      },
    };
    const s = make();
    s.init(seeds);
    const list = s.list();
    expect(list).toHaveLength(4);
    const or = list.find((p) => p.id === 'openrouter')!;
    expect(or.enabled).toBe(true);
    expect(or.model).toBe('anthropic/claude-sonnet-4.5');
    expect(or.hasSecret).toBe(true);
    expect(or.secretMask).toBe('••••3456');
    expect(or.secretMask).not.toContain('sk-or');
    expect(or.updatedBy).toBe('env');
    expect(or.lastTest).toBeNull();
    const anthropic = list.find((p) => p.id === 'anthropic')!;
    expect(anthropic.enabled).toBe(false);
    expect(anthropic.hasSecret).toBe(false);
    const yandex = list.find((p) => p.id === 'yandexgpt')!;
    expect(yandex.extras).toEqual([{ key: 'folderId', label: expect.any(String), value: 'b1g' }]);
    // init is idempotent (INSERT OR IGNORE)
    s.init({});
    expect(s.list()).toHaveLength(4);
  });

  it('available() lists only enabled providers with a decrypted secret, in priority order', () => {
    const s = make();
    s.init({
      gigachat: { secret: 'giga-key-987', model: 'GigaChat-2-Pro' },
      openrouter: { secret: 'sk-or-123456', model: 'anthropic/claude-sonnet-4.5' },
    });
    expect(s.available().map((p) => p.id)).toEqual(['openrouter', 'gigachat']); // priority 10 < 40
  });
});

describe('LlmService.update', () => {
  const s = () => {
    const svc = make();
    svc.init({});
    return svc;
  };

  it('enables a provider and stores a trimmed encrypted secret', () => {
    const svc = s();
    const view = svc.update(
      'openrouter',
      { enabled: true, secret: '  sk-new-987654  ' },
      'admin@x.ru',
    );
    expect(view).toMatchObject({
      id: 'openrouter',
      enabled: true,
      hasSecret: true,
      secretMask: '••••7654',
      updatedBy: 'admin@x.ru',
    });
    const raw = (
      db.prepare("SELECT secret_enc FROM ai_providers WHERE id = 'openrouter'").get() as {
        secret_enc: string;
      }
    ).secret_enc;
    expect(raw).toMatch(/^v1:/);
  });

  it('secret: "" clears, undefined keeps, extra merges', () => {
    const svc = s();
    svc.update('yandexgpt', { secret: 'y-1', extra: { folderId: 'f1' } }, 'a@x.ru');
    svc.update('yandexgpt', { extra: { folderId: 'f2' } }, 'a@x.ru'); // keep secret, merge extra
    let view = svc.list().find((p) => p.id === 'yandexgpt')!;
    expect(view.hasSecret).toBe(true);
    expect(view.extras[0]!.value).toBe('f2');

    svc.update('yandexgpt', { secret: '' }, 'a@x.ru');
    view = svc.list().find((p) => p.id === 'yandexgpt')!;
    expect(view.hasSecret).toBe(false);
    expect(view.secretMask).toBe('');
  });

  it('unknown provider → undefined; model falls back to current on blank', () => {
    const svc = s();
    expect(svc.update('nonexistent' as 'anthropic', { enabled: true }, 'a@x.ru')).toBeUndefined();
    const before = svc.list().find((p) => p.id === 'gigachat')!.model;
    expect(svc.update('gigachat', { model: '  ' }, 'a@x.ru')!.model).toBe(before);
  });
});

describe('LlmService.complete', () => {
  /** Ответ зависит от провайдера: anthropic ждёт content-блоки, остальные — choices. */
  const byUrlFetch = (async (url: string) => ({
    ok: true,
    status: 200,
    text: async () =>
      url.includes('anthropic')
        ? JSON.stringify({ content: [{ type: 'text', text: 'answer' }], model: 'claude-x' })
        : JSON.stringify({ choices: [{ message: { content: 'answer' } }], model: 'm' }),
  })) as unknown as HttpFetch;

  const seeded = (fetchFn: HttpFetch) => {
    const svc = new LlmService(db, APP_SECRET, fetchFn, undefined, NO_WAIT);
    svc.init({
      openrouter: { secret: 'sk-or-1', model: 'm-or' },
      anthropic: { secret: 'sk-an-1', model: 'm-an' },
    });
    svc.update('anthropic', { priority: 5 }, 'a@x.ru'); // anthropic first
    return svc;
  };
  const creq: CompletionRequest = { system: 's', user: 'u' };

  it('uses the highest-priority available provider and records usage', async () => {
    const svc = seeded(byUrlFetch);
    const res = await svc.complete(creq, { purpose: 'test' });
    expect(res.provider).toBe('anthropic');
    expect(res.text).toBe('answer');
    const usage = svc.usage();
    expect(usage).toEqual([
      {
        provider: 'anthropic',
        calls: 1,
        failures: 0,
        outputChars: expect.any(Number),
        inputTokens: 0,
        outputTokens: 0,
      },
    ]);
  });

  it('auto falls back to the next provider on failure; all failures → ProviderError 502', async () => {
    const fetchFn = vi.fn((url: string) =>
      url.includes('anthropic')
        ? failFetch(url, undefined as never)
        : okFetch(url, undefined as never),
    ) as unknown as HttpFetch;
    const svc = seeded(fetchFn);
    const res = await svc.complete(creq, { purpose: 'test' });
    expect(res.provider).toBe('openrouter'); // fallback worked
    expect(
      svc
        .usage()
        .map((u) => u.provider)
        .sort(),
    ).toEqual(['anthropic', 'openrouter']);
    expect(svc.usage().find((u) => u.provider === 'anthropic')!.failures).toBe(1);

    const allBad = new LlmService(db, APP_SECRET, failFetch, undefined, NO_WAIT);
    allBad.init({
      openrouter: { secret: 'x1', model: 'm1' },
      anthropic: { secret: 'x2', model: 'm2' },
    });
    await expect(allBad.complete(creq, { purpose: 'test' })).rejects.toBeInstanceOf(ProviderError);
    await expect(allBad.complete(creq, { purpose: 'test' })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('Все провайдеры вернули ошибку'),
    });
  });

  it('no configured providers → ProviderError 503 with a human hint', async () => {
    const svc = make();
    svc.init({});
    await expect(svc.complete(creq, { purpose: 'test' })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('Нет настроенных AI-провайдеров'),
    });
    // Explicit choice without a secret → the same 503 naming the provider.
    await expect(svc.complete(creq, { purpose: 'test', choice: 'gigachat' })).rejects.toMatchObject(
      {
        status: 503,
      },
    );
  });

  it('an explicit choice does not fall back', async () => {
    const fetchFn = vi.fn((url: string) =>
      url.includes('anthropic')
        ? failFetch(url, undefined as never)
        : okFetch(url, undefined as never),
    ) as unknown as HttpFetch;
    const svc = seeded(fetchFn);
    await expect(
      svc.complete(creq, { purpose: 'test', choice: 'anthropic' }),
    ).rejects.toMatchObject({
      provider: 'anthropic',
      status: 502,
    });
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<
      [string]
    >;
    expect(calls.every(([u]) => u.includes('anthropic'))).toBe(true);
  });
});

describe('LlmService.test / usage', () => {
  it('test: no secret → ok:false "Ключ не задан"; success → ok:true with model in message', async () => {
    const svc = make();
    svc.init({});
    const noKey = await svc.test('openrouter', 'a@x.ru');
    expect(noKey.ok).toBe(false);
    expect(noKey.message).toBe('Ключ не задан');

    svc.update('openrouter', { secret: 'sk-or-1' }, 'a@x.ru');
    const ok = await svc.test('openrouter', 'a@x.ru');
    expect(ok.ok).toBe(true);
    expect(ok.message).toContain('OK');
    const row = db
      .prepare("SELECT last_test_ok, last_test_message FROM ai_providers WHERE id = 'openrouter'")
      .get() as { last_test_ok: number; last_test_message: string };
    expect(row.last_test_ok).toBe(1);
    // Both test calls (fail + ok) are recorded in ai_usage with purpose='test'.
    const u = svc.usage().find((x) => x.provider === 'openrouter')!;
    expect(u.calls).toBe(2);
    expect(u.failures).toBe(1);
  });

  it('test: provider failure → ok:false with the error message persisted', async () => {
    const svc = new LlmService(db, APP_SECRET, failFetch, undefined, NO_WAIT);
    svc.init({ anthropic: { secret: 'sk-an-1', model: 'm-an' } });
    const res = await svc.test('anthropic', 'a@x.ru');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('anthropic HTTP 500');
    expect(svc.usage().find((u) => u.provider === 'anthropic')!.failures).toBe(1);
  });

  it('unknown provider → ok:false "unknown provider"', async () => {
    const svc = make();
    svc.init({});
    expect(await svc.test('nonexistent' as 'anthropic', 'a@x.ru')).toMatchObject({
      ok: false,
      message: 'unknown provider',
    });
  });
});

describe('chainAsAnthropicFetch', () => {
  it('adapts an Anthropic-Messages body to the provider chain (success path)', async () => {
    const svc = make();
    svc.init({ openrouter: { secret: 'sk-or-1', model: 'm-or' } });
    const onResult = vi.fn();
    const fetchFn = chainAsAnthropicFetch(svc, { purpose: 'report', onResult });
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({
        system: 'sys-prompt',
        max_tokens: 555,
        messages: [{ content: 'user-prompt' }, { content: 'second' }],
      }),
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const payload = JSON.parse(await res.text());
    expect(payload).toEqual({
      content: [{ type: 'text', text: 'answer' }],
      model: 'm',
      stop_reason: 'end_turn',
    });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ text: 'answer' }));
  });

  it('maps a chain failure to ok:false with the ProviderError status', async () => {
    const svc = make(failFetch);
    svc.init({ openrouter: { secret: 'sk-or-1', model: 'm-or' } });
    const fetchFn = chainAsAnthropicFetch(svc, { purpose: 'report' });
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ messages: [{ content: 'x' }] }),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('Все провайдеры вернули ошибку');
  });
});
