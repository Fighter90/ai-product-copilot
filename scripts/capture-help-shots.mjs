// Снятие скриншотов прода для документации/справки. Запуск: PCA_PASSWORD=... node scripts/capture-help-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'https://dashboardcamp.ru';
const OUT = 'code/frontend/public/screenshots';
mkdirSync(OUT, { recursive: true });

const EMAIL = process.env.PCA_EMAIL || 'admin@dashboardcamp.ru';
const PASS = process.env.PCA_PASSWORD || '';
if (!PASS) {
  console.error('PCA_PASSWORD required');
  process.exit(1);
}

const SHOTS = [
  ['01-landing', '/', null],
  ['02-login', '/login', null],
  ['03-overview', '/app', null],
  ['04-live', '/app/live', null],
  ['05-goals', '/app/goals', null],
  ['06-goal-detail', '/app/goals/328425726', null],
  ['07-funnel-live', '/app/funnel-live', null],
  ['08-traffic', '/app/traffic', null],
  ['09-behavior', '/app/behavior', null],
  ['10-funnel', '/app/funnel', null],
  ['11-kpi', '/app/kpi', null],
  ['12-explore', '/app/explore/sources', null],
  ['13-report', '/app/report', null],
  ['14-history', '/app/history', null],
  ['15-b2b', '/app/b2b', null],
  ['16-datalens', '/app/datalens', null],
  ['17-admin-users', '/app/admin/users', null],
  ['18-admin-ai', '/app/admin/ai', null],
  ['19-admin-metrika', '/app/admin/metrika', null],
  ['20-admin-integrations', '/app/admin/integrations', null],
  ['21-admin-audit', '/app/admin/audit', null],
  ['22-help', '/help', null],
  ['23-help-article', '/help/start', null],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Публичные
for (const [name, path] of SHOTS.slice(0, 2)) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

// Логин
await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForURL('**/app**', { timeout: 30000 });
await page.waitForTimeout(2500);

// Кабинет/админка
for (const [name, path] of SHOTS.slice(2)) {
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  } catch (e) {
    console.error('FAIL', name, String(e).slice(0, 120));
  }
}

// Ассистент: открыть и задать вопрос
try {
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const fab = page
    .locator('button[aria-label*="ссистент"], button[aria-label*="ssistant"]')
    .first();
  await fab.click({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.keyboard.type('Как добавить AI-провайдера?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/24-assistant.png` });
  console.log('shot 24-assistant');
} catch (e) {
  console.error('assistant FAIL', String(e).slice(0, 200));
}

await browser.close();
console.log('DONE');
