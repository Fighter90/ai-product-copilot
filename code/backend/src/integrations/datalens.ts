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
 *
 * Users semantics (ANA-55, honest-total rule): the `users` column in Metrika daily stats is the
 * number of unique visitors WITHIN one day and one breakdown slice. Summing it across days or
 * slices double-counts people, so every dataset exposes it as `users_daily` and its field
 * dictionary title explicitly says «в границах дня, не суммируется» / "per day; do not sum".
 * An honest cross-period total would require visit-level Logs API data, which the export
 * deliberately does not include.
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
      c(
        'users_daily',
        'integer',
        'Посетители (в границах дня, не суммируется)',
        'Users (per day; do not sum)',
      ),
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
    id: 'goals_daily',
    ru: 'Цели (заявки KPI) по дням',
    en: 'Goals (KPI applications) by day',
    ranged: true,
    columns: [
      c('date', 'date', 'Дата', 'Date'),
      c('visits', 'integer', 'Визиты', 'Visits'),
      c(
        'users_daily',
        'integer',
        'Посетители (в границах дня, не суммируется)',
        'Users (per day; do not sum)',
      ),
      c('orders', 'integer', 'Заказы (цель KPI)', 'Orders (KPI goal)'),
      c('conversion_rate', 'float', 'Конверсия, %', 'Conversion, %'),
    ],
    sql: `SELECT date, SUM(visits), SUM(users), SUM(goal_reaches),
            ROUND(SUM(goal_reaches) * 100.0 / MAX(SUM(visits), 1), 3)
          FROM channel_stats WHERE date BETWEEN :from AND :to GROUP BY date ORDER BY date`,
  },
  {
    // ANA-111: pc-goals goal catalog with ticket-tariff labels for DataLens. Labels are derived
    // from the goal names the sync stores (reference-named «G-XX Название (event)» or the bare
    // event the customer used, e.g. «ticket_halloween»). goals_daily stays the KPI aggregate —
    // per-tariff reaches are live-only (see /live/funnel), so the catalog is the honest way to
    // join ticket_type/ticket names onto DataLens charts, not a daily-per-goal dataset.
    id: 'goals_catalog',
    ru: 'Цели pc-goals: тарифы и шаги',
    en: 'pc-goals goals: tariffs and steps',
    ranged: false,
    columns: [
      c('goal_id', 'integer', 'ID цели', 'Goal ID'),
      c('name', 'string', 'Название цели', 'Goal name'),
      c('event', 'string', 'JS-событие', 'JS event'),
      c(
        'goal_group',
        'string',
        'Группа (funnel/ticket/role/other)',
        'Group (funnel/ticket/role/other)',
      ),
      c('ticket_type', 'string', 'Тариф билета', 'Ticket type'),
      c('ticket_stage', 'string', 'Шаг (pick/buy/checkout)', 'Step (pick/buy/checkout)'),
      c('archived', 'integer', 'Архивная (1/0)', 'Archived (1/0)'),
    ],
    sql: `SELECT id, name, event,
            CASE WHEN event IN ('volunteer_apply','speaker_apply','clevel_apply','partner_apply')
                 THEN 'role'
                 WHEN event LIKE 'ticket%' THEN 'ticket'
                 WHEN type = 'action' THEN 'funnel'
                 ELSE 'other' END,
            CASE WHEN event LIKE 'ticket%halloween' THEN 'halloween'
                 WHEN event LIKE 'ticket%standard' THEN 'standard'
                 WHEN event LIKE 'ticket%optimal' THEN 'optimal'
                 WHEN event LIKE 'ticket%max' THEN 'max' END,
            CASE WHEN event LIKE 'ticket_pick%' THEN 'pick'
                 WHEN event LIKE 'ticket_checkout%' THEN 'checkout'
                 WHEN event LIKE 'ticket%' THEN 'buy' END,
            is_archived
          FROM (SELECT id, name, type, is_archived,
                  CASE WHEN instr(name,'(') > 0 AND instr(name,')') > instr(name,'(') + 1
                       THEN trim(substr(name, instr(name,'(')+1,
                                        instr(name,')')-instr(name,'(')-1))
                       ELSE name END AS event
                FROM goals) ORDER BY id`,
  },
  {
    id: 'funnel_daily',
    ru: 'Воронка по дням',
    en: 'Funnel by day',
    ranged: true,
    columns: [
      c('date', 'date', 'Дата', 'Date'),
      c('visits', 'integer', 'Визиты', 'Visits'),
      c(
        'users_daily',
        'integer',
        'Посетители (в границах дня, не суммируется)',
        'Users (per day; do not sum)',
      ),
      c('b2c_applications', 'integer', 'Заявки B2C (цель KPI)', 'B2C applications (KPI goal)'),
      c(
        'b2b_pipeline',
        'integer',
        'B2B в работе (по дате добавления)',
        'B2B pipeline (by added date)',
      ),
      c('b2b_paid', 'integer', 'B2B оплачено (по дате оплаты)', 'B2B paid (by payment date)'),
    ],
    sql: `SELECT d.date, COALESCE(cs.visits, 0), COALESCE(cs.users_daily, 0), COALESCE(cs.reaches, 0),
            COALESCE(added.pipeline, 0), COALESCE(paid.tickets, 0)
          FROM (SELECT date FROM channel_stats
                UNION SELECT substr(date_added, 1, 10) FROM b2b_manual WHERE date_added IS NOT NULL
                UNION SELECT substr(date_paid, 1, 10) FROM b2b_manual WHERE date_paid IS NOT NULL) d
          LEFT JOIN (SELECT date, SUM(visits) AS visits, SUM(users) AS users_daily,
                            SUM(goal_reaches) AS reaches
                     FROM channel_stats GROUP BY date) cs ON cs.date = d.date
          LEFT JOIN (SELECT substr(date_added, 1, 10) AS d2,
                            SUM(CASE WHEN stage != 'paid' THEN tickets ELSE 0 END) AS pipeline
                     FROM b2b_manual GROUP BY substr(date_added, 1, 10)) added ON added.d2 = d.date
          LEFT JOIN (SELECT substr(date_paid, 1, 10) AS d3, SUM(tickets) AS tickets
                     FROM b2b_manual WHERE date_paid IS NOT NULL GROUP BY substr(date_paid, 1, 10)) paid
                 ON paid.d3 = d.date
          WHERE d.date BETWEEN :from AND :to ORDER BY d.date`,
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
      c(
        'users_daily',
        'integer',
        'Посетители (в границах дня, не суммируется)',
        'Users (per day; do not sum)',
      ),
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
      c(
        'users_daily',
        'integer',
        'Посетители (в границах дня, не суммируется)',
        'Users (per day; do not sum)',
      ),
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
      c(
        'users_daily',
        'integer',
        'Посетители (в границах дня, не суммируется)',
        'Users (per day; do not sum)',
      ),
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
  {
    id: 'hypotheses',
    ru: 'Гипотезы (бэклог с ICE)',
    en: 'Hypotheses (ICE backlog)',
    ranged: false,
    columns: [
      c('id', 'integer', 'ID', 'ID'),
      c('phase', 'string', 'Фаза (define/develop)', 'Phase (define/develop)'),
      c('kind', 'string', 'Тип (problem/solution)', 'Kind (problem/solution)'),
      c('title', 'string', 'Заголовок', 'Title'),
      c('subject', 'string', 'Субъект', 'Subject'),
      c('action', 'string', 'Действие', 'Action'),
      c('solution', 'string', 'Решение', 'Solution'),
      c('condition', 'string', 'Условие', 'Condition'),
      c('impact', 'integer', 'Impact (1–10)', 'Impact (1–10)'),
      c('confidence', 'integer', 'Confidence (1–10)', 'Confidence (1–10)'),
      c('ease', 'integer', 'Ease (1–10)', 'Ease (1–10)'),
      c('ice_score', 'integer', 'ICE', 'ICE'),
      c('status', 'string', 'Статус', 'Status'),
      c('source', 'string', 'Источник (manual/ai)', 'Source (manual/ai)'),
      c('deadline', 'date', 'Дедлайн', 'Deadline'),
    ],
    sql: `SELECT id, diamond_phase, kind, title, subject, action, solution, condition,
                 impact, confidence, ease, ice_score, status, source, substr(deadline_at, 1, 10)
          FROM hypotheses ORDER BY ice_score DESC, id`,
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
  // Complex datasets (funnel_daily) reference several tables via FROM/JOIN — every one of them
  // must exist, otherwise the export degrades to an empty table instead of a SQL error.
  // The lookbehind skips named bindings (:from / :to), which case-insensitively contain "FROM"/"TO".
  const referenced = [
    ...ds.sql.matchAll(/(?<![:\w])(?:FROM|JOIN)\s+(?!AND\b|OR\b)([a-zA-Z_]\w*)/gi),
  ].map((m) => m[1]!);
  if (referenced.some((t) => !tables.has(t))) return [];
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

  // Per-user rate-limit for the admin «проверить подключение» button: each call is an outbound
  // HTTPS request to the DataLens API (15s timeout), so rapid-fire clicks must be throttled.
  // 5 checks/minute is far above any manual usage. Closure-scoped → fresh state per app.
  const dlChecks = new Map<number, number[]>();
  const checkLimited = (uid: number): boolean => {
    const t = now().getTime();
    const recent = (dlChecks.get(uid) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= 5) return true;
    recent.push(t);
    dlChecks.set(uid, recent);
    return false;
  };

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
    // Rate-limit first: it also throttles config-probing retries, not just the outbound call.
    if (checkLimited(req.user!.id)) {
      return reply.code(429).send({ error: 'too many requests', code: 'RATE_LIMITED' });
    }
    // IAM token lives ≤12h and is single-active: the ONLY generator is
    // scripts/refresh-datalens-token.mjs (updates /opt/pca/.env for the timer AND the DB
    // setting for the admin UI/check — one fresh token in both places). Do not read
    // process.env here: pca-api loads .env at boot, so a stale copy would shadow the fresh one.
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
