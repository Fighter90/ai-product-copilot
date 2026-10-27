// E2E-проверка прода в headless Chrome: логин, обход всех страниц, сбор console-ошибок.
// + интеграционные API-проверки (LLM, Метрика, DataLens, отчёты, RBAC) — scripts/e2e-prod-integrations.mjs.
// Запуск: PCA_PASSWORD='...' [PCA_ANALYST_PASSWORD='...'] node scripts/e2e-prod-check.mjs [base_url] [--ai] [--api-only]
//   --ai        дополнительно живые LLM-проверки: test провайдеров + POST /api/report/insights и /hypotheses (до 600 c каждый, тратит LLM-квоту)
//   --api-only  пропустить браузерную часть
// Вердикт: PASS / FAIL (exit 0/1); SKIP/WARN вердикт не валят. Playwright берётся из pnpm-стора проекта.
import { chromium } from '/Users/sergejemelanov/Projects/ai-product-copilot/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { runIntegrationChecks, printVerdict } from './e2e-prod-integrations.mjs';

const ARGS = process.argv.slice(2);
const BASE = ARGS.find((a) => !a.startsWith('--')) || 'https://dashboardcamp.ru';
const AI = ARGS.includes('--ai');
const API_ONLY = ARGS.includes('--api-only');
const EMAIL = process.env.PCA_EMAIL || 'admin@dashboardcamp.ru';
const PASS = process.env.PCA_PASSWORD || '';
if (!PASS) {
  console.error('PCA_PASSWORD required');
  process.exit(1);
}
mkdirSync('/tmp/pca-e2e-check', { recursive: true });

const PAGES = [
  ['landing', '/'],
  ['login', '/login'],
  ['help', '/help'],
  ['help-article', '/help/start'],
  ['help-metrics', '/help/metrics'],
  ['overview', '/app'],
  ['live', '/app/live'],
  ['goals', '/app/goals'],
  ['goal-detail', '/app/goals/328425726'],
  ['funnel-live', '/app/funnel-live'],
  ['traffic', '/app/traffic'],
  ['behavior', '/app/behavior'],
  ['funnel', '/app/funnel'],
  ['kpi', '/app/kpi'],
  ['explore', '/app/explore/sources'],
  ['report', '/app/report'],
  ['history', '/app/history'],
  ['b2b', '/app/b2b'],
  ['datalens', '/app/datalens'],
  ['admin-users', '/app/admin/users'],
  ['admin-ai', '/app/admin/ai'],
  ['admin-metrika', '/app/admin/metrika'],
  ['admin-integrations', '/app/admin/integrations'],
  ['admin-audit', '/app/admin/audit'],
];

const results = [];

