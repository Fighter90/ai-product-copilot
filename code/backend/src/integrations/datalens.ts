import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db/connection';
import type { AppSettings } from '../settings/app-settings';
import type { UsersRepo } from '../auth/users-repo';

/** Per-user rate-limit store for «запросить DataLens» (userId → timestamps). */
const dlRequests = new Map<number, number[]>();

/**
 * Yandex DataLens integration:
 *  - export: flat, typed CSV datasets (UTF-8 with BOM, comma separator) ready for the DataLens
 *    "Files" connection; one dataset = one table, with a field dictionary;
 *  - webhook receiver: DataLens sends a confirmation code and alert notifications to
 *    POST /api/integrations/datalens/webhook/:token — shown to admins in the cabinet.
 */

export interface DatasetColumn {
  readonly name: string;
  readonly type: 'date' | 'string' | 'integer' | 'float';
  readonly ru: string;
  readonly en: string;
}

export interface Dataset {
  readonly id: string;
  readonly ru: string;
  readonly en: string;
  readonly columns: DatasetColumn[];
  /** SQL with optional :from / :to bindings. Columns must match `columns` order. */
  readonly sql: string;
  readonly ranged: boolean;
}

const c = (name: string, type: DatasetColumn['type'], ru: string, en: string): DatasetColumn => ({
  name,
  type,
  ru,
  en,
});

export const DATASETS: Dataset[] = [
  {
    id: 'channels_daily',
    ru: 'Каналы по дням',
    en: 'Channels by day',
    ranged: true,
    columns: [
      c('date', 'date', 'Дата', 'Date'),
      c('channel', 'string', 'Канал', 'Channel'),
      c('visits', 'integer', 'Визиты', 'Visits'),
      c('users', 'integer', 'Посетители', 'Users'),
      c('bounce_rate', 'float', 'Отказы, %', 'Bounce rate, %'),
      c('avg_duration_sec', 'float', 'Ср. длительность, с', 'Avg duration, s'),
      c('orders', 'integer', 'Заказы (цель KPI)', 'Orders (KPI goal)'),
      c('conversion_rate', 'float', 'Конверсия, %', 'Conversion, %'),
    ],
    sql: `SELECT date, channel, SUM(visits), SUM(users),
            ROUND(SUM(bounce_rate * visits) / MAX(SUM(visits), 1) * 100, 2),
            ROUND(SUM(avg_duration * visits) / MAX(SUM(visits), 1), 1),
            SUM(goal_reaches),
            ROUND(SUM(goal_reaches) * 100.0 / MAX(SUM(visits), 1), 3)
          FROM channel_stats WHERE date BETWEEN :from AND :to GROUP BY date, channel ORDER BY date, channel`,
  },
  {
    id: 'utm_daily',
    ru: 'UTM по дням',
    en: 'UTM by day',
    ranged: true,
    columns: [
      c('date', 'date', 'Дата', 'Date'),
      c('utm_source', 'string', 'utm_source', 'utm_source'),
      c('utm_medium', 'string', 'utm_medium', 'utm_medium'),
      c('utm_campaign', 'string', 'utm_campaign', 'utm_campaign'),
      c('visits', 'integer', 'Визиты', 'Visits'),
      c('users', 'integer', 'Посетители', 'Users'),
      c('orders', 'integer', 'Заказы', 'Orders'),
    ],
    sql: `SELECT date, utm_source, utm_medium, utm_campaign, visits, users, goal_reaches
          FROM utm_stats WHERE date BETWEEN :from AND :to ORDER BY date, visits DESC`,
  },
  {
    id: 'pages_daily',
    ru: 'Страницы входа по дням',
    en: 'Entry pages by day',
    ranged: true,
    columns: [
      c('date', 'date', 'Дата', 'Date'),
      c('page', 'string', 'Страница', 'Page'),
      c('visits', 'integer', 'Визиты', 'Visits'),
      c('users', 'integer', 'Посетители', 'Users'),
      c('bounce_rate', 'float', 'Отказы, %', 'Bounce rate, %'),
      c('orders', 'integer', 'Заказы', 'Orders'),
    ],
    sql: `SELECT date, page, visits, users, ROUND(bounce_rate * 100, 2), goal_reaches
          FROM page_stats WHERE date BETWEEN :from AND :to ORDER BY date, visits DESC`,
  },
  {
    id: 'geo_device_daily',
    ru: 'Гео и устройства по дням',
    en: 'Geo and devices by day',
    ranged: true,
    columns: [
      c('date', 'date', 'Дата', 'Date'),
      c('country', 'string', 'Страна', 'Country'),
      c('device', 'string', 'Устройство', 'Device'),
      c('visits', 'integer', 'Визиты', 'Visits'),
      c('users', 'integer', 'Посетители', 'Users'),
      c('orders', 'integer', 'Заказы', 'Orders'),
    ],
    sql: `SELECT date, country, device, visits, users, goal_reaches
          FROM geo_device_stats WHERE date BETWEEN :from AND :to ORDER BY date, visits DESC`,
  },
  {
    id: 'b2b_deals',
    ru: 'B2B-сделки',
    en: 'B2B deals',
    ranged: false,
    columns: [
      c('company', 'string', 'Компания', 'Company'),
      c('tickets', 'integer', 'Билеты', 'Tickets'),
      c('stage', 'string', 'Этап', 'Stage'),
      c('amount_rub', 'float', 'Сумма, ₽', 'Amount, RUB'),
      c('date_added', 'date', 'Дата добавления', 'Added'),
      c('date_paid', 'date', 'Дата оплаты', 'Paid'),
    ],
    sql: `SELECT company, tickets, stage, amount_rub, substr(date_added, 1, 10), substr(date_paid, 1, 10)
          FROM b2b_manual ORDER BY date_added`,
  },
];

