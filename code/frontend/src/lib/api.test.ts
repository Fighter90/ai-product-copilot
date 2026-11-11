import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from './api';
import { v3 } from './api-v3';

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => impl(url, init)),
  );
}
function ok(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body, text: async () => '' };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('GETs health, hypotheses, decisions, b2b', async () => {
    mockFetch((url) => {
      if (url.endsWith('/health'))
        return ok({ status: 'ok', counterId: 1, metrikaTokenPresent: false });
      return ok([]);
    });
    expect((await api.health()).status).toBe('ok');
    expect(await api.hypotheses()).toEqual([]);
    expect(await api.decisions()).toEqual([]);
    expect(await api.b2b()).toEqual([]);
  });

  it('builds channel + UTM + goals query strings (with and without options)', async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      return ok([]);
    });
    await api.channels();
    await api.channels({ from: '2025-01-01', to: '2025-01-07' });
    await api.utm();
    await api.utm({ from: '2025-01-01', to: '2025-01-07' });
    await api.geoDevice();
    await api.geoDevice({ from: '2025-01-01', to: '2025-01-07' });
    await api.pages();
    await api.pages({ from: '2025-01-01', to: '2025-01-07' });
    await api.exitPages();
    await api.exitPages({ from: '2025-01-01', to: '2025-01-07' });
    await api.goals();
    await api.goals(true);
    await api.primaryGoal();
    await api.rawResponse(42);
    expect(calls[0]).toBe('/api/metrics/channels');
    expect(calls[1]).toContain('from=2025-01-01&to=2025-01-07');
    expect(calls[2]).toBe('/api/metrics/utm');
    expect(calls[3]).toContain('/api/metrics/utm?from=2025-01-01&to=2025-01-07');
    expect(calls[4]).toBe('/api/metrics/geo-device');
    expect(calls[5]).toContain('/api/metrics/geo-device?from=2025-01-01&to=2025-01-07');
    expect(calls[6]).toBe('/api/metrics/pages');
    expect(calls[7]).toContain('/api/metrics/pages?from=2025-01-01&to=2025-01-07');
    expect(calls[8]).toBe('/api/metrics/exit-pages');
    expect(calls[9]).toContain('/api/metrics/exit-pages?from=2025-01-01&to=2025-01-07');
    expect(calls[10]).toBe('/api/metrics/goals');
    expect(calls[11]).toContain('archived=true');
    expect(calls[12]).toBe('/api/metrics/primary-goal');
    expect(calls[13]).toBe('/api/metrics/raw/42');
  });

  it('POSTs create-hypothesis and sync with JSON bodies', async () => {
    const seen: RequestInit[] = [];
    mockFetch((url, init) => {
      if (init) seen.push(init);
      // ANA-133: insights POST returns a jobId and the client polls the job endpoint.
      if (url.endsWith('/report/insights')) return ok({ jobId: 'job-1' }, 202);
      if (url.includes('/report/ai-jobs/'))
        return ok({ id: 'job-1', kind: 'insights', status: 'done', result: { narrative: 'n' } });
      return ok({ id: 1 });
    });
    await api.createHypothesis({ title: 'x' } as never);
    await api.createDecision({ scope: 'd' } as never);
    await api.buildSnapshot({ from: 'a', to: 'b' });
    await api.generateReport({ snapshotId: 'x', format: 'docx' });
    await api.generateInsights('snap-1');
    await api.generateHypotheses('snap-2');
    await api.sync({ from: 'a', to: 'b', goalId: 80 });
    expect(seen[0]?.method).toBe('POST');
    expect(seen[1]?.method).toBe('POST');
    expect(seen[2]?.method).toBe('POST');
    expect(String(seen[3]?.body)).toContain('docx');
    expect(String(seen[4]?.body)).toContain('snap-1'); // insights body
    expect(String(seen[5]?.body)).toContain('snap-2'); // hypotheses body
    expect(String(seen[6]?.body)).toContain('goalId');
  });

  it('B2B mutations use the right method, path and body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, init });
      return ok({ id: 1 });
    });
    await api.createB2b({ company: 'A', tickets: 5, stage: 'lead', dateAdded: '2025-01-01' });
    await api.updateB2bStage({ id: 7, stage: 'paid', datePaid: '2025-01-05' });
    await api.removeB2b(7);
    expect(calls[0]).toMatchObject({ url: '/api/b2b', init: { method: 'POST' } });
    expect(calls[1]).toMatchObject({ url: '/api/b2b/7', init: { method: 'PATCH' } });
    expect(String(calls[1]?.init?.body)).toContain('paid');
    expect(calls[2]).toMatchObject({ url: '/api/b2b/7', init: { method: 'DELETE' } });
  });

  it('returns undefined for 204 and throws ApiError on non-2xx', async () => {
    mockFetch(() => ({ ok: true, status: 204, json: async () => ({}), text: async () => '' }));
    expect(await api.b2b()).toBeUndefined();

    mockFetch(() => ({ ok: false, status: 422, json: async () => ({}), text: async () => 'bad' }));
    await expect(api.hypotheses()).rejects.toBeInstanceOf(ApiError);
  });

  it('ANA-112: 429 on Metrika-backed paths dispatches pca:metrika-quota, throttled to one per 30 s', async () => {
    const w = window as unknown as { __pcaQuotaAt?: number };
    delete w.__pcaQuotaAt;
    const events = vi.fn();
    window.addEventListener('pca:metrika-quota', events);
    try {
      const r429 = { ok: false, status: 429, json: async () => ({}), text: async () => 'x' };
      mockFetch(() => r429);
      // All Metrika-backed surfaces: live reads, metrics reads, sync, admin goal management.
      await expect(v3.liveSummary({})).rejects.toBeInstanceOf(ApiError);
      await expect(api.channels()).rejects.toBeInstanceOf(ApiError);
      await expect(api.syncStatus()).rejects.toBeInstanceOf(ApiError);
      await expect(api.hypotheses()).rejects.toBeInstanceOf(ApiError); // non-Metrika path
      expect(events).toHaveBeenCalledTimes(1); // 3 in-scope hits collapsed by the 30 s throttle

      w.__pcaQuotaAt = Date.now() - 31_000; // throttle window elapsed → the next 429 fires again
      await expect(api.channels()).rejects.toBeInstanceOf(ApiError);
      expect(events).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('pca:metrika-quota', events);
      delete w.__pcaQuotaAt;
    }
  });

  it('ANA-112: 429 on non-Metrika endpoints (auth/help) does NOT dispatch the banner event', async () => {
    const w = window as unknown as { __pcaQuotaAt?: number };
    delete w.__pcaQuotaAt;
    const events = vi.fn();
    window.addEventListener('pca:metrika-quota', events);
    try {
      const r429 = { ok: false, status: 429, json: async () => ({}), text: async () => 'x' };
      mockFetch(() => r429);
      await expect(v3.login('a@b.c', 'pw')).rejects.toBeInstanceOf(ApiError);
      await expect(v3.helpArticles('ru')).rejects.toBeInstanceOf(ApiError);
      expect(events).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('pca:metrika-quota', events);
      delete w.__pcaQuotaAt;
    }
  });
});

