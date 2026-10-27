import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, type Mock } from 'vitest';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/app';
import { UsersRepo } from '../../src/auth/users-repo';
import { AppSettings } from '../../src/settings/app-settings';
import { LlmService } from '../../src/llm/service';
import type { HttpFetch } from '../../src/llm/providers';
import { buildTestApp } from '../api/helpers';
import type { DB } from '../../src/db/connection';
import type { MetricsRepo } from '../../src/db/repositories/metrics-repo';
import type { SyncRunner } from '../../src/routes/sync';

/**
 * Full cabinet-mode app (registerAuth + every route): the server-side role guard is what protects
 * admin actions — the UI hiding a button is not a security boundary.
 */
let app: FastifyInstance;
let db: DB;
let settings: AppSettings;
let metrics: MetricsRepo;
let runSync: Mock<SyncRunner>;
let adminCookie: string;
let analystCookie: string;

// Built once (password hashing + plugin registration are slow); settings are reset per test.
beforeAll(async () => {
  const base = buildTestApp();
  await base.app.close();
  db = base.db;
  metrics = base.deps.metrics;
  const users = new UsersRepo(db);
  const admin = users.create({
    email: 'admin@x.ru',
    name: 'A',
    role: 'admin',
    password: 'admin-pass-123',
  });
  const analyst = users.create({
    email: 'analyst@x.ru',
    name: 'B',
    role: 'analyst',
    password: 'analyst-pass-12',
  });
  settings = new AppSettings(db, 'guard-test-secret', { COUNTER_ID: '100' });
  runSync = vi.fn<SyncRunner>().mockResolvedValue({
    goals: 0,
    resolvedGoalId: undefined,
    days: 0,
    channelRows: 0,
    utmRows: 0,
    geoDeviceRows: 0,
    pageRows: 0,
    exitPageRows: 0,
  });
  app = buildServer({
    ...base.deps,
    runSync,
    cabinet: {
      db,
      users,
      settings,
      llm: new LlmService(db, 'guard-test-secret', vi.fn() as unknown as HttpFetch),
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

beforeEach(() => {
  db.prepare('DELETE FROM app_settings').run();
  runSync.mockClear();
});

afterAll(async () => {
  await app.close();
  db.close();
});

const ADMIN_ONLY: Array<{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string }> = [
  { method: 'POST', url: '/api/sync' },
  { method: 'POST', url: '/api/%73ync' }, // percent-encoded path must not dodge the rule
  { method: 'POST', url: '/api/settings' },
  { method: 'POST', url: '/api/settings/refresh' },
  { method: 'POST', url: '/api/settings/datalens-token' },
  { method: 'DELETE', url: '/api/data/metrika' },
  { method: 'GET', url: '/api/admin/audit' },
  { method: 'GET', url: '/api/admin/ai/providers' },
  { method: 'PUT', url: '/api/admin/ai/providers/anthropic' },
  { method: 'POST', url: '/api/admin/ai/providers/anthropic/test' },
  { method: 'GET', url: '/api/admin/ai/usage' },
  { method: 'GET', url: '/api/admin/integrations/datalens' },
  { method: 'POST', url: '/api/admin/integrations/datalens/check' },
  { method: 'POST', url: '/api/admin/metrika/goals' },
  { method: 'POST', url: '/api/admin/metrika/goals/1/archive' },
  { method: 'POST', url: '/api/admin/metrika/goals/1/restore' },
  { method: 'GET', url: '/api/users' },
  { method: 'POST', url: '/api/users' },
  { method: 'PATCH', url: '/api/users/1' },
  { method: 'POST', url: '/api/users/1/reset-password' },
];

describe('cabinet role guard', () => {
  it.each(ADMIN_ONLY)('analyst → 403 ADMIN_ONLY on $method $url', async ({ method, url }) => {
    const res = await app.inject({
      method,
      url,
      headers: { cookie: analystCookie },
      payload: method === 'GET' ? undefined : { from: '2025-01-01', to: '2025-01-07' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden', code: 'ADMIN_ONLY' });
  });

  it('analyst cannot trigger a sync — the runner is never called', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { cookie: analystCookie },
      payload: { from: '2025-01-01', to: '2025-01-07' },
    });
    expect(runSync).not.toHaveBeenCalled();
  });

  it('anonymous → 401 on admin routes', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('analyst keeps read access and own-work routes', async () => {
    for (const url of ['/api/settings', '/api/metrics/channels', '/api/metrics/kpi-target']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie: analystCookie } });
      expect(res.statusCode, url).toBe(200);
    }
  });
});

describe('POST /api/sync honours the runtime GOAL_ID setting', () => {
  const sync = (payload: object) =>
    app.inject({ method: 'POST', url: '/api/sync', headers: { cookie: adminCookie }, payload });

  it('unset GOAL_ID → no goalId (auto-detect)', async () => {
    const res = await sync({ from: '2025-01-01', to: '2025-01-07' });
    expect(res.statusCode).toBe(200);
    expect(runSync).toHaveBeenCalledWith({ from: '2025-01-01', to: '2025-01-07' });
  });

  it('GOAL_ID saved by the admin is passed to the sync; 0 switches back to auto', async () => {
    settings.set('GOAL_ID', '123456', 'admin@x.ru');
    await sync({ from: '2025-01-01', to: '2025-01-07' });
    expect(runSync).toHaveBeenLastCalledWith({
      from: '2025-01-01',
      to: '2025-01-07',
      goalId: 123456,
    });
    settings.set('GOAL_ID', '0', 'admin@x.ru');
    await sync({ from: '2025-01-01', to: '2025-01-07' });
    expect(runSync).toHaveBeenLastCalledWith({ from: '2025-01-01', to: '2025-01-07' });
  });
});

describe('analyst-readable KPI target and pinned primary goal', () => {
  const get = (url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: analystCookie } });

  it('GET /api/metrics/kpi-target → 300 by default, the admin value once saved', async () => {
    expect((await get('/api/metrics/kpi-target')).json()).toEqual({ target: 300 });
    settings.set('KPI_TARGET', '450', 'admin@x.ru');
    expect((await get('/api/metrics/kpi-target')).json()).toEqual({ target: 450 });
    settings.set('KPI_TARGET', 'garbage', 'admin@x.ru');
    expect((await get('/api/metrics/kpi-target')).json()).toEqual({ target: 300 });
  });

  it('GET /api/metrics/primary-goal returns the pinned GOAL_ID goal when set', async () => {
    const goal = (id: number, name: string) => ({
      id,
      name,
      type: 'action',
      isB2b: false,
      isArchived: false,
      syncedAt: 'T',
    });
    metrics.upsertGoals([goal(1, 'Оплата билета'), goal(2, 'Заявка')]);
    expect((await get('/api/metrics/primary-goal')).json().id).toBe(1); // auto → purchase
    settings.set('GOAL_ID', '2', 'admin@x.ru');
    expect((await get('/api/metrics/primary-goal')).json().id).toBe(2);
    settings.set('GOAL_ID', '999', 'admin@x.ru'); // not synced → falls back to auto-detect
    expect((await get('/api/metrics/primary-goal')).json().id).toBe(1);
  });
});