/** RFC 4180 CSV cell, hardened against spreadsheet formula injection: values coming from
 *  site visitors (utm_*, URLs) must not execute as =.../ +.../ @... formulas in Excel/Sheets. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Prefix a guard apostrophe; '-' is only dangerous when NOT followed by a digit.
  if (/^[=+@\t\r]|^-(?!\d)/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render rows to CSV with a header row (column names in the chosen language). */
export function toCsv(ds: Dataset, rows: unknown[][], lang: 'ru' | 'en'): string {
  const header = ds.columns.map((col) => csvCell(lang === 'ru' ? col.ru : col.en)).join(',');
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return `\uFEFF${header}\r\n${body}${body ? '\r\n' : ''}`;
}

export function exportDataset(db: DB, ds: Dataset, from: string, to: string): unknown[][] {
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name),
  );
  const table = /FROM\s+(\w+)/i.exec(ds.sql)?.[1];
  if (table && !tables.has(table)) return [];
  const stmt = db.prepare(ds.sql).raw(true);
  return (ds.ranged ? stmt.all({ from, to }) : stmt.all()) as unknown[][];
}

/** Minimal fetch contract used for the DataLens Public API (injectable in tests). */
export type DataLensFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** DataLens Public API base (same contract as scripts/push-datalens.mjs). */
export const DATALENS_API_BASE = 'https://api.datalens.tech/rpc';
const DATALENS_CHECK_TIMEOUT_MS = 15_000;

export interface DataLensCheckResult {
  readonly ok: boolean;
  readonly message: string;
  readonly workbookTitle?: string;
}

/**
 * Verify DataLens access: POST /rpc/getWorkbook with the IAM token and org id.
 * Never includes the token in the returned message or in logs.
 */
