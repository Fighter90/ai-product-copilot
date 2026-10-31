import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  csvCell,
  dataLensRoutes,
  DATASETS,
  exportDataset,
  extractCode,
  toCsv,
  type DataLensDeps,
  type DataLensFetch,
  checkDataLensConnection,
} from '../../src/integrations/datalens';
import { registerAuth } from '../../src/auth/auth';
import { AppSettings } from '../../src/settings/app-settings';
import { UsersRepo } from '../../src/auth/users-repo';
import { HypothesesRepo } from '../../src/db/repositories/hypotheses-repo';
import { freshDb, validHypothesis } from '../db/helpers';
import type { DB } from '../../src/db/connection';

describe('csvCell (RFC 4180 + formula injection)', () => {
  it('plain values pass through', () => {
    expect(csvCell('abc')).toBe('abc');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(1.5)).toBe('1.5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('');
  });

  it('values starting with =, +, @, TAB get a guard apostrophe; CR also gets RFC quoting', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1+cmd')).toBe("'+1+cmd");
    expect(csvCell('@import')).toBe("'@import");
    expect(csvCell('\t=cmd')).toBe("'\t=cmd");
    // \r входит и в guard-, и в quoting-набор → апостроф + кавычки
    expect(csvCell('\r=cmd')).toBe('"\'\r=cmd"');
  });

  it('a leading dash is quoted only when not followed by a digit', () => {
    expect(csvCell('-10')).toBe('-10'); // число — безопасно
    expect(csvCell('-cmd /c')).toBe("'-cmd /c"); // команда — опасно
  });

  it('commas, quotes and newlines force RFC-4180 quoting with doubled quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    // 'a=b,c' начинается не с '=' → guard не нужен, только квотинг
    expect(csvCell('a=b,c')).toBe('"a=b,c"');
    expect(csvCell('=a,b')).toBe('"\'=a,b"'); // guard-апостроф + квотинг одновременно
  });
});

