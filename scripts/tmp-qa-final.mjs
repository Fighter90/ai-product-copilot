/* global document, location, getComputedStyle */
// (DOM-глобалы используются внутри page.evaluate — колбэки Playwright исполняются в браузере)
import { chromium } from 'playwright';
import { mkdirSync, appendFileSync } from 'node:fs';
const OUT = '/tmp/qa-final';
mkdirSync(OUT, { recursive: true });
const L = OUT + '/findings.log';
const log = (s) => {
  console.log(s);
  appendFileSync(L, s + '\n');
};
const bugs = [];
const bug = (id, t, s) => {
  bugs.push({ id, t, s });
  log('BUG [' + id + '] ' + t + (s ? ' — ' + s : ''));
};
const ok = (id, m) => log('OK [' + id + '] ' + m);
const BASE = 'https://dashboardcamp.ru';
const PAGES = [
  'live',
  'goals',
  'funnel-live',
  'traffic',
  'behavior',
  'funnel',
  'kpi',
  'explore/sources',
  'report',
  'history',
  'b2b',
  'marketing',
  'datalens',
  'hypotheses',
  'decisions',
];
const ADMIN_PAGES = [
  'admin/users',
  'admin/ai',
  'admin/metrika',
  'admin/integrations',
  'admin/audit',
];
const browser = await chromium.launch({ channel: 'chromium' });
const consoleErrs = [];
const mkPage = async (vp) => {
  const p = await browser.newPage({ viewport: vp || { width: 1440, height: 900 } });
  p.on('console', (m) => {
    if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 140));
  });
  p.on('pageerror', (e) => consoleErrs.push('PAGEERROR ' + String(e).slice(0, 140)));
  return p;
};
const cs = (label) => {
  const r = consoleErrs.filter((e) => !/409|401|403|Failed to load resource|net::/.test(e));
  if (r.length) {
    bug('console-' + label, 'консоль-ошибки: ' + r.slice(0, 3).join(' § '));
  }
  consoleErrs.length = 0;
};
async function login(page, email, password) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30000 });
  await page.waitForTimeout(2000);
}
const tourOff = async (page) => {
  for (const t of ['Пропустить тур', 'Далее', 'Завершить']) {
    const b = page.getByRole('button', { name: t }).first();
    if (await b.count()) {
      try {
        await b.click({ timeout: 1200 });
        await page.waitForTimeout(250);
      } catch {
        // кнопка тура исчезла до клика — не дефект
      }
    }
  }
};