export async function checkDataLensConnection(
  fetchImpl: DataLensFetch,
  cfg: { iamToken: string; orgId: string; workbookId: string },
  timeoutMs = DATALENS_CHECK_TIMEOUT_MS,
): Promise<DataLensCheckResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${DATALENS_API_BASE}/getWorkbook`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.iamToken}`,
        'content-type': 'application/json',
        'x-dl-api-version': '2',
        'x-dl-org-id': cfg.orgId,
      },
      body: JSON.stringify({ workbookId: cfg.workbookId }),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const hint =
        res.status === 401
          ? 'IAM-токен недействителен или истёк (живёт ≤12 ч)'
          : res.status === 403
            ? 'нет доступа: проверьте Org ID и роль в организации DataLens'
            : res.status === 404
              ? 'воркбук не найден: проверьте Workbook ID'
              : 'ошибка DataLens API';
      return { ok: false, message: `HTTP ${res.status}: ${hint}` };
    }
    let title: string | undefined;
    try {
      const j = JSON.parse(text) as { title?: unknown; workbook?: { title?: unknown } };
      const t = j.title ?? j.workbook?.title;
      if (typeof t === 'string') title = t;
    } catch {
      /* non-JSON body — still a successful response */
    }
    return { ok: true, message: 'Подключение к DataLens работает', workbookTitle: title };
  } catch (err) {
    const aborted = (err as { name?: string }).name === 'AbortError';
    return {
      ok: false,
      message: aborted ? 'Таймаут запроса к DataLens (15 с)' : 'Сеть: DataLens API недоступен',
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface DataLensDeps {
  readonly db: DB;
  readonly settings: AppSettings;
  readonly users: UsersRepo;
  readonly now?: () => Date;
  /** HTTP client for the DataLens Public API; defaults to global fetch. */
  readonly fetch?: DataLensFetch;
}

/** Extract a confirmation code from an arbitrary DataLens webhook payload. */
export function extractCode(payload: unknown): string | null {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  const direct =
    (payload &&
      typeof payload === 'object' &&
      ((payload as Record<string, unknown>).code ??
        (payload as Record<string, unknown>).confirmationCode ??
        (payload as Record<string, unknown>).verificationCode)) ||
    null;
  if (direct) return String(direct);
  const m = /(?:код|code)[^0-9A-Za-z]{0,20}([0-9A-Za-z-]{4,40})/i.exec(text);
  return m ? m[1]! : null;
}

export async function dataLensRoutes(app: FastifyInstance, deps: DataLensDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());

  app.get('/integrations/datalens/datasets', async () =>
    DATASETS.map((d) => ({ id: d.id, ru: d.ru, en: d.en, ranged: d.ranged, columns: d.columns })),
  );

  const Q = z.object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default('2000-01-01'),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default('2100-01-01'),
    lang: z.enum(['ru', 'en']).default('ru'),
  });

  app.get('/integrations/datalens/export/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id.replace(/\.csv$/, '');
    const ds = DATASETS.find((d) => d.id === id);
    if (!ds) return reply.code(404).send({ error: 'unknown dataset' });
    const parsed = Q.safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid range' });
    const q = parsed.data;
    const rows = exportDataset(deps.db, ds, q.from, q.to);
    deps.users.audit(req.user ?? null, 'datalens.export', ds.id, {
      from: q.from,
      to: q.to,
      rows: rows.length,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${ds.id}_${q.from}_${q.to}.csv"`)
      .send(toCsv(ds, rows, q.lang));
  });

  // --- webhook receiver (public, token in the URL) ------------------------------------------------

  app.post(
    '/integrations/datalens/webhook/:token',
    { bodyLimit: 64 * 1024 },
    async (req, reply) => {
      const expected = deps.settings.get('DATALENS_WEBHOOK_TOKEN');
      const token = (req.params as { token: string }).token;
      // Constant-time comparison — cheap insurance for a public, secret-bearing URL.
      const a = Buffer.from(token);
      const b = Buffer.from(expected ?? '');
      if (!expected || expected.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
        return reply.code(404).send({ error: 'not found' });
      }
      const payload = req.body ?? {};
      const code = extractCode(payload);
      const kind = code ? 'confirmation' : 'notification';
      deps.db
        .prepare(
          'INSERT INTO datalens_events (received_at, kind, code, payload) VALUES (?, ?, ?, ?)',
        )
        .run(now().toISOString(), kind, code, JSON.stringify(payload).slice(0, 64_000));
      deps.db
        .prepare(
          'DELETE FROM datalens_events WHERE id NOT IN (SELECT id FROM datalens_events ORDER BY id DESC LIMIT 500)',
        )
        .run();
      deps.db
        .prepare(
          'INSERT INTO notifications (at, audience, kind, title, body) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          now().toISOString(),
          'admin',
          `datalens.${kind}`,
          code ? `DataLens: код подтверждения ${code}` : 'DataLens: новое уведомление',
          JSON.stringify(payload).slice(0, 500),
        );
      return { ok: true };
    },
  );

  app.get('/admin/integrations/datalens', async () => {
    const token = deps.settings.get('DATALENS_WEBHOOK_TOKEN');
    const events = deps.db
      .prepare(
        'SELECT id, received_at AS receivedAt, kind, code, payload FROM datalens_events ORDER BY id DESC LIMIT 50',
      )
      .all();
    const lastCode = deps.db
      .prepare(
        'SELECT code, received_at AS receivedAt FROM datalens_events WHERE code IS NOT NULL ORDER BY id DESC LIMIT 1',
      )
      .get();
    return { hasToken: !!token, token, events, lastCode: lastCode ?? null };
  });

  /** Admin-only (guarded by the /api/admin ADMIN_RULES): verify the DataLens API connection. */
  app.post('/admin/integrations/datalens/check', async (req, reply) => {
    const iamToken = deps.settings.get('DATALENS_IAM_TOKEN');
    const orgId = deps.settings.get('DATALENS_ORG_ID');
    const workbookId = deps.settings.get('DATALENS_WORKBOOK_ID');
    const missing = [
      !orgId && 'DATALENS_ORG_ID',
      !workbookId && 'DATALENS_WORKBOOK_ID',
      !iamToken && 'DATALENS_IAM_TOKEN',
    ].filter(Boolean) as string[];
    if (missing.length) {
      return reply.code(400).send({
        ok: false,
        code: 'NOT_CONFIGURED',
        message: `Не заполнено: ${missing.join(', ')}`,
        missing,
      });
    }
    const fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as DataLensFetch);
    const result = await checkDataLensConnection(fetchImpl, { iamToken, orgId, workbookId });
    deps.users.audit(req.user ?? null, 'datalens.check', workbookId, { ok: result.ok });
    return result;
  });

  /** Analyst → admin: request DataLens setup (creates an admin notification + audit entry).
   *  Rate-limited per user: 3 requests / hour — it is a notification, not a chat. */
  app.post('/integrations/datalens/request', async (req, reply) => {
    const uid = req.user!.id;
    const t = now().getTime();
    const recent = (dlRequests.get(uid) ?? []).filter((x) => t - x < 3_600_000);
    if (recent.length >= 3)
      return reply.code(429).send({ error: 'too many requests', code: 'RATE_LIMITED' });
    recent.push(t);
    dlRequests.set(uid, recent);
    const note = z.object({ note: z.string().max(500).default('') }).safeParse(req.body ?? {});
    if (!note.success) return reply.code(400).send({ error: 'invalid body' });
    deps.db
      .prepare('INSERT INTO notifications (at, audience, kind, title, body) VALUES (?, ?, ?, ?, ?)')
      .run(
        now().toISOString(),
        'admin',
        'datalens.request',
        `${req.user!.name} просит подключить DataLens`,
        note.data.note,
      );
    deps.users.audit(req.user!, 'datalens.request', undefined, note.data);
    return { ok: true };
  });

  // --- notifications (bell) ------------------------------------------------------------------------

  app.get('/notifications', async (req) => {
    const u = req.user!;
    const rows = deps.db
      .prepare(
        "SELECT id, at, audience, kind, title, body, read_by AS readBy FROM notifications WHERE audience = 'all' OR ? = 'admin' ORDER BY id DESC LIMIT 50",
      )
      .all(u.role) as Array<{
      id: number;
      at: string;
      kind: string;
      title: string;
      body: string;
      readBy: string;
    }>;
    return rows.map((r) => ({
      ...r,
      read: (JSON.parse(r.readBy) as number[]).includes(u.id),
      readBy: undefined,
    }));
  });

  app.post('/notifications/read', async (req) => {
    const u = req.user!;
    const rows = deps.db
      .prepare('SELECT id, read_by FROM notifications ORDER BY id DESC LIMIT 500')
      .all() as Array<{ id: number; read_by: string }>;
    const upd = deps.db.prepare('UPDATE notifications SET read_by = ? WHERE id = ?');
    deps.db.transaction(() => {
      for (const r of rows) {
        const ids = JSON.parse(r.read_by) as number[];
        if (!ids.includes(u.id)) upd.run(JSON.stringify([...ids, u.id]), r.id);
      }
    })();
    return { ok: true };
  });
}