if (!API_ONLY) {
  // Приоритет — системный Chrome (channel:'chrome'): не зависит от кэша ms-playwright,
  // который чистится mac_cleanup.sh. Fallback — установленный playwright-chromium.
  let browserType;
  try {
    await chromium.launch({ channel: 'chrome', headless: true }).then((b) => b.close());
    browserType = { channel: 'chrome', headless: true };
  } catch {
    browserType = { headless: true };
  }
  const browser = await chromium.launch(browserType);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = new Map(); // page → string[]
  let current = 'init';
  page.on('pageerror', (e) => {
    const arr = consoleErrors.get(current) ?? [];
    arr.push(`pageerror: ${e.message}`);
    consoleErrors.set(current, arr);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // ГОСТЬ: новый контракт — гость получает /api/auth/me → 200 {user:null}, значит 401-шума больше нет.
    // Любой console 401 теперь — реальная проблема защищённого роута → фиксируем как ошибку.
    if (text.includes('status of 401')) {
      const arr = consoleErrors.get(current) ?? [];
      arr.push('UNEXPECTED-401: ' + text.slice(0, 140));
      consoleErrors.set(current, arr);
      return;
    }
    const arr = consoleErrors.get(current) ?? [];
    arr.push(text.slice(0, 160));
    consoleErrors.set(current, arr);
  });

  // Минимальный «осмысленный» размер HTML: /login и /help — компактные каркасы SPA.
  const MIN_LEN = (name) => (name === 'login' || name.startsWith('help') ? 8000 : 20000);

  const shot = async (name) => page.screenshot({ path: `/tmp/pca-e2e-check/${name}.png` });

  // 1. Публичные
  for (const [name, path] of PAGES.slice(0, 4)) {
    current = name;
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);
    const len = (await page.content()).length;
    results.push([name, len > MIN_LEN(name) ? 'ok' : 'thin', len, consoleErrors.get(name) ?? []]);
    await shot(name);
  }

  // 1b. Локаль EN на публичной странице (spot-check перевода)
  current = 'i18n-public-en';
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => globalThis.localStorage.setItem('pca.locale', 'en'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const html = await page.content();
    const en = /ANALYTICS|DASHBOARD|GET STARTED|OVERVIEW/i.test(html.replace(/<[^>]+>/g, ' '));
    results.push(['i18n-public-en', en ? 'ok' : 'check', html.length, []]);
    await shot('i18n-public-en');
    await page.evaluate(() => globalThis.localStorage.setItem('pca.locale', 'ru'));
    await page.reload({ waitUntil: 'networkidle' });
  } catch (e) {
    results.push(['i18n-public-en', 'FAIL', 0, [String(e).slice(0, 120)]]);
  }

  // 2. Логин
  current = 'login-action';
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL('**/app**', { timeout: 30000 });
    results.push(['login', 'ok', (await page.content()).length, []]);
  } catch {
    results.push(['login', 'FAIL', 0, ['no redirect to /app']]);
  }

  // 3. Кабинет + админка
  for (const [name, path] of PAGES.slice(4)) {
    current = name;
    try {
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(1500);
      const len = (await page.content()).length;
      results.push([name, len > MIN_LEN(name) ? 'ok' : 'thin', len, consoleErrors.get(name) ?? []]);
      if (['overview', 'live', 'kpi', 'datalens'].includes(name)) await shot(name);
    } catch (e) {
      results.push([name, 'FAIL', 0, [String(e).slice(0, 120)]]);
    }
  }

  // 3b. KPI-плитки реально рендерятся (не empty state)
  current = 'kpi-tiles';
  try {
    await page.goto(BASE + '/app/kpi', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2500);
    const tiles = await page
      .locator(
        'main [class*="tile" i], main [data-tile], main [class*="card" i], section [class*="tile" i]',
      )
      .count();
    const hasDigits = /[0-9]/.test((await page.textContent('body')) ?? '');
    results.push([
      'kpi-tiles',
      tiles > 0 && hasDigits ? 'ok' : 'check',
      tiles,
      [],
      `tiles=${tiles} digits=${hasDigits}`,
    ]);
    await shot('kpi-tiles');
  } catch (e) {
    results.push(['kpi-tiles', 'FAIL', 0, [String(e).slice(0, 120)]]);
  }

  // 4. Ассистент: вопрос → ответ, экран живой
  current = 'assistant';
  try {
    await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page
      .locator('button[aria-label*="ссистент"], button[aria-label*="ssistant"]')
      .first()
      .click({ timeout: 8000 });
    const box = page.locator('textarea, input[placeholder]').last();
    await box.click();
    await box.fill('Как подключить DataLens?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(10000);
    const len = (await page.content()).length;
    results.push([
      'assistant',
      len > 30000 ? 'ok' : 'thin',
      len,
      consoleErrors.get('assistant') ?? [],
    ]);
    await shot('assistant');
  } catch (e) {
    results.push(['assistant', 'FAIL', 0, [String(e).slice(0, 120)]]);
  }

  // 5. Язык EN + тема (кабинет, после логина)
  current = 'i18n-theme';
  try {
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      globalThis.localStorage.setItem('pca.locale', 'en');
      // eslint-disable-next-line no-undef
      globalThis.localStorage.setItem('pca.theme', 'light');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const en =
      (await page.content()).includes('OVERVIEW') || (await page.content()).includes('Overview');
    results.push(['i18n-theme', en ? 'ok' : 'check', 0, []]);
    await shot('i18n-theme');
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      globalThis.localStorage.setItem('pca.locale', 'ru');
      // eslint-disable-next-line no-undef
      globalThis.localStorage.setItem('pca.theme', 'dark');
    });
  } catch (e) {
    results.push(['i18n-theme', 'FAIL', 0, [String(e).slice(0, 120)]]);
  }

  await browser.close();
}

// 6. Интеграции (API)
try {
  results.push(
    ...(await runIntegrationChecks({
      base: BASE,
      email: EMAIL,
      password: PASS,
      analystPassword: process.env.PCA_ANALYST_PASSWORD || '',
      ai: AI,
    })),
  );
} catch (e) {
  results.push(['integrations', 'FAIL', 0, [String(e).slice(0, 160)]]);
}

// Вердикт
process.exit(printVerdict(BASE, results));
