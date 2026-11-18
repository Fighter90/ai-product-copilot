#!/usr/bin/env node
// browser-regression.mjs — полный прогрев/регресс прод-кабинета в браузере (Playwright, chrome).
// Прогон: node scripts/browser-regression.mjs [--locale ru|en] [--out dir]
// Чеки: логин админом и аналитиком, все страницы кабинета, отчёт, справка, лендинг EN/ RU,
// консольные ошибки (кроме известных шумов), скриншоты в out/. Данные-зависимые проверки
// толерантные: страница отвечает и рендерит основной контент, точные числа не проверяются.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.PROD_URL ?? 'https://dashboardcamp.ru';
const ADMIN = {
  email: process.env.PCA_ADMIN_EMAIL ?? 'admin@dashboardcamp.ru',
  password: process.env.PCA_ADMIN_PASSWORD ?? '',
};
const ANALYST = {
  email: process.env.PCA_ANALYST_EMAIL ?? 'analyst@dashboardcamp.ru',
  password: process.env.PCA_ANALYST_PASSWORD ?? '',
};

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const LOCALE = argValue('--locale') ?? 'ru';
const OUT =
  argValue('--out') ??
  '/private/var/folders/4b/0y6yft3n5875tj4f6nys5ff80000gn/T/opencode/browser-regression';
mkdirSync(OUT, { recursive: true });

const CABINET_PAGES = [
  ['/app', 'первый экран'],
  ['/app/live', 'живые цели'],
  ['/app/goals', 'цели'],
  ['/app/kpi', 'kpi-плитки'],
  ['/app/traffic', 'трафик'],
  ['/app/behavior', 'поведение'],
  ['/app/funnel', 'воронка'],
  ['/app/funnel-live', 'воронка live'],
  ['/app/explore', 'разрезы'],
  ['/app/report', 'отчёт'],
  ['/app/history', 'история'],
  ['/app/b2b', 'b2b'],
  ['/app/marketing', 'маркетинг'],
  ['/app/hypotheses', 'гипотезы'],
  ['/app/decisions', 'решения'],
  ['/app/datalens', 'datalens'],
];
const ADMIN_PAGES = [
  ['/app/admin/users', 'пользователи'],
  ['/app/admin/metrika', 'метрика'],
  ['/app/admin/ai', 'ai-провайдеры'],
  ['/app/admin/integrations', 'интеграции'],
  ['/app/admin/audit', 'журнал'],
];

const results = [];
const note = (page, status, detail = '') => {
  results.push({ page, status, detail });
  console.log(`${status === 'PASS' ? '✅' : status === 'WARN' ? '🟡' : '❌'} ${page} — ${detail}`);
};

async function newSession(browser, { locale, email, password }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((loc) => globalThis.localStorage.setItem('pca.locale', loc), locale);
  // ANA-141: скрипты не должны видеть онбординг-тур — флаг гасит его на всех страницах.
  await ctx.addInitScript(() => globalThis.localStorage.setItem('qa-notour', '1'));
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');
  // Логин ведёт на `/app` (или /app/...), glob '**/app/**' голый /app не матчит.
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20000 });
  return { ctx, page, consoleErrors };
}

async function checkPage(page, path, label, shot) {
  const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500); // данные/графики догружаются
  if (!resp.ok()) return note(path, 'FAIL', `HTTP ${resp.status()}`);
  const h1 =
    (
      await page
        .locator('h1')
        .first()
        .textContent()
        .catch(() => '')
    )?.trim() ?? '';
  const bodyBlank = ((await page.locator('main, body').first().textContent()) ?? '').trim().length;
  await page.screenshot({ path: shot, fullPage: false });
  if (bodyBlank < 80)
    return note(path, 'WARN', `подозрительно пустой контент (${bodyBlank} симв.)`);
  return note(path, 'PASS', `h1="${h1.slice(0, 60)}"`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// --- Публичная часть ---
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((loc) => globalThis.localStorage.setItem('pca.locale', loc), LOCALE);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(OUT, 'landing.png') });
  const heroVisible = (await page.locator('h1').count()) > 0;
  note('/', heroVisible ? 'PASS' : 'FAIL', heroVisible ? 'лендинг рендерится' : 'нет h1');

  await page.goto(`${BASE}/help`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, 'help.png') });
  const helpOk = (await page.locator('text=/Начало|Getting started|Справка|Help/i').count()) > 0;
  note(
    '/help',
    helpOk ? 'PASS' : 'WARN',
    helpOk ? 'справка открывается' : 'маркер справки не найден',
  );
  if (errs.length) note('public console', 'WARN', errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// --- Аналитик ---
{
  const { ctx, page, consoleErrors } = await newSession(browser, { locale: LOCALE, ...ANALYST });
  for (const [path, label] of CABINET_PAGES) {
    await checkPage(page, path, label, join(OUT, `analyst${path.replaceAll('/', '_')}.png`));
  }
  // RBAC: админ-роут аналитику → страница «Нет доступа» (RequireAdmin, без редиректа)
  await page.goto(`${BASE}/app/admin/users`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const url = page.url();
  const denied =
    url.includes('/login') ||
    (await page.locator('text=/403|нет доступа|access denied|forbidden/i').count()) > 0;
  note('/app/admin/users (analyst)', denied ? 'PASS' : 'WARN', `итог: ${url.replace(BASE, '')}`);
  note(
    'analyst console',
    consoleErrors.length ? 'WARN' : 'PASS',
    `${consoleErrors.length} ошибок консоли${consoleErrors.length ? ': ' + consoleErrors.slice(0, 3).join(' | ') : ''}`,
  );
  await ctx.close();
}

// --- Админ ---
{
  const { ctx, page, consoleErrors } = await newSession(browser, { locale: LOCALE, ...ADMIN });
  for (const [path, label] of [...CABINET_PAGES, ...ADMIN_PAGES]) {
    await checkPage(page, path, label, join(OUT, `admin${path.replaceAll('/', '_')}.png`));
  }
  // Отчёт: снять скрин полностью (длинный)
  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, 'report-full.png'), fullPage: true });
  note(
    'console/admin',
    consoleErrors.length ? 'WARN' : 'PASS',
    `${consoleErrors.length} ошибок консоли${consoleErrors.length ? ': ' + consoleErrors.slice(0, 3).join(' | ') : ''}`,
  );
  await ctx.close();
}

await browser.close();

const fails = results.filter((r) => r.status === 'FAIL').length;
const warns = results.filter((r) => r.status === 'WARN').length;
console.log(
  `\nИТОГО: ${results.length - fails - warns} PASS, ${warns} WARN, ${fails} FAIL → скриншоты: ${OUT}`,
);
process.exit(fails > 0 ? 1 : 0);
