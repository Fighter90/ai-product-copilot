// E2E-проверка прода в headless Chrome: логин, обход всех страниц, сбор console-ошибок.
// Запуск: PCA_PASSWORD='...' node scripts/e2e-prod-check.mjs [base_url]
// Вердикт: PASS / FAIL (exit 0/1). Playwright берётся из pnpm-стора проекта.
import { chromium } from '/Users/sergejemelanov/Projects/ai-product-copilot/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'https://dashboardcamp.ru';
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
  // 401 на /api/auth/me у гостя — ожидаемый шум (неавторизованный), не баг.
  if (text.includes('status of 401')) return;
  const arr = consoleErrors.get(current) ?? [];
  arr.push(text.slice(0, 160));
  consoleErrors.set(current, arr);
});

// Минимальный «осмысленный» размер HTML: /login и /help — компактные каркасы SPA.
const MIN_LEN = (name) => (name === 'login' || name.startsWith('help') ? 8000 : 20000);

const results = [];
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

// 5. Язык EN + тема
current = 'i18n-theme';
try {
  await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    localStorage.setItem('pca.locale', 'en');
    // eslint-disable-next-line no-undef
    localStorage.setItem('pca.theme', 'light');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const en =
    (await page.content()).includes('OVERVIEW') || (await page.content()).includes('Overview');
  results.push(['i18n-theme', en ? 'ok' : 'check', 0, []]);
  await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    localStorage.setItem('pca.locale', 'ru');
    // eslint-disable-next-line no-undef
    localStorage.setItem('pca.theme', 'dark');
  });
} catch (e) {
  results.push(['i18n-theme', 'FAIL', 0, [String(e).slice(0, 120)]]);
}

await browser.close();

// Вердикт
let fails = 0;
console.log('\n=== E2E ПРОДА:', BASE, '===');
for (const [name, status, len, errs] of results) {
  const bad = status === 'FAIL' || (errs?.length ?? 0) > 0;
  if (bad) fails++;
  console.log(
    `${bad ? '✗' : '✓'} ${name.padEnd(18)} ${status.padEnd(6)} len=${len}${errs?.length ? ' | ' + errs.join(' ; ') : ''}`,
  );
}
console.log(`\nИтого: ${results.length - fails}/${results.length} ok, ошибок: ${fails}`);
console.log(fails === 0 ? 'VERDICT: PASS' : 'VERDICT: FAIL');
process.exit(fails === 0 ? 0 : 1);
