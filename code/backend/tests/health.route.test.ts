import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/app';
import { UsersRepo } from '../src/auth/users-repo';
import { AppSettings } from '../src/settings/app-settings';
import { LlmService } from '../src/llm/service';
import type { HttpFetch } from '../src/llm/providers';
import { buildTestApp } from './api/helpers';

// Legacy app (no cabinet → no auth): the historical payload is kept for local monitoring.
const legacy = buildTestApp();
afterAll(async () => {
  await legacy.app.close();
  legacy.db.close();
});

describe('GET /api/health (legacy, no auth)', () => {
  it('returns a 200 ok payload and keeps the configuration fields', async () => {
    const res = await legacy.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      service: string;
      counterId: number;
      metrikaTokenPresent: boolean;
    };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('productcamp-analytics-backend');
    expect(typeof body.counterId).toBe('number');
    expect(typeof body.metrikaTokenPresent).toBe('boolean');
  });

  it('is mounted under /api (bare /health is 404)', async () => {
    const res = await legacy.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(404);
  });
});

// Cabinet app (auth registered): configuration is admin-session-only (REG-18).
describe('GET /api/health (cabinet)', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let analystCookie: string;

  const configFields = (body: Record<string, unknown>) => ({
    counterId: 'counterId' in body,
    metrikaTokenPresent: 'metrikaTokenPresent' in body,
  });

  beforeAll(async () => {
    const base = buildTestApp();
    await base.app.close();
    const db = base.db;
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
    const settings = new AppSettings(db, 'health-test-secret', { COUNTER_ID: '100' });
    app = buildServer({
      ...base.deps,
      cabinet: {
        db,
        users,
        settings,
        llm: new LlmService(db, 'health-test-secret', vi.fn() as unknown as HttpFetch),
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

  afterAll(async () => {
    await app.close();
  });

  it('hides counterId/metrikaTokenPresent from anonymous callers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(configFields(body)).toEqual({ counterId: false, metrikaTokenPresent: false });
  });

  it('hides the fields from an authenticated analyst', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { cookie: analystCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(configFields(res.json() as Record<string, unknown>)).toEqual({
      counterId: false,
      metrikaTokenPresent: false,
    });
  });

  it('shows counterId/metrikaTokenPresent only to an admin session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { counterId: number; metrikaTokenPresent: boolean };
    expect(body.counterId).toBe(100);
    expect(body.metrikaTokenPresent).toBe(false);
  });
});
