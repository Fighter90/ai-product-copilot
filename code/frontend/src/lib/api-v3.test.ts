import { describe, it, expect, afterEach, vi } from 'vitest';
import { v3 } from './api-v3';

/** Фейковый fetch: возвращает JSON и записывает запросы. */
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
  ok: true,
  status: 200,
  json: async () => ({ echoed: init?.body ? JSON.parse(String(init.body)) : null, url: _url }),
}));

vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockClear();
});

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url: url as string,
    method: (init?.method ?? 'GET') as string,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
};

describe('v3 client: auth & users', () => {
  it('me / login / logout / updateMe / changePassword hit the right endpoints', async () => {
    await v3.me();
    expect(lastCall()).toMatchObject({ url: '/api/auth/me', method: 'GET' });

    await v3.login('a@b.ru', 'secret-pass');
    expect(lastCall()).toEqual({
      url: '/api/auth/login',
      method: 'POST',
      body: { email: 'a@b.ru', password: 'secret-pass' },
    });

    await v3.logout();
    expect(lastCall()).toEqual({ url: '/api/auth/logout', method: 'POST', body: {} });

    await v3.updateMe({ locale: 'en', name: 'Иван' });
    expect(lastCall()).toEqual({
      url: '/api/auth/me',
      method: 'PATCH',
      body: { locale: 'en', name: 'Иван' },
    });

    await v3.changePassword('old-pass-1', 'new-pass-12345');
    expect(lastCall()).toEqual({
      url: '/api/auth/password',
      method: 'POST',
      body: { current: 'old-pass-1', next: 'new-pass-12345' },
    });
  });

  it('users CRUD + audit', async () => {
    await v3.users();
    expect(lastCall()).toEqual({ url: '/api/users', method: 'GET', body: undefined });

    await v3.createUser({ email: 'x@y.ru', name: 'X', role: 'analyst' });
    expect(lastCall()).toEqual({
      url: '/api/users',
      method: 'POST',
      body: { email: 'x@y.ru', name: 'X', role: 'analyst' },
    });

    await v3.updateUser(7, { name: 'Y', isActive: false });
    expect(lastCall()).toEqual({
      url: '/api/users/7',
      method: 'PATCH',
      body: { name: 'Y', isActive: false },
    });

    await v3.resetPassword(7);
    expect(lastCall()).toEqual({ url: '/api/users/7/reset-password', method: 'POST', body: {} });

    await v3.audit(50);
    expect(lastCall().url).toBe('/api/admin/audit?limit=50');
    await v3.audit();
    expect(lastCall().url).toBe('/api/admin/audit?limit=200');
  });
});

describe('v3 client: AI providers', () => {
  it('providers / updateProvider / testProvider / aiUsage / availableProviders', async () => {
    await v3.providers();
    expect(lastCall()).toEqual({ url: '/api/admin/ai/providers', method: 'GET', body: undefined });

    await v3.updateProvider('anthropic', {
      enabled: true,
      secret: 'sk',
      extra: { a: 'b' },
      priority: 5,
    });
    expect(lastCall()).toEqual({
      url: '/api/admin/ai/providers/anthropic',
      method: 'PUT',
      body: { enabled: true, secret: 'sk', extra: { a: 'b' }, priority: 5 },
    });

    await v3.testProvider('gigachat');
    expect(lastCall()).toEqual({
      url: '/api/admin/ai/providers/gigachat/test',
      method: 'POST',
      body: {},
    });

    await v3.aiUsage();
    expect(lastCall().url).toBe('/api/admin/ai/usage');

    await v3.availableProviders();
    expect(lastCall().url).toBe('/api/ai/available');
  });
});

