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
} from '../../src/integrations/datalens';
import { AppSettings } from '../../src/settings/app-settings';
import { UsersRepo } from '../../src/auth/users-repo';
import { freshDb } from '../db/helpers';
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
      'utm_daily',
      'pages_daily',
      'geo_device_daily',
      'b2b_deals',
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
