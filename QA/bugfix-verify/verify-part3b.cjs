// Prod verification part 3b: БАГ-18 — period persists across reload (via preset + localStorage).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dashboardcamp.ru';
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log(`${k}: ${JSON.stringify(v)}`);
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(__dirname, '.state.json'),
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header span.font-mono', { timeout: 30000 });
  const periodText = () =>
    page.evaluate(() => document.querySelector('header span.font-mono')?.textContent ?? null);
  const ls = () => page.evaluate(() => localStorage.getItem('pca.filters'));

  const before = { period: await periodText(), ls: await ls() };
  log('bag18_before', before);

  // Click the «30д» preset.
  const preset = page.getByRole('button', { name: 'Показать данные за последние 30 дней' });
  if ((await preset.count()) === 0) {
    log('bag18_error', 'preset button not found');
  } else {
    await preset.click();
    await page.waitForTimeout(1500);
    const afterPreset = { period: await periodText(), ls: await ls() };
    log('bag18_after_preset', afterPreset);

    // Reload → period must survive (БАГ-18).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header span.font-mono', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const afterReload = { period: await periodText(), ls: await ls() };
    log('bag18_after_reload', afterReload);

    // Also: another page keeps it (SPA navigation).
    await page.goto(`${BASE}/app/traffic`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header span.font-mono', { timeout: 30000 });
    const otherPage = { period: await periodText() };
    log('bag18_other_page', otherPage);
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'result-part3b.json'), JSON.stringify(R, null, 2));
  console.log('DONE part3b');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
