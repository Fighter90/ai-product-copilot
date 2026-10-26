import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { appSettingsRoutes } from '../../src/settings/routes';
import { AppSettings } from '../../src/settings/app-settings';
import { UsersRepo } from '../../src/auth/users-repo';
import { decryptSecret } from '../../src/security/crypto';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

const APP_SECRET = 'settings-routes-secret';

let db: DB;
let app: FastifyInstance;
let settings: AppSettings;
let users: UsersRepo;
let adminCookie: string;
let analystCookie: string;
let onChange: Mock<() => void>;

beforeEach(async () => {
  db = freshDb();
  settings = new AppSettings(db, APP_SECRET, { COUNTER_ID: '100' });
  users = new UsersRepo(db);
  users.create({ email: 'admin@x.ru', name: 'A', role: 'admin', password: 'admin-pass-123' });
  users.create({ email: 'analyst@x.ru', name: 'B', role: 'analyst', password: 'analyst-pass-12' });
  onChange = vi.fn();
  app = Fastify({ logger: false });
  // Guard-хук воспроизводим вручную: appSettingsRoutes ждёт req.user (см. registerAuth).
  app.addHook('onRequest', async (req) => {
    const cookie = (req.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('pca_session='));
    if (cookie) req.user = users.userBySession(cookie.split('=')[1] ?? '');
  });
  await app.register(appSettingsRoutes, { prefix: '/api', settings, users, db, onChange });
  await app.ready();
  const login = async (email: string) => ({
    token: users.createSession(users.getByEmail(email)!.id, 1),
  });
  adminCookie = `pca_session=${(await login('admin@x.ru')).token}`;
  analystCookie = `pca_session=${(await login('analyst@x.ru')).token}`;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('GET /api/settings', () => {
  it('returns the masked view (secret never in plaintext)', async () => {
    settings.set('YANDEX_OAUTH_TOKEN', 'plain-oauth-token', 'a@x.ru');
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: analystCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.YANDEX_OAUTH_TOKEN).toEqual({ value: '••••oken', isSecret: true, source: 'db' });
    expect(res.body).not.toContain('plain-oauth-token');
    expect(body.COUNTER_ID).toEqual({ value: '100', isSecret: false, source: 'env' });
  });
});

describe('POST /api/settings', () => {
  it('saves values, audits the change and calls onChange', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { cookie: adminCookie },
      payload: { COUNTER_ID: 555, KPI_TARGET: '12.5' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: ['COUNTER_ID', 'KPI_TARGET'] });
    expect(settings.getNumber('COUNTER_ID')).toBe(555);
    expect(onChange).toHaveBeenCalledTimes(1);
    const audit = users.listAudit(1)[0]!;
    expect(audit).toMatchObject({ action: 'settings.update', target: 'COUNTER_ID,KPI_TARGET' });
  });

  it('a masked value (••••…) means "keep" and is not saved', async () => {
    settings.set('YANDEX_OAUTH_TOKEN', 'real-secret-value', 'a@x.ru');
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { cookie: adminCookie },
      payload: { YANDEX_OAUTH_TOKEN: '••••alue' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toEqual([]);
    expect(settings.get('YANDEX_OAUTH_TOKEN')).toBe('real-secret-value');
    expect(onChange).toHaveBeenCalledTimes(1); // пустой patch всё равно триггерит refresh
  });

  it('unknown keys are rejected with 400 BAD_INPUT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { cookie: adminCookie },
      payload: { NOT_A_KEY: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_INPUT');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the route itself trusts the global session guard for roles (defence lives in registerAuth)', async () => {
    // В проде POST /api/settings запрещён аналитику глобальным guard'ом (requiresAdmin);
    // здесь изолированно проверяем, что route корректно работает, если guard пропустил запрос.
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { cookie: analystCookie },
      payload: { COUNTER_ID: 1 },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/settings/datalens-token', () => {
  it('rotates the webhook token, stores it encrypted and audits', async () => {
    settings.set('DATALENS_WEBHOOK_TOKEN', 'old-token-1234567890', 'a@x.ru');
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/datalens-token',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(token).not.toBe('old-token-1234567890');
    expect(settings.get('DATALENS_WEBHOOK_TOKEN')).toBe(token);
    // Stored encrypted, never plaintext.
    const raw = (
      db.prepare("SELECT value FROM app_settings WHERE key = 'DATALENS_WEBHOOK_TOKEN'").get() as {
        value: string;
      }
    ).value;
    expect(raw).toMatch(/^v1:/);
    expect(decryptSecret(raw, APP_SECRET)).toBe(token);
    expect(users.listAudit(1)[0]!.action).toBe('datalens.token_rotated');
  });
});

describe('DELETE /api/data/metrika', () => {
  it('requires the literal confirmation word', async () => {
    const no = await app.inject({
      method: 'DELETE',
      url: '/api/data/metrika',
      headers: { cookie: adminCookie },
      payload: { confirm: 'удалить' },
    });
    expect(no.statusCode).toBe(400);
    expect(no.json().code).toBe('CONFIRM');

    const yes = await app.inject({
      method: 'DELETE',
      url: '/api/data/metrika',
      headers: { cookie: adminCookie },
      payload: { confirm: 'УДАЛИТЬ' },
    });
    expect(yes.statusCode).toBe(200);
    expect(yes.json()).toEqual({ ok: true });
    expect(users.listAudit(1)[0]!.action).toBe('data.clear_metrika');
  });

  it('clears cached metrika tables but leaves users/settings intact', async () => {
    db.prepare(
      "INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate) VALUES ('2025-01-01', 'ad', 1, 1, 0, 0, 0, 0)",
    ).run();
    settings.set('COUNTER_ID', '42', 'a@x.ru');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/data/metrika',
      headers: { cookie: adminCookie },
      payload: { confirm: 'УДАЛИТЬ' },
    });
    expect(res.statusCode).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS n FROM channel_stats').get() as { n: number }).n).toBe(
      0,
    );
    expect(settings.getNumber('COUNTER_ID')).toBe(42);
    expect(users.count()).toBe(2);
  });
});