describe('v3 client: settings', () => {
  it('settings / saveSettings / rotateDatalensToken / clearMetrikaData', async () => {
    await v3.settings();
    expect(lastCall().url).toBe('/api/settings');

    await v3.saveSettings({ COUNTER_ID: 42, KPI_TARGET: '10' });
    expect(lastCall()).toEqual({
      url: '/api/settings',
      method: 'POST',
      body: { COUNTER_ID: 42, KPI_TARGET: '10' },
    });

    await v3.rotateDatalensToken();
    expect(lastCall()).toEqual({ url: '/api/settings/datalens-token', method: 'POST', body: {} });

    await v3.clearMetrikaData();
    expect(lastCall()).toEqual({
      url: '/api/data/metrika',
      method: 'DELETE',
      body: { confirm: 'УДАЛИТЬ' },
    });
  });
});

describe('v3 client: live mode (query-string encoding)', () => {
  it('builds ?from&to&test=1 and omits undefined/empty', async () => {
    await v3.liveSummary({ from: '2025-01-01', to: '2025-01-31', test: true });
    expect(lastCall().url).toBe('/api/live/summary?from=2025-01-01&to=2025-01-31&test=1');

    await v3.liveGoals({ test: false });
    expect(lastCall().url).toBe('/api/live/goals?test=0');

    await v3.liveGoal(11, {});
    expect(lastCall().url).toBe('/api/live/goals/11');

    await v3.liveFunnel({ from: '2025-01-01' });
    expect(lastCall().url).toBe('/api/live/funnel?from=2025-01-01');

    await v3.liveTable('sources', { goal: 77, test: true });
    expect(lastCall().url).toBe('/api/live/table/sources?test=1&goal=77');
  });

  it('ANA-75: strips UI-only fields (refetchInterval) from live URLs', async () => {
    const p = {
      from: '2025-01-01',
      to: '2025-01-31',
      test: false,
      refetchInterval: 60_000 as const,
    };
    await v3.liveSummary(p);
    expect(lastCall().url).toBe('/api/live/summary?from=2025-01-01&to=2025-01-31&test=0');
    await v3.liveGoals(p);
    expect(lastCall().url).toBe('/api/live/goals?from=2025-01-01&to=2025-01-31&test=0');
    await v3.liveGoal(11, p);
    expect(lastCall().url).toBe('/api/live/goals/11?from=2025-01-01&to=2025-01-31&test=0');
    await v3.liveFunnel(p);
    expect(lastCall().url).toBe('/api/live/funnel?from=2025-01-01&to=2025-01-31&test=0');
  });
});

describe('v3 client: help', () => {
  it('articles / article / search (encodeURIComponent) / ask', async () => {
    await v3.helpArticles('ru');
    expect(lastCall().url).toBe('/api/help/articles?lang=ru');

    await v3.helpArticle('start', 'en');
    expect(lastCall().url).toBe('/api/help/articles/start?lang=en');

    await v3.helpSearch('как войти&войти?', 'ru');
    expect(lastCall().url).toBe(
      `/api/help/search?lang=ru&q=${encodeURIComponent('как войти&войти?')}`,
    );

    await v3.ask('Как сменить пароль?', 'en');
    expect(lastCall()).toEqual({
      url: '/api/help/ask',
      method: 'POST',
      body: { question: 'Как сменить пароль?', lang: 'en' },
    });
  });
});

describe('v3 client: datalens & notifications', () => {
  it('datasets / datalensAdmin / requestDatalens / notifications / readNotifications', async () => {
    await v3.datasets();
    expect(lastCall().url).toBe('/api/integrations/datalens/datasets');

    await v3.datalensAdmin();
    expect(lastCall().url).toBe('/api/admin/integrations/datalens');

    await v3.requestDatalens('прошу подключить');
    expect(lastCall()).toEqual({
      url: '/api/integrations/datalens/request',
      method: 'POST',
      body: { note: 'прошу подключить' },
    });

    await v3.notifications();
    expect(lastCall().url).toBe('/api/notifications');

    await v3.readNotifications();
    expect(lastCall()).toEqual({ url: '/api/notifications/read', method: 'POST', body: {} });
  });
});
