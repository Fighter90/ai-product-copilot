// Интеграционные API-проверки прода (НЕ разрушающие: без создания юзеров/целей, без смены настроек).
// Единственная запись — POST /api/report/snapshot (+ insights/hypotheses при --ai) на свежем снапшоте.
// Используется из e2e-prod-check.mjs; можно запустить отдельно:
// Запуск: PCA_PASSWORD='...' [PCA_ANALYST_PASSWORD='...'] node scripts/e2e-prod-integrations.mjs [base_url] [--ai]
// Результат: массив [name, status, len, errs]; status: ok | FAIL | SKIP | WARN (SKIP/WARN не валят вердикт).
// Прода восстанавливают из старого бэкапа — data-dependent проверки толерантны (0 строк/визитов → WARN, не FAIL).
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const PROVIDERS = ['openrouter', 'anthropic', 'yandexgpt', 'gigachat'];
// Самый дешёвый провайдер для живого вызова при --ai (цена/token; openrouter — модель на выбор).
const CHEAPEST_PROVIDER = 'openrouter';
const AI_TIMEOUT_MS = 600_000;

/** HTTP-запрос без лимитов headersTimeout/bodyTimeout у fetch (undici: 300 c) — свой таймаут. */
function request(base, method, path, { cookie, body, timeoutMs = 60_000 } = {}) {
  const url = new URL(path, base);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers = { accept: 'application/json, */*' };
  if (cookie) headers.cookie = cookie;
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(payload.length);
  }
  const started = Date.now();
  return new Promise((resolve) => {
    const req = lib.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = String(res.headers['content-type'] ?? '');
        let json;
        if (ct.includes('application/json')) {
          try {
            json = JSON.parse(buf.toString('utf8'));
          } catch {
            /* not json */
          }
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          ct,
          buf,
          json,
          ms: Date.now() - started,
        });
      });
      res.on('error', (e) => resolve({ status: 0, error: String(e), ms: Date.now() - started }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', (e) => resolve({ status: 0, error: String(e), ms: Date.now() - started }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(base, email, password) {
  const r = await request(base, 'POST', '/api/auth/login', { body: { email, password } });
  const set = [].concat(r.headers?.['set-cookie'] ?? []);
  const c = set.map((s) => s.split(';')[0]).find((s) => s.startsWith('pca_session='));
  return { status: r.status, cookie: c, role: r.json?.user?.role };
}

/** «Маршрут не задеплоен»: 404 от API или SPA-фолбэк nginx (HTML вместо JSON). */
const notDeployed = (r) => r.status === 404 || (r.status === 200 && r.ct.includes('text/html'));
const brief = (r) =>
  r.error
    ? r.error.slice(0, 120)
    : `HTTP ${r.status}${r.json?.error ? ` ${String(r.json.error).slice(0, 100)}` : ''}${r.json?.message ? ` ${String(r.json.message).slice(0, 100)}` : ''}`;

export async function runIntegrationChecks({ base, email, password, analystPassword, ai = false }) {
  const results = [];
  const ok = (name, len = 0, note) => results.push([name, 'ok', len, [], note]);
  const fail = (name, ...errs) => results.push([name, 'FAIL', 0, errs]);
  const skip = (name, note) => results.push([name, 'SKIP', 0, [], note]);
  const warn = (name, note) => results.push([name, 'WARN', 0, [], note]);

  // --- health ------------------------------------------------------------------------------------------
  {
    const r = await request(base, 'GET', '/api/health');
    if (r.status === 200 && r.json?.status === 'ok')
      ok('api:health', 0, `build=${String(r.json.build ?? r.json.version ?? '?').slice(0, 12)}`);
    else fail('api:health', brief(r));
  }

  // --- guest: новый контракт — /api/auth/me для неавторизованного = 200 {user:null} --------------------
  {
    const r = await request(base, 'GET', '/api/auth/me');
    if (r.status === 200 && r.json && 'user' in r.json && r.json.user === null)
      ok('api:guest-me', 0, 'HTTP 200 user=null');
    else fail('api:guest-me', brief(r), 'expected 200 {user:null}');
  }

  // --- admin session -------------------------------------------------------------------------
  const adm = await login(base, email, password);
  if (!adm.cookie) {
    fail('api:admin-login', `HTTP ${adm.status}`);
    return results;
  }
  ok('api:admin-login', 0, `role=${adm.role}`);
  const get = (p, o = {}) => request(base, 'GET', p, { cookie: adm.cookie, ...o });
  const post = (p, body, o = {}) => request(base, 'POST', p, { cookie: adm.cookie, body, ...o });

  // --- LLM providers -------------------------------------------------------------------------
  {
    // Только список конфигурации (без вызова LLM). Живые вызовы — только при --ai.
    const r = await get('/api/admin/ai/providers');
    const ids = Array.isArray(r.json) ? r.json.map((p) => p.id || p?.provider?.id) : [];
    const missing = PROVIDERS.filter((id) => !ids.includes(id));
    if (r.status === 200 && missing.length === 0) ok('llm:providers', ids.length, ids.join(','));
    else fail('llm:providers', brief(r), missing.length ? `missing: ${missing.join(',')}` : '');
    if (ai) {
      // Минимальный живой вызов: только самый дешёвый провайдер (один test-запрос, без генерации).
      const id = CHEAPEST_PROVIDER;
      const t = await post(`/api/admin/ai/providers/${id}/test`, {}, { timeoutMs: 120_000 });
      const msg = String(t.json?.message ?? '').slice(0, 140);
      if (t.status === 200 && t.json?.ok === true)
        ok(`llm:test:${id}`, 0, `${t.json.ms ?? t.ms}ms`);
      else fail(`llm:test:${id}`, t.status === 200 ? `ok:false — ${msg}` : brief(t));
      skip(
        'llm:test:other',
        `проверен только дешёвый ${id}; остальные (anthropic/yandexgpt/gigachat) не трогаем`,
      );
    } else skip('llm:test:*', 'без --ai — живые LLM-вызовы пропущены');
  }

  // --- Settings: чтение с маскировкой секретов ------------------------------------------------
  {
    const SENSITIVE = ['YANDEX_OAUTH_TOKEN', 'YANDEX_CLIENT_SECRET', 'ANTHROPIC_API_KEY'];
    const r = await get('/api/settings');
    if (r.status !== 200) fail('settings:masked', brief(r));
    else {
      // v3 view(): { [key]: { value, isSecret, source } }; секреты маскируются в .value
      // (буллеты + хвост: «••••S6tM»; сырой секрет был бы длиннее).
      const bad = SENSITIVE.filter((k) => {
        const cell = r.json?.[k];
        const v = String(
          typeof cell === 'object' && cell !== null ? (cell.value ?? '') : (cell ?? ''),
        );
        return v !== '' && !/^[•*]{3,8}\S{0,6}$/.test(v);
      });
      if (bad.length === 0)
        ok('settings:masked', 0, `counter=${r.json?.COUNTER_ID?.value ?? r.json?.COUNTER_ID ?? 0}`);
      else fail('settings:masked', `unmasked values: ${bad.join(',')}`);
    }
  }
  // REG-12 (ANA-100): /api/settings/public — узкий срез (KPI_TARGET, EVENT_DATE), читаемый
  // любым авторизованным пользователем (не только админом).
  {
    const r = await get('/api/settings/public');
    const keys = r.json && typeof r.json === 'object' ? Object.keys(r.json) : [];
    if (r.status === 200 && keys.includes('KPI_TARGET') && keys.includes('EVENT_DATE'))
      ok('settings:public', 0, 'KPI_TARGET+EVENT_DATE');
    else fail('settings:public', brief(r), 'expected 200 {KPI_TARGET,EVENT_DATE}');
  }

  // --- Sync status (ANA-15): GET /api/sync/status — последний прогон синка, админ-only ------
  {
    const r = await get('/api/sync/status');
    if (notDeployed(r)) skip('sync:status', 'not deployed');
    else if (r.status === 200 && r.json && 'run' in r.json)
      ok(
        'sync:status',
        0,
        `run=${r.json.run ? String(r.json.run.outcome ?? r.json.run.status ?? '?') : 'null (ещё не запускался)'}`,
      );
    else fail('sync:status', brief(r), 'expected 200 {run}');
  }

  // --- Metrika -------------------------------------------------------------------------------
  {
    const r = await get('/api/metrics/goals');
    if (r.status === 200 && Array.isArray(r.json) && r.json.length > 0)
      ok('metrika:goals', r.json.length);
    else fail('metrika:goals', brief(r), Array.isArray(r.json) ? 'empty' : '');
  }
  // Исчерпание суточной квоты Метрики (backfill/синк) — среда, не регресс кода: WARN, не FAIL.
  const quotaExhausted = (r) =>
    r.status === 429 && String(r.buf ?? '').includes('quota_requests_by_uid');
  {
    const r = await get('/api/live/summary', { timeoutMs: 90_000 });
    const t = r.json?.totals;
    if (quotaExhausted(r))
      warn(
        'metrika:live-summary',
        'Metrika 429 quota_requests_by_uid (backfill съел квоту) — ретрай позже',
      );
    else if (r.status === 200 && t && typeof t.visits === 'number') {
      // Прода восстанавливают из бэкапа — пустой live-счётчик не считаем багом.
      if (t.visits > 0) ok('metrika:live-summary', 0, `visits=${t.visits} users=${t.users}`);
      else warn('metrika:live-summary', `visits=0 (resync in progress), users=${t.users}`);
    } else fail('metrika:live-summary', brief(r));
  }
  {
    const r = await get('/api/live/funnel', { timeoutMs: 90_000 });
    const st = r.json?.stages;
    if (quotaExhausted(r))
      warn('metrika:live-funnel', 'Metrika 429 quota_requests_by_uid — ретрай позже');
    else if (r.status === 200 && Array.isArray(st) && st.length > 1)
      ok('metrika:live-funnel', st.length, `stages=${st.map((s) => s.key).join('>')}`);
    else fail('metrika:live-funnel', brief(r));
  }
  {
    // days=30; ключевые ассерты: дубликатов нет (duplicateGroups), референс-цели валидны.
    const r = await get('/api/admin/metrika/goals/audit?days=30', { timeoutMs: 120_000 });
    if (notDeployed(r)) skip('metrika:goals-audit', 'not deployed');
    else {
      const exp = r.json?.expected;
      const dupes = r.json?.duplicates;
      const bad = Array.isArray(exp)
        ? exp.filter((e) => !['present', 'missing', 'mismatch'].includes(e.status))
        : [];
      const hasCanWrite = r.json && 'canWrite' in r.json;
      const errs = [];
      if (r.status !== 200) errs.push(brief(r));
      else {
        // На демо/сид-базе цели без conditions группируются аудитом как дубликаты — это
        // артефакт сида, а не прода: на сид-базе предупреждаем, не валим.
        if (Array.isArray(dupes) && dupes.length) {
          const demo = (await get('/api/demo/status').catch(() => null))?.json?.demo;
          if (demo) warn('metrika:goals-audit', `duplicates=${dupes.length} (seeded demo DB)`);
          else errs.push(`duplicates=${dupes.length}`);
        }
        if (bad.length) errs.push(`bad status: ${bad.map((b) => b.status).join(',')}`);
        if (!hasCanWrite) errs.push('no canWrite');
      }
      if (errs.length) fail('metrika:goals-audit', ...errs);
      else {
        const cnt = (s) => exp.filter((e) => e.status === s).length;
        ok(
          'metrika:goals-audit',
          Array.isArray(exp) ? exp.length : 0,
          `expected=${Array.isArray(exp) ? exp.length : '?'} duplicates=0 present=${cnt('present')} missing=${cnt('missing')} mismatch=${cnt('mismatch')} canWrite=${r.json.canWrite}`,
        );
      }
    }
  }
  {
    const r = await get('/api/metrics/kpi-target');
    if (notDeployed(r)) skip('metrika:kpi-target', 'not deployed');
    else if (r.status === 200 && typeof r.json?.target === 'number')
      ok('metrika:kpi-target', 0, `target=${r.json.target}`);
    else fail('metrika:kpi-target', brief(r));
  }

  // --- nginx headers (served on /) -----------------------------------------------------------
  {
    const r = await request(base, 'HEAD', '/');
    const h = r.headers ?? {};
    // CSP может появиться только после следующего деплоя — предупреждение, не FAIL.
    if (!h['content-security-policy'])
      warn('nginx:headers', 'no CSP header yet (expected after next deploy)');
    else ok('nginx:headers', 0, 'CSP present');
    if (
      !h['x-frame-options'] &&
      !String(h['content-security-policy'] ?? '').includes('frame-ancestors')
    )
      warn('nginx:headers', 'no X-Frame-Options / frame-ancestors');
  }

  // --- DataLens ------------------------------------------------------------------------------
  {
    const r = await get('/api/integrations/datalens/datasets');
    const ds = Array.isArray(r.json) ? r.json : [];
    // ANA-55 стартовала с 5 датасетами; v3.2 добавила goals_daily, funnel_daily, utm_daily,
    // pages_daily, geo_device_daily, b2b_deals, hypotheses — проверяем минимум и уникальность id.
    const ids = ds.map((d) => d.id);
    const unique = new Set(ids).size === ids.length;
    if (r.status === 200 && ds.length >= 5 && unique) ok('datalens:datasets', ds.length);
    else fail('datalens:datasets', brief(r), `count=${ds.length} unique=${unique} (need ≥5)`);
    for (const d of ds) {
      const e = await get(`/api/integrations/datalens/export/${d.id}`, { timeoutMs: 120_000 });
      const text = e.buf?.toString('utf8') ?? '';
      const header = text.split(/\r?\n/)[0] ?? '';
      const rows = text.split(/\r?\n/).filter(Boolean).length - 1;
      if (e.status === 200 && e.ct.startsWith('text/csv') && header.includes(','))
        ok(`datalens:export:${d.id}`, e.buf.length, `rows=${rows}`);
      else
        fail(
          `datalens:export:${d.id}`,
          `HTTP ${e.status} ct=${e.ct || '-'} header=${header.slice(0, 60)}`,
        );
    }
  }
  {
    const r = await get('/api/admin/integrations/datalens');
    // token намеренно не выводим
    if (r.status === 200 && typeof r.json?.hasToken === 'boolean')
      if (r.json.hasToken)
        ok('datalens:admin', 0, `hasToken=true events=${r.json.events?.length ?? 0}`);
      else warn('datalens:admin', 'hasToken=false');
    else fail('datalens:admin', brief(r));
  }
  {
    const r = await post('/api/admin/integrations/datalens/check', {}, { timeoutMs: 90_000 });
    if (notDeployed(r)) skip('datalens:check', 'not deployed');
    else if (r.status === 400 && r.json?.code === 'NOT_CONFIGURED')
      warn('datalens:check', `NOT_CONFIGURED: ${(r.json.missing ?? []).join(',')}`);
    else if (r.status === 200 && r.json?.ok === true && r.json.workbookTitle)
      ok('datalens:check', 0, `workbook="${String(r.json.workbookTitle).slice(0, 60)}"`);
    else
      fail(
        'datalens:check',
        r.status === 200
          ? `ok:${r.json?.ok} — ${String(r.json?.message ?? '').slice(0, 140)}`
          : brief(r),
      );
  }

  // --- Reports -------------------------------------------------------------------------------
  let snapshotId;
  let existing = [];
  {
    const r = await get('/api/report/snapshots');
    if (r.status === 200 && Array.isArray(r.json)) {
      existing = r.json;
      ok('report:snapshots', r.json.length);
    } else fail('report:snapshots', brief(r));
  }
  {
    // Период — последние 30 дней (как дефолт страницы отчёта).
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const r = await post('/api/report/snapshot', { from, to }, { timeoutMs: 180_000 });
    const channels = r.json?.channels?.length ?? 0;
    if (r.status === 201 && r.json?.id && channels > 0) {
      snapshotId = r.json.id;
      ok('report:snapshot-create', r.buf.length, `${from}..${to} channels=${channels} ${r.ms}ms`);
    } else if (r.status === 201 && r.json?.id) {
      // Пустой снапшот: в кэше нет данных за период (напр. идёт sync — он чистит таблицы).
      warn('report:snapshot-create', `${from}..${to} channels=0 — empty, using newest non-empty`);
    } else fail('report:snapshot-create', brief(r));
  }
  // Fallback: самый свежий из существующих снапшотов с данными (чтобы docx/pdf/AI не мерили пустоту).
  for (const s of snapshotId ? [] : existing.slice(0, 10)) {
    const r = await get(`/api/report/snapshot/${s.id}`);
    if ((r.json?.channels?.length ?? 0) > 0) {
      snapshotId = s.id;
      break;
    }
  }
  for (const [fmt, ctWant] of [
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['pdf', 'application/pdf'],
  ]) {
    if (!snapshotId) {
      fail(`report:download-${fmt}`, 'no snapshot');
      continue;
    }
    const r = await get(`/api/report/download/${snapshotId}/${fmt}`, { timeoutMs: 300_000 });
    const size = r.buf?.length ?? 0;
    if (r.status === 200 && r.ct.startsWith(ctWant) && size > 50 * 1024)
      ok(`report:download-${fmt}`, size, `${Math.round(size / 1024)}KB ${r.ms}ms`);
    else fail(`report:download-${fmt}`, `HTTP ${r.status} ct=${r.ct || '-'} size=${size}`);
  }

  if (ai && snapshotId) {
    // ANA-133: AI generation runs in the backend's single-slot background queue — POST
    // answers 202 {jobId} and the result arrives by polling GET /report/ai-jobs/:jobId
    // until status done/failed (429 = another generation holds the slot).
    const pollAiJob = async (jobId) => {
      const deadline = Date.now() + AI_TIMEOUT_MS;
      for (;;) {
        if (Date.now() > deadline) return { status: 504, json: null, ms: AI_TIMEOUT_MS };
        const r = await get(`/api/report/ai-jobs/${encodeURIComponent(jobId)}`, {
          timeoutMs: 30_000,
        });
        const j = r.json ?? {};
        if (r.status === 404) return { status: 410, json: { status: 'failed', error: 'job lost' } };
        if (r.status !== 200) return r;
        if (j.status === 'done' || j.status === 'failed') return r;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    };
    const startAiJob = async (path, snapshotIdForJob) => {
      const started = await post(path, { snapshotId: snapshotIdForJob }, { timeoutMs: 30_000 });
      if (started.status === 429) return { status: 429, json: null, ms: started.ms };
      if (started.status !== 202) return started;
      return pollAiJob(started.json?.jobId);
    };
    {
      const r = await startAiJob('/api/report/insights', snapshotId);
      const text = String(r.json?.result?.narrative ?? '');
      const sections = (text.match(/^## /gm) ?? []).length;
      const errs = [];
      if (r.status === 429) errs.push(`busy (429) after ${Math.round(r.ms / 1000)}s`);
      else if (r.status !== 200 || r.json?.status !== 'done')
        errs.push(`${brief(r)} after ${Math.round(r.ms / 1000)}s`);
      else {
        if (sections < 5) errs.push(`sections=${sections} (need ≥5)`);
        if (text.includes('[Ошибка генерации')) errs.push('contains [Ошибка генерации');
      }
      if (errs.length) fail('ai:insights', ...errs);
      else ok('ai:insights', text.length, `sections=${sections} ${Math.round(r.ms / 1000)}s`);
    }
    {
      const r = await startAiJob('/api/report/hypotheses', snapshotId);
      const h = r.json?.result?.hypotheses;
      const errs = [];
      if (r.status === 429) errs.push(`busy (429) after ${Math.round(r.ms / 1000)}s`);
      else if (r.status !== 200 || r.json?.status !== 'done' || !h)
        errs.push(`${brief(r)} after ${Math.round(r.ms / 1000)}s`);
      else {
        const p = h.problems?.length ?? 0;
        const s = h.solutions?.length ?? 0;
        if (p < 10) errs.push(`problems=${p} (need ≥10)`);
        if (s < 10) errs.push(`solutions=${s} (need ≥10)`);
        const badIce = (h.solutions ?? []).filter(
          (x) => !x.ice || x.ice.score !== x.ice.impact * x.ice.confidence * x.ice.ease,
        );
        if (badIce.length) errs.push(`ICE mismatch: ${badIce.map((x) => x.id).join(',')}`);
      }
      if (errs.length) fail('ai:hypotheses', ...errs);
      else
        ok(
          'ai:hypotheses',
          r.buf?.length ?? 0,
          `problems=${h.problems.length} solutions=${h.solutions.length} ${Math.round(r.ms / 1000)}s`,
        );
    }
  }

  // --- RBAC (analyst) ------------------------------------------------------------------------
  if (!analystPassword) skip('rbac:analyst', 'PCA_ANALYST_PASSWORD not set');
  else {
    const an = await login(
      base,
      process.env.PCA_ANALYST_EMAIL || 'analyst@dashboardcamp.ru',
      analystPassword,
    );
    if (!an.cookie) fail('rbac:analyst-login', `HTTP ${an.status}`);
    else {
      ok('rbac:analyst-login', 0, `role=${an.role}`);
      // Тела заведомо невалидны: даже при дыре в RBAC запрос упадёт в 400, а не изменит данные.
      const probes = [
        ['POST', '/api/sync', {}],
        ['GET', '/api/sync/status'],
        ['GET', '/api/admin/ai/providers'],
        ['POST', '/api/settings', { __e2e_probe__: 'x' }],
        ['PATCH', '/api/settings', { __e2e_probe__: 'x' }],
        ['GET', '/api/admin/metrika/goals/audit?days=90'],
        ['GET', '/api/admin/integrations/datalens'],
        ['POST', '/api/admin/integrations/datalens/check', {}],
        ['GET', '/api/users'],
      ];
      for (const [method, path, body] of probes) {
        const r = await request(base, method, path, { cookie: an.cookie, body });
        const name = `rbac:${method} ${path.split('?')[0]}`;
        if (r.status === 403) ok(name);
        else fail(name, `expected 403, got ${brief(r)}`);
      }
      // Исключение из RBAC: /api/settings/public доступен аналитику (REG-12/ANA-100).
      const pub = await request(base, 'GET', '/api/settings/public', { cookie: an.cookie });
      if (pub.status === 200) ok('rbac:GET /api/settings/public (allowed)');
      else fail('rbac:GET /api/settings/public (allowed)', `expected 200, got ${brief(pub)}`);
    }
  }

  return results;
}

/** Печать таблицы и вердикта. FAIL или console-ошибки валят; SKIP/WARN — нет. Возвращает exit-код. */
export function printVerdict(base, results) {
  let fails = 0;
  let soft = 0;
  console.log('\n=== E2E ПРОДА:', base, '===');
  for (const [name, status, len, errs, note] of results) {
    const bad = status === 'FAIL' || (errs?.length ?? 0) > 0;
    const isSoft = !bad && (status === 'SKIP' || status === 'WARN');
    if (bad) fails++;
    if (isSoft) soft++;
    const mark = bad ? '✗' : isSoft ? '~' : '✓';
    console.log(
      `${mark} ${name.padEnd(30)} ${status.padEnd(6)} len=${len}${note ? ` (${note})` : ''}${errs?.length ? ' | ' + errs.filter(Boolean).join(' ; ') : ''}`,
    );
  }
  const okCount = results.length - fails - soft;
  console.log(
    `\nИтого: ${okCount}/${results.length} ok, ошибок: ${fails}${soft ? `, skip/warn: ${soft}` : ''}`,
  );
  console.log(fails === 0 ? 'VERDICT: PASS' : 'VERDICT: FAIL');
  return fails === 0 ? 0 : 1;
}

// Самостоятельный запуск
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args.find((a) => !a.startsWith('--')) || 'https://dashboardcamp.ru';
  const password = process.env.PCA_PASSWORD || '';
  if (!password) {
    console.error('PCA_PASSWORD required');
    process.exit(1);
  }
  const results = await runIntegrationChecks({
    base,
    email: process.env.PCA_EMAIL || 'admin@dashboardcamp.ru',
    password,
    analystPassword: process.env.PCA_ANALYST_PASSWORD || '',
    ai: args.includes('--ai'),
  });
  process.exit(printVerdict(base, results));
}