describe('readableError', () => {
  it('replaces proxy HTML pages with a short message, keeps JSON bodies', async () => {
    const { readableError } = await import('./api');
    window.localStorage.setItem('pca.locale', 'ru');
    expect(
      readableError(504, '<html><head><title>504 Gateway Time-out</title></head></html>'),
    ).toMatch(/не ответил вовремя \(504\)/);
    expect(readableError(429, '<html>x</html>')).toMatch(/429/);
    expect(readableError(400, '{"error":"invalid body"}')).toBe('{"error":"invalid body"}');
    window.localStorage.setItem('pca.locale', 'en');
    expect(readableError(503, '<html/>')).toMatch(/temporarily unavailable \(503\)/);
  });
});

describe('AI background jobs (ANA-133)', () => {
  afterEach(() => {
    window.localStorage.removeItem('pca.locale');
    vi.useRealTimers();
  });

  it('generateInsights polls the background job until it is done', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST') return ok({ jobId: 'job-7' }, 202);
      if (calls.filter((c) => c.includes('/report/ai-jobs/')).length === 1)
        return ok({ id: 'job-7', kind: 'insights', status: 'running' });
      return ok({
        id: 'job-7',
        kind: 'insights',
        status: 'done',
        result: {
          narrative: 'готово',
          generatedBy: { provider: 'yandexgpt', providerName: 'YandexGPT', model: 'm', at: 'T' },
        },
      });
    });
    const pending = api.generateInsights('snap-1', 'yandexgpt');
    await vi.advanceTimersByTimeAsync(2000);
    const res = await pending;
    expect(res.narrative).toBe('готово');
    expect(res.generatedBy?.provider).toBe('yandexgpt');
    expect(calls[0]).toBe('POST /api/report/insights');
    expect(calls[1]).toBe('GET /api/report/ai-jobs/job-7');
    expect(calls[2]).toBe('GET /api/report/ai-jobs/job-7');
  });

  it('a failed job surfaces its message instead of hanging the caller', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return ok({ jobId: 'job-8' }, 202);
      return ok({ id: 'job-8', kind: 'insights', status: 'failed', error: 'no key' });
    });
    await expect(api.generateInsights('snap-1')).rejects.toThrow('no key');
  });

  it('a failed job without an error text falls back to a localized message', async () => {
    window.localStorage.setItem('pca.locale', 'ru');
    mockFetch((url, init) => {
      if (init?.method === 'POST') return ok({ jobId: 'job-8' }, 202);
      return ok({ id: 'job-8', kind: 'insights', status: 'failed' });
    });
    await expect(api.generateInsights('snap-1')).rejects.toThrow(/AI-генерация/);
  });

  it('an unknown job id (lost after a server restart) reports honest failure', async () => {
    window.localStorage.setItem('pca.locale', 'ru');
    mockFetch((url, init) => {
      if (init?.method === 'POST') return ok({ jobId: 'job-9' }, 202);
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    });
    await expect(api.generateInsights('snap-1')).rejects.toThrow(/прервана/);
  });

  it('a job that never finishes hits the poll cap with a localized timeout message', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('pca.locale', 'ru');
    mockFetch((url, init) => {
      if (init?.method === 'POST') return ok({ jobId: 'job-10' }, 202);
      return ok({ id: 'job-10', kind: 'insights', status: 'running' });
    });
    const pending = api.generateInsights('snap-1');
    const expectation = expect(pending).rejects.toThrow(/не завершилась/);
    // The cap (~400 polls × 2s) is comfortably above the documented 5–10 min generation.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await expectation;
  });

  it('a 429 busy start propagates as ApiError without any polling', async () => {
    mockFetch(() => ({
      ok: false,
      status: 429,
      json: async () => ({ error: 'busy', code: 'AI_BUSY' }),
      text: async () => '{"error":"busy"}',
    }));
    const err = await api.generateInsights('snap-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
  });

  it('generateHypotheses only starts the background job — no polling (the snapshot poll renders it)', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return ok({ jobId: 'job-11' }, 202);
    });
    await api.generateHypotheses('snap-2', 'gigachat');
    expect(calls).toEqual(['POST /api/report/hypotheses']);
  });
});