describe('toCsv', () => {
  const ds = DATASETS.find((d) => d.id === 'utm_daily')!;

  it('emits BOM + CRLF header in the requested language', () => {
    const csv = toCsv(ds, [['2025-01-01', 'google', 'cpc', 'brand', 10, 8, 2]], 'ru');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('utm_source');
    expect(csv.split('\r\n')[0]).toContain('Визиты');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('en header uses English labels; empty body has no trailing row', () => {
    const csv = toCsv(ds, [], 'en');
    expect(csv.split('\r\n')[0]).toContain('Visits');
    expect(csv.split('\r\n')).toHaveLength(2); // header + ''
  });

  it('body rows are csvCell-quoted', () => {
    const csv = toCsv(ds, [['2025-01-01', 'x,y', 'cpc', '=calc', 1, 1, 1]], 'en');
    expect(csv).toContain('"x,y"');
    expect(csv).toContain("'=calc");
  });
});

describe('exportDataset', () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => db.close());

  it('returns [] for a dataset whose table does not exist yet (synthetic dataset)', () => {
    const ghost = { ...DATASETS[0]!, id: 'ghost', sql: 'SELECT date FROM no_such_table' };
    expect(exportDataset(db, ghost, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it('runs a ranged query over real rows', () => {
    db.prepare(
      "INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate) VALUES ('2025-01-01','ad',100,80,10,30,5,5)",
    ).run();
    const ds = DATASETS.find((d) => d.id === 'channels_daily')!;
    const rows = exportDataset(db, ds, '2025-01-01', '2025-01-31') as unknown[][];
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('2025-01-01');
    expect(rows[0]![1]).toBe('ad');
    expect(Number(rows[0]![2])).toBe(100);
  });
});

describe('extractCode', () => {
  it('reads direct fields from an object payload', () => {
    expect(extractCode({ code: 'AB12' })).toBe('AB12');
    expect(extractCode({ confirmationCode: 'CD34' })).toBe('CD34');
    expect(extractCode({ verificationCode: 'EF56' })).toBe('EF56');
  });

  it('falls back to regex over text payloads (RU and EN)', () => {
    expect(extractCode('Ваш код подтверждения: AB12-CD34')).toBe('AB12-CD34');
    expect(extractCode('Your confirmation code: 123456')).toBe('123456');
    expect(extractCode({ message: 'код: XYZ789' })).toBe('XYZ789');
  });

  it('returns null when nothing looks like a code; never throws on odd payloads', () => {
    expect(extractCode({ foo: 'bar' })).toBeNull();
    expect(extractCode('совсем нет кода')).toBeNull();
    expect(extractCode(null)).toBeNull();
    expect(extractCode(undefined)).toBeNull();
    expect(extractCode(42)).toBeNull();
  });
});

describe('dataLensRoutes', () => {
  let db: DB;
  let app: FastifyInstance;
  let settings: AppSettings;
  let audit: ReturnType<typeof vi.fn>;
  let user: { id: number; name: string; role: 'admin' | 'analyst'; email: string };
  let fixedNow: Date;

  const build = async (over: Partial<DataLensDeps> = {}) => {
    db = freshDb();
    settings = new AppSettings(db, 'dl-secret', {});
    settings.set('DATALENS_WEBHOOK_TOKEN', 'webhook-token-123456', 'a@x.ru');
    fixedNow = new Date('2025-06-01T12:00:00Z');
    const deps: DataLensDeps = {
      db,
      settings,
      users: { audit } as unknown as UsersRepo,
      now: () => fixedNow,
      ...over,
    };
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (req) => {
      (req as unknown as { user?: typeof user }).user =
        req.method === 'POST' && req.url.includes('/webhook') ? undefined : (user as never);
    });
    await app.register(dataLensRoutes, { prefix: '/api', ...deps });
    await app.ready();
  };

  beforeEach(() => {
    audit = vi.fn();
    user = { id: 1, name: 'Юзер', role: 'analyst', email: 'u@x.ru' };
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('GET /datasets lists datasets with columns', async () => {
    await build();
    const res = await app.inject({ method: 'GET', url: '/api/integrations/datalens/datasets' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.map((d: { id: string }) => d.id)).toEqual([
      'channels_daily',
      'goals_daily',
      'goals_catalog',
      'funnel_daily',
      'utm_daily',
      'pages_daily',
      'geo_device_daily',
      'b2b_deals',
      'hypotheses',
    ]);
    expect(list[0].columns).toHaveLength(8);
  });

  it('GET /export/:id returns CSV with attachment headers; 404 for unknown id', async () => {
    await build();
    db.prepare(
      "INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate) VALUES ('2025-01-01','ad',10,8,0,0,2,20)",
    ).run();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/datalens/export/channels_daily.csv?from=2025-01-01&to=2025-01-31&lang=en',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      'channels_daily_2025-01-01_2025-01-31.csv',
    );
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    expect(audit).toHaveBeenCalledWith(user, 'datalens.export', 'channels_daily', {
      from: '2025-01-01',
      to: '2025-01-31',
      rows: 1,
    });

    expect(
      (await app.inject({ method: 'GET', url: '/api/integrations/datalens/export/nope' }))
        .statusCode,
    ).toBe(404);
  });

  it('GET /export/goals_catalog.csv: ticket_type/ticket_stage columns in the ru header (ANA-111)', async () => {
    await build();
    db.prepare(
      "INSERT INTO goals (id, name, type, is_b2b, is_archived, synced_at) VALUES (44, 'ticket_halloween', 'action', 0, 0, '2026-10-30T00:00:00Z')",
    ).run();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/datalens/export/goals_catalog.csv?lang=ru',
    });
    expect(res.statusCode).toBe(200);
    const [header, row] = res.body.split('\r\n');
    expect(header).toContain('Тариф билета');
    expect(header).toContain('Шаг (pick/buy/checkout)');
    expect(row).toContain('ticket,halloween,buy,0');
  });

  it('GET /export rejects a malformed range with 400', async () => {
    await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/datalens/export/utm_daily?from=01.2025&to=x',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid range');
  });

  it('webhook: wrong/short/absent token → 404 (constant-time compare)', async () => {
    await build();
    const url = (t: string) => `/api/integrations/datalens/webhook/${t}`;
    expect(
      (await app.inject({ method: 'POST', url: url('wrong-token-12345678'), payload: {} }))
        .statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'POST', url: url('short'), payload: {} })).statusCode).toBe(
      404,
    );

    // Empty configured token → also 404 even with an empty URL token.
    await build();
    settings.set('DATALENS_WEBHOOK_TOKEN', '', 'a@x.ru');
    expect((await app.inject({ method: 'POST', url: url(''), payload: {} })).statusCode).toBe(404);
  }, 30_000); // scrypt/ключи + загруженная машина: дефолтных 5 с мало

  it('webhook with the right token stores the event + admin notification (confirmation and notification kinds)', async () => {
    await build();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/integrations/datalens/webhook/webhook-token-123456',
      payload: { code: 'CONF-123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });

    const ok2 = await app.inject({
      method: 'POST',
      url: '/api/integrations/datalens/webhook/webhook-token-123456',
      payload: { alert: 'quota' },
    });
    expect(ok2.statusCode).toBe(200);

    const kinds = (
      db.prepare('SELECT kind, code FROM datalens_events ORDER BY id').all() as Array<{
        kind: string;
        code: string | null;
      }>
    ).map((r) => r.kind);
    expect(kinds).toEqual(['confirmation', 'notification']);
    const notes = db.prepare('SELECT kind, title FROM notifications ORDER BY id').all() as Array<{
      kind: string;
      title: string;
    }>;
    expect(notes.map((n) => n.kind)).toEqual(['datalens.confirmation', 'datalens.notification']);
    expect(notes[0]!.title).toContain('CONF-123');
    // received_at comes from the injected clock
    const evt = db.prepare('SELECT received_at FROM datalens_events ORDER BY id LIMIT 1').get() as {
      received_at: string;
    };
    expect(evt.received_at).toBe('2025-06-01T12:00:00.000Z');
  });

  it('GET /admin/integrations/datalens shows hasToken, events and lastCode', async () => {
    await build();
    await app.inject({
      method: 'POST',
      url: '/api/integrations/datalens/webhook/webhook-token-123456',
      payload: { code: 'ZZ99' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/admin/integrations/datalens' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasToken).toBe(true);
    expect(body.token).toBe('webhook-token-123456');
    expect(body.events).toHaveLength(1);
    expect(body.lastCode).toMatchObject({ code: 'ZZ99' });
  });

  it('POST /request: creates an admin notification + audit; 429 after 3 requests/hour', async () => {
    await build();
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/integrations/datalens/request',
        payload: { note: `n${i}` },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/integrations/datalens/request',
          payload: { note: 'n4' },
        })
      ).json().code,
    ).toBe('RATE_LIMITED');
    const notes = db
      .prepare("SELECT title, body FROM notifications WHERE kind = 'datalens.request'")
      .all() as Array<{ title: string; body: string }>;
    expect(notes).toHaveLength(3);
    expect(notes[0]!.title).toBe('Юзер просит подключить DataLens');
    expect(audit).toHaveBeenCalledWith(user, 'datalens.request', undefined, { note: 'n0' });

    // Час спустя лимит сбрасывается (инъекция времени).
    fixedNow = new Date(fixedNow.getTime() + 3_601_000);
    expect(
      (await app.inject({ method: 'POST', url: '/api/integrations/datalens/request', payload: {} }))
        .statusCode,
    ).toBe(200);
  });

  it('notifications: analyst sees only audience=all, admin sees all; /read marks per-user', async () => {
    await build();
    db.prepare(
      "INSERT INTO notifications (at, audience, kind, title, body) VALUES ('2025-01-01','admin','k','admin-note','')",
    ).run();
    db.prepare(
      "INSERT INTO notifications (at, audience, kind, title, body) VALUES ('2025-01-02','all','k','all-note','')",
    ).run();

    const analystView = (await app.inject({ method: 'GET', url: '/api/notifications' })).json();
    expect(analystView.map((n: { title: string }) => n.title)).toEqual(['all-note']);
    expect(analystView[0].read).toBe(false);
    expect(analystView[0].readBy).toBeUndefined();

    user = { ...user, role: 'admin' };
    const adminView = (await app.inject({ method: 'GET', url: '/api/notifications' })).json();
    expect(adminView.map((n: { title: string }) => n.title)).toEqual(['all-note', 'admin-note']);

    const read = await app.inject({ method: 'POST', url: '/api/notifications/read' });
    expect(read.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/api/notifications' })).json();
    expect(after.every((n: { read: boolean }) => n.read)).toBe(true);
    // idempotent: повторное чтение не задваивает id в read_by
    await app.inject({ method: 'POST', url: '/api/notifications/read' });
    const [row] = db
      .prepare('SELECT read_by FROM notifications ORDER BY id DESC LIMIT 1')
      .all() as Array<{ read_by: string }>;
    expect(JSON.parse(row!.read_by)).toEqual([1]);
  });
});