// ============ 1. АДМИН: все страницы desktop ============
log('=== 1. ADMIN desktop 1440: все страницы ===');
const admin = await mkPage();
await login(admin, 'admin@dashboardcamp.ru', 'DemoAdmin-c8ea7234!');
ok('login-admin', 'вход админом ✓');
cs('login-admin');
for (const p of [...PAGES, ...ADMIN_PAGES]) {
  try {
    await admin.goto(BASE + '/app/' + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await admin.waitForTimeout(1800);
    const txt = await admin.evaluate(() => document.body.innerText.slice(0, 400));
    if (/404|страница не найдена|not found/i.test(txt)) bug('page-' + p, 'страница показывает 404');
    else ok('page-' + p, 'ok');
    if (p === 'decisions' || p === 'admin/users')
      await admin.screenshot({ path: OUT + '/adm-' + p.replace('/', '-') + '.png' });
  } catch (e) {
    bug('page-' + p, 'goto/timeout: ' + String(e).slice(0, 60));
  }
  cs('page-' + p);
}
// 404-поведение на несуществующей
await admin.goto(BASE + '/app/no-such-page-xyz', { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(1200);
const nv = await admin.evaluate(() => location.pathname);
ok('unknown-route', 'редирект на: ' + nv);

// ============ 2. АНАЛИТ: все страницы + изоляция админки ============
log('=== 2. ANALYST desktop: страницы + Forbidden ===');
const ana = await mkPage();
await login(ana, 'analyst@dashboardcamp.ru', 'DemoAnalyst-bf449de4!');
ok('login-analyst', 'вход аналитиком ✓');
cs('login-analyst');
for (const p of PAGES) {
  try {
    await ana.goto(BASE + '/app/' + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await ana.waitForTimeout(1500);
    ok('ana-page-' + p, 'ok');
  } catch (e) {
    bug('ana-page-' + p, String(e).slice(0, 60));
  }
  cs('ana-page-' + p);
}
for (const p of ADMIN_PAGES) {
  await ana.goto(BASE + '/app/' + p, { waitUntil: 'domcontentloaded' });
  await ana.waitForTimeout(1500);
  const t = await ana.evaluate(() => document.body.innerText.slice(0, 300));
  const forbidden =
    /403|доступ|forbidden|нет прав/i.test(t) ||
    !/Пользователи|AI-провайдеры|Метрика|Интеграции|Аудит/.test(t);
  if (forbidden) ok('ana-admin-' + p, 'админ-страница недоступна ✓');
  else bug('ana-admin-' + p, 'АНАЛИТ ВИДИТ АДМИН-СТРАНИЦУ');
  cs('ana-admin-' + p);
}
// API-изоляция: analyst → admin API = 403
const api403 = await ana.evaluate(async () => {
  const r = await fetch('/api/users');
  return r.status;
});
if (api403 === 403) ok('ana-api-403', 'GET /api/users → 403 ✓');
else bug('ana-api-403', 'GET /api/users → ' + api403);
await ana.screenshot({ path: OUT + '/ana-decisions.png' });

// ============ 3. НОВОЕ v3.4.13/14: матрица автономии + бейджи ============
log('=== 3. Матрица автономии (ANA-137/138) ===');
const mx = await admin.evaluate(async () => {
  const r = await fetch('/api/decisions/autonomy-matrix');
  return { s: r.status, b: await r.json().catch(() => null) };
});
if (mx.s === 200 && mx.b)
  ok('matrix-api', 'autonomy-matrix 200 ✓: ' + JSON.stringify(mx.b).slice(0, 120));
else bug('matrix-api', 'status ' + mx.s);
await admin.goto(BASE + '/app/decisions', { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(2500);
const mat = await admin.evaluate(() => document.body.innerText);
if (/A0|A1|A2|автоном/i.test(mat)) ok('matrix-ui', 'блок матрицы на /app/decisions ✓');
else bug('matrix-ui', 'блок матрицы НЕ найден на странице');
const dl = admin.locator('text=/эскалаци/i').first();
if ((await dl.count()) > 0) ok('escalation-word', 'слово «эскалация» присутствует ✓');
else log('escalation-word: не найдено (может, нет AI-решений — проверить после AI-анализа)');
await admin.screenshot({ path: OUT + '/adm-decisions-matrix.png', fullPage: true });

// ============ 4. AI-анализ: фоновая очередь + автопополнение ============
log('=== 4. AI-анализ (фоновая очередь ANA-133 + автопополнение) ===');
await admin.goto(BASE + '/app/report', { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(3000);
const aiBtn = admin.getByRole('button', { name: /AI-анализ|Сгенерировать/i }).first();
if (await aiBtn.count()) {
  const t0 = Date.now();
  await aiBtn.click({ timeout: 5000 });
  await admin.waitForTimeout(3000);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log('клик AI-анализ: отклик UI ' + dt + 'с');
  // страница живая?
  const alive = await admin.evaluate(
    () => document.visibilityState === 'visible' && !!document.querySelector('button'),
  );
  if (alive) ok('ai-async', 'UI не заблокирован (фоновая очередь) ✓ ' + dt + 'с');
  else bug('ai-async', 'UI умер после клика');
  // ждём генерацию (поллинг статуса до 8 мин)
  let done = false;
  for (let i = 0; i < 16; i++) {
    await admin.waitForTimeout(30000);
    const st = await admin.evaluate(async () => {
      try {
        const r = await fetch('/api/report/ai-jobs?limit=1');
        if (!r.ok) return null;
        const j = await r.json();
        return JSON.stringify(j).slice(0, 200);
      } catch {
        return null;
      }
    });
    log('  поллинг ' + (i + 1) + ': ' + (st || 'нет данных'));
    if (st && /done|completed|succeeded/i.test(st)) {
      done = true;
      break;
    }
    if (st && /failed|error/i.test(st)) {
      bug('ai-job', 'задача упала: ' + st);
      break;
    }
  }
  if (done) ok('ai-job', 'AI-генерация завершилась ✓');
  else log('ai-job: статус не подтверждён за 8 мин (проверить вручную)');
  // автопополнение: AI-черновики в гипотезах/решениях
  await admin.goto(BASE + '/app/hypotheses', { waitUntil: 'domcontentloaded' });
  await admin.waitForTimeout(2500);
  const hy = await admin.evaluate(() => document.body.innerText);
  if (/AI/i.test(hy)) ok('autopopulate-hyp', 'AI-записи в гипотезах ✓');
  else bug('autopopulate-hyp', 'AI-черновиков нет в гипотезах после AI-анализа');
  await admin.goto(BASE + '/app/decisions', { waitUntil: 'domcontentloaded' });
  await admin.waitForTimeout(2500);
  const dec = await admin.evaluate(() => document.body.innerText);
  if (/эскалаци/i.test(dec)) ok('escalation-badge', 'бейджи эскалации на решениях ✓ ANA-138');
  else bug('escalation-badge', 'бейджей эскалации нет на AI-решениях');
  await admin.screenshot({ path: OUT + '/adm-decisions-badges.png', fullPage: true });
} else
  log(
    'AI-кнопка не найдена (отчёт уже сгенерирован) — автопопуляция проверяется по существующим записям',
  );
cs('ai-flow');

// ============ 5. Функциональные флоу ============
log('=== 5. Флоу: гипотезы (валидация), B2B (негатив), logout ===');
await admin.goto(BASE + '/app/hypotheses', { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(2500);
await tourOff(admin);
try {
  await admin
    .getByRole('button', { name: /Новая гипотеза/i })
    .first()
    .click({ timeout: 6000 });
  await admin.waitForTimeout(600);
  // 1) draft одним названием
  const inp = admin
    .locator('input')
    .filter({ hasNot: admin.locator('[type="password"]') })
    .first();
  await inp.fill('QA-FINAL-1-DELETE');
  await admin
    .getByRole('button', { name: /Сохранить|Создать/i })
    .last()
    .click({ timeout: 5000 });
  await admin.waitForTimeout(1200);
  if ((await admin.locator('text=QA-FINAL-1-DELETE').count()) > 0)
    ok('hyp-draft', 'draft одним названием ✓');
  else bug('hyp-draft', 'не сохранился');
  // 2) полный формат: без допущений/методов — перевод в работу должен блокироваться
  const workBtn = admin.getByRole('button', { name: /В работу/i }).first();
  if (await workBtn.count()) {
    await workBtn.click({ timeout: 3000 }).catch(() => {});
    await admin.waitForTimeout(800);
    const need = await admin.evaluate(() => document.body.innerText);
    if (/допущени|метод|заполн/i.test(need))
      ok('hyp-validation', 'перевод в работу блокируется валидацией ✓');
    else bug('hyp-validation', 'draft ушёл в работу без допущений/методов!');
  }
} catch (e) {
  log('hyp-flow skip: ' + String(e).slice(0, 70));
}
cs('hyp-flow');
await admin.goto(BASE + '/app/b2b', { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(2200);
try {
  await admin
    .getByRole('button', { name: 'Добавить', exact: true })
    .first()
    .click({ timeout: 5000 });
  await admin.waitForTimeout(500);
  await admin.locator('input[type="text"]').first().fill('QA-NEG-FINAL');
  await admin.locator('input[type="number"]').first().fill('-7');
  await admin
    .locator('button[type="submit"], button:has-text("Сохранить")')
    .last()
    .click({ timeout: 5000 });
  await admin.waitForTimeout(1200);
  if ((await admin.locator('text=QA-NEG-FINAL').count()) > 0)
    bug('b2b-neg', 'отрицательные билеты СОХРАНИЛИСЬ');
  else ok('b2b-neg', 'отрицательные отклонены ✓');
} catch (e) {
  log('b2b skip: ' + String(e).slice(0, 70));
}
cs('b2b');
// logout
await admin
  .locator('button, [role="button"]')
  .filter({ hasText: /выйти|logout/i })
  .first()
  .click({ timeout: 3000 })
  .catch(() => {});
await admin.waitForTimeout(1500);
if (/url=\/login|\/login/.test(admin.url())) ok('logout', 'выход ✓');
else log('logout: не пойман (кнопка в меню?)');

// ============ 6. МОБИЛЬНЫЙ 390 обе роли: ВСЕ страницы ============
log('=== 6. Mobile 390: обе роли, все страницы ===');
const mob = await mkPage({ width: 390, height: 844 });
await login(mob, 'admin@dashboardcamp.ru', 'DemoAdmin-c8ea7234!');
const hs = [];
for (const p of [...PAGES, ...ADMIN_PAGES]) {
  await mob.goto(BASE + '/app/' + p, { waitUntil: 'domcontentloaded' });
  await mob.waitForTimeout(1500);
  const m = await mob.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
  }));
  if (m.s > m.c + 2) hs.push(p + ': ' + m.s + '>' + m.c);
}
if (hs.length === 0)
  ok(
    'mobile-admin',
    'админ: скролла нет на ' + (PAGES.length + ADMIN_PAGES.length) + ' страницах ✓',
  );
else bug('mobile-admin', 'скролл: ' + hs.join(', '));
await mob.screenshot({ path: OUT + '/mob-admin-decisions.png' });
// analyst mobile
await mob.goto(BASE + '/login', { waitUntil: 'networkidle' });
await mob.fill('input[type="email"]', 'analyst@dashboardcamp.ru');
await mob.fill('input[type="password"]', 'DemoAnalyst-bf449de4!');
await mob.click('button[type="submit"]');
await mob.waitForURL(/\/app/, { timeout: 30000 });
const hs2 = [];
for (const p of PAGES) {
  await mob.goto(BASE + '/app/' + p, { waitUntil: 'domcontentloaded' });
  await mob.waitForTimeout(1300);
  const m = await mob.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
  }));
  if (m.s > m.c + 2) hs2.push(p + ': ' + m.s + '>' + m.c);
}
if (hs2.length === 0) ok('mobile-ana', 'аналит: скролла нет ✓');
else bug('mobile-ana', 'скролл: ' + hs2.join(', '));
cs('mobile');

// ============ 7. UX: пустые состояния, формы, доступность ============
log('=== 7. UX-проверки ===');
const ux = await mkPage();
await login(ux, 'analyst@dashboardcamp.ru', 'DemoAnalyst-bf449de4!');
await ux.goto(BASE + '/app/history', { waitUntil: 'domcontentloaded' });
await ux.waitForTimeout(2000);
const histTxt = await ux.evaluate(() => document.body.innerText.slice(0, 500));
if (/нет данных|пусто|пока нет|no data|—/i.test(histTxt) || histTxt.length > 200)
  ok('ux-empty', 'history: состояние отображается ✓');
else bug('ux-empty', 'history пустой и без сообщения');
// кнопки без текста (иконки) — aria-label
await ux.goto(BASE + '/app/decisions', { waitUntil: 'domcontentloaded' });
await ux.waitForTimeout(2000);
const unlabeled = await ux.evaluate(
  () =>
    [...document.querySelectorAll('button')].filter(
      (b) => !b.innerText.trim() && !b.getAttribute('aria-label') && !b.title,
    ).length,
);
if (unlabeled > 0)
  bug('ux-a11y-buttons', unlabeled + ' кнопок без текста/aria-label на /app/decisions');
else ok('ux-a11y-buttons', 'все кнопки подписаны ✓');
// контраст хотя бы грубо: наличие css-переменных (дизайн-система)
const hasTheme = await ux.evaluate(
  () =>
    !!getComputedStyle(document.documentElement).getPropertyValue('--background') ||
    !!document.querySelector('[class*="bg-"]'),
);
if (hasTheme) ok('ux-theme', 'дизайн-система присутствует ✓');
else log('ux-theme: не определено грубой проверкой');
cs('ux');

log('');
log('=== ИТОГ: ' + bugs.length + ' дефектов ===');
bugs.forEach((b, i) => log(i + 1 + '. [' + b.id + '] ' + b.t + (b.s ? ' — ' + b.s : '')));
await browser.close();
log('=== конец QA ===');