describe('POST /api/admin/integrations/datalens/check', () => {
  let db: DB;
  let app: FastifyInstance;
  let settings: AppSettings;
  let users: UsersRepo;
  let fetchMock: ReturnType<typeof vi.fn>;
  let adminCookie: string;
  let analystCookie: string;
  const url = '/api/admin/integrations/datalens/check';

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    });

  beforeEach(async () => {
    db = freshDb();
    settings = new AppSettings(db, 'dl-secret', {});
    users = new UsersRepo(db);
    users.create({ email: 'admin@x.ru', name: 'A', role: 'admin', password: 'admin-pass-123' });
    users.create({ email: 'an@x.ru', name: 'B', role: 'analyst', password: 'analyst-pass-12' });
    fetchMock = vi.fn();
    app = Fastify({ logger: false });
    // Real session guard: /api/admin/* must be admin-only.
    registerAuth(app, { users, cookieSecure: false, sessionDays: 1 });
    await app.register(dataLensRoutes, {
      prefix: '/api',
      db,
      settings,
      users,
      fetch: fetchMock as unknown as DataLensFetch,
    });
    await app.ready();
    adminCookie = `pca_session=${users.createSession(users.getByEmail('admin@x.ru')!.id, 1)}`;
    analystCookie = `pca_session=${users.createSession(users.getByEmail('an@x.ru')!.id, 1)}`;
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  const configure = () => {
    settings.set('DATALENS_ORG_ID', 'org-1', 'a@x.ru');
    settings.set('DATALENS_WORKBOOK_ID', 'wb-1', 'a@x.ru');
    settings.set('DATALENS_IAM_TOKEN', 'iam-secret-token-xyz', 'a@x.ru');
  };

  it('ok: calls getWorkbook with the DataLens contract and returns the title', async () => {
    configure();
    respond(200, { workbookId: 'wb-1', title: 'ProductCamp Analytics' });
    const res = await app.inject({ method: 'POST', url, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      message: expect.any(String),
      workbookTitle: 'ProductCamp Analytics',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe('https://api.datalens.tech/rpc/getWorkbook');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      authorization: 'Bearer iam-secret-token-xyz',
      'content-type': 'application/json',
      'x-dl-api-version': '2',
      'x-dl-org-id': 'org-1',
    });
    expect(JSON.parse(init.body)).toEqual({ workbookId: 'wb-1' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(res.body).not.toContain('iam-secret-token-xyz');
  });

  it('bad token: DataLens 401 → ok:false with a hint, token never echoed', async () => {
    configure();
    respond(401, { message: 'Unauthorized iam-secret-token-xyz' });
    const res = await app.inject({ method: 'POST', url, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.message).toContain('401');
    expect(res.body).not.toContain('iam-secret-token-xyz');
  });

  it('network failure → ok:false', async () => {
    configure();
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await app.inject({ method: 'POST', url, headers: { cookie: adminCookie } });
    expect(res.json()).toMatchObject({ ok: false });
  });

  it('missing config → 400 NOT_CONFIGURED listing missing keys; no HTTP call', async () => {
    settings.set('DATALENS_ORG_ID', 'org-1', 'a@x.ru');
    const res = await app.inject({ method: 'POST', url, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      ok: false,
      code: 'NOT_CONFIGURED',
      missing: ['DATALENS_WORKBOOK_ID', 'DATALENS_IAM_TOKEN'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Security pass v3.3.x: each check is an outbound HTTPS call (15s timeout) — rapid-fire
  // retries are throttled per admin (5/min), and a 429 never reaches the DataLens API.
  it('rate-limits rapid checks: 5/min per admin → 429 RATE_LIMITED, no extra HTTP calls', async () => {
    configure();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ title: 'wb' }),
    });
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url, headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const limited = await app.inject({ method: 'POST', url, headers: { cookie: adminCookie } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'too many requests', code: 'RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('analyst → 403, anonymous → 401 (check and webhook-token GET are admin-only)', async () => {
    configure();
    const a = await app.inject({ method: 'POST', url, headers: { cookie: analystCookie } });
    expect(a.statusCode).toBe(403);
    const g = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/datalens',
      headers: { cookie: analystCookie },
    });
    expect(g.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('checkDataLensConnection', () => {
  it('aborts after the timeout and reports it', async () => {
    const hang: DataLensFetch = (_u, init) =>
      new Promise((_r, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      );
    const r = await checkDataLensConnection(
      hang,
      { iamToken: 't', orgId: 'o', workbookId: 'w' },
      20,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Таймаут/);
  });
});

describe('datasets registry and exports (ANA-55)', () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => db.close());

  const seedChannels = () => {
    const ins = db.prepare(
      'INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate) VALUES (?, ?, ?, ?, 10, 30, ?, 5)',
    );
    ins.run('2025-01-01', 'ad', 100, 80, 5);
    ins.run('2025-01-01', 'tg', 50, 40, 10);
    ins.run('2025-01-02', 'ad', 60, 50, 3);
  };

  it('registry has goals_daily, funnel_daily and hypotheses; users columns are users_daily', () => {
    const ids = DATASETS.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['goals_daily', 'funnel_daily', 'hypotheses']));
    for (const ds of DATASETS.filter((d) => d.id.endsWith('_daily'))) {
      const users = ds.columns.find((col) => col.name.startsWith('users'));
      expect(users?.name).toBe('users_daily');
      // Honest-total rule stated right in the field dictionary (both languages).
      expect(users?.ru).toContain('не суммируется');
      expect(users?.en).toContain('do not sum');
    }
  });

  it('goals_daily aggregates the KPI goal per day across channels', () => {
    seedChannels();
    const ds = DATASETS.find((d) => d.id === 'goals_daily')!;
    const rows = exportDataset(db, ds, '2025-01-01', '2025-12-31') as unknown[][];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['2025-01-01', 150, 120, 15, 10]);
    expect(rows[1]).toEqual(['2025-01-02', 60, 50, 3, 5]);
  });

  it('goals_catalog derives event, group, ticket_type and ticket_stage from goal names (ANA-111)', () => {
    const ins = db.prepare(
      'INSERT INTO goals (id, name, type, is_b2b, is_archived, synced_at) VALUES (?, ?, ?, 0, ?, ?)',
    );
    ins.run(1, 'G-01 Увидел блок билетов (price_view)', 'action', 0, '2026-10-30T00:00:00Z');
    ins.run(
      2,
      'G-06 Выбор билета standard (ticket_pick_standard)',
      'action',
      0,
      '2026-10-30T00:00:00Z',
    );
    ins.run(3, 'G-12 Покупка max (ticket_buy_max)', 'action', 0, '2026-10-30T00:00:00Z');
    ins.run(4, 'ticket_halloween', 'action', 0, '2026-10-30T00:00:00Z'); // ANA-111: customer-named buy goal, no «buy» part
    ins.run(
      5,
      'G-16 Переход к оплате halloween (ticket_checkout_halloween)',
      'action',
      1,
      '2026-10-30T00:00:00Z',
    );
    ins.run(6, 'G-18 Заявка волонтёра (volunteer_apply)', 'action', 0, '2026-10-30T00:00:00Z');
    ins.run(7, 'Старая URL-цель', 'url', 1, '2026-10-30T00:00:00Z'); // non-action type → «other», no ticket labels
    const ds = DATASETS.find((d) => d.id === 'goals_catalog')!;
    const rows = exportDataset(db, ds, '2000-01-01', '2100-01-01') as unknown[][];
    expect(rows).toHaveLength(7);
    const byId = new Map(rows.map((r) => [r[0] as number, r]));
    // id, name, event, group, ticket_type, ticket_stage, archived
    expect(byId.get(1)).toEqual([
      1,
      'G-01 Увидел блок билетов (price_view)',
      'price_view',
      'funnel',
      null,
      null,
      0,
    ]);
    expect(byId.get(2)![3]).toBe('ticket');
    expect(byId.get(2)![4]).toBe('standard');
    expect(byId.get(2)![5]).toBe('pick');
    expect(byId.get(3)![4]).toBe('max');
    expect(byId.get(3)![5]).toBe('buy');
    // The bare customer-named goal: name doubles as the event, halloween «buy».
    expect(byId.get(4)).toEqual([
      4,
      'ticket_halloween',
      'ticket_halloween',
      'ticket',
      'halloween',
      'buy',
      0,
    ]);
    expect(byId.get(5)![4]).toBe('halloween');
    expect(byId.get(5)![5]).toBe('checkout');
    expect(byId.get(5)![6]).toBe(1); // archived flag passes through
    expect(byId.get(6)).toEqual([
      6,
      'G-18 Заявка волонтёра (volunteer_apply)',
      'volunteer_apply',
      'role',
      null,
      null,
      0,
    ]);
    expect(byId.get(7)).toEqual([7, 'Старая URL-цель', 'Старая URL-цель', 'other', null, null, 1]);
  });

  it('goals_catalog returns [] when the goals table is absent (no sync yet)', () => {
    db.exec('DROP TABLE goals');
    const ds = DATASETS.find((d) => d.id === 'goals_catalog')!;
    expect(exportDataset(db, ds, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it('funnel_daily joins Metrika days with manual B2B dates (no gaps in the day axis)', () => {
    seedChannels();
    db.prepare(
      "INSERT INTO b2b_manual (company, tickets, stage, amount_rub, date_added, date_paid) VALUES ('BigCorp', 4, 'paid', 1000, '2025-01-01', '2025-01-03')",
    ).run();
    db.prepare(
      "INSERT INTO b2b_manual (company, tickets, stage, amount_rub, date_added, date_paid) VALUES ('Small', 2, 'lead', 500, '2025-01-02', NULL)",
    ).run();
    const ds = DATASETS.find((d) => d.id === 'funnel_daily')!;
    const rows = exportDataset(db, ds, '2025-01-01', '2025-12-31') as unknown[][];
    expect(rows.map((r) => r[0])).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
    // visits, users_daily, applications, pipeline (unpaid, by added date), paid (by payment date).
    // BigCorp is already 'paid' → it leaves the pipeline and is counted on its PAYMENT date only.
    expect(rows[0]).toEqual(['2025-01-01', 150, 120, 15, 0, 0]);
    expect(rows[1]).toEqual(['2025-01-02', 60, 50, 3, 2, 0]);
    expect(rows[2]).toEqual(['2025-01-03', 0, 0, 0, 0, 4]);
  });

  it('funnel_daily returns [] when the manual pipeline table is absent', () => {
    db.exec('DROP TABLE b2b_manual');
    const ds = DATASETS.find((d) => d.id === 'funnel_daily')!;
    expect(exportDataset(db, ds, '2025-01-01', '2025-12-31')).toEqual([]);
  });

  it('hypotheses exports the ICE backlog sorted by score', () => {
    const repo = new HypothesesRepo(db);
    const strong = repo.create(validHypothesis({ impact: 9, ease: 9 }));
    repo.create(validHypothesis({ impact: 2, confidence: 2, ease: 2 }));
    const ds = DATASETS.find((d) => d.id === 'hypotheses')!;
    const rows = exportDataset(db, ds, '2000-01-01', '2100-01-01') as unknown[][];
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]).toBe(strong.id);
    expect(rows[0]![1]).toBe('define');
    expect(Number(rows[0]![11])).toBe(9 * 6 * 9);
    expect(Number(rows[1]![11])).toBe(2 * 2 * 2);
  });
});
