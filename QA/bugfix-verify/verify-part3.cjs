// Prod verification part 3: БАГ-16 (mobile 390 behavior), БАГ-17 (goals), БАГ-18 (period persist).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dashboardcamp.ru';
const SHOTS = path.join(__dirname, 'shots');
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log(`${k}: ${JSON.stringify(v)}`);
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // ---------- БАГ-16: /app/behavior at 390px ----------
  const mob = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ru-RU',
    isMobile: true,
    hasTouch: true,
    storageState: path.join(__dirname, '.state.json'),
  });
  const mp = await mob.newPage();
  await mp.goto(`${BASE}/app/behavior`, { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('main h1, main h2', { timeout: 30000 });
  await mp.waitForTimeout(6000); // charts + tables
  const mobState = await mp.evaluate(() => {
    const de = document.documentElement;
    // Widest offender (element wider than the viewport).
    let widest = null;
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > de.clientWidth + 1 && !widest)
        widest = `${el.tagName}.${String(el.className).slice(0, 60)} w=${Math.round(r.width)}`;
    });
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overflow: de.scrollWidth - de.clientWidth,
      widest,
      hasLongUrlText: /productcamp|dashboardcamp\.ru\/\S{30,}/.test(document.body.innerText),
    };
  });
  log('bag16_mobile_behavior', mobState);
  await mp.screenshot({ path: path.join(SHOTS, 'bag16-behavior-390.png'), fullPage: true });
  await mob.close();

  // ---------- БАГ-17: /app/goals ----------
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(__dirname, '.state.json'),
  });
  const page = await ctx.newPage();
  const goalsCalls = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/live/goals')) {
      goalsCalls.push({ url: req.url().replace(BASE, ''), t: Date.now() });
    }
  });
  page.on('response', (res) => {
    if (res.url().includes('/api/live/goals')) {
      const call = goalsCalls.find((c) => c.url === res.url().replace(BASE, '') && !c.status);
      if (call) {
        call.status = res.status();
        call.ms = Date.now() - call.t;
      }
    }
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/app/goals`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main table, main [role=alert], main .skeleton', { timeout: 30000 });
  // Wait until the grid actually renders rows or an error/empty state shows.
  await page.waitForTimeout(8000);
  const goalsUi = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      header: main?.querySelector('h1')?.textContent?.trim(),
      rowCount: main?.querySelectorAll('tbody tr').length ?? 0,
      quotaBanner: /квот|недоступн/i.test(main?.innerText ?? ''),
      alertText: main?.querySelector('[role=alert]')?.textContent?.slice(0, 120) ?? null,
    };
  });
  log('bag17_goals', { wallMs: Date.now() - t0, ui: goalsUi, calls: goalsCalls });
  await page.screenshot({ path: path.join(SHOTS, 'bag17-goals.png') });

  // ---------- БАГ-18: period persists across reload ----------
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type=date]', { timeout: 30000 });
  const before = await page.$$eval('input[type=date]', (els) => els.map((e) => e.value));
  // Click the 30-day preset in the sticky header (button «30 дней»).
  const presetBtn = page.getByRole('button', { name: /30 дней/i }).first();
  const presetFound = (await presetBtn.count()) > 0;
  if (presetFound) {
    await presetBtn.click();
    await page.waitForTimeout(1500);
  }
  const afterPreset = await page.$$eval('input[type=date]', (els) => els.map((e) => e.value));
  const ls = await page.evaluate(() => localStorage.getItem('pca.filters'));
  // Reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type=date]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const afterReload = await page.$$eval('input[type=date]', (els) => els.map((e) => e.value));
  log('bag18_period', { before, presetFound, afterPreset, afterReload, localStorage: ls });

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'result-part3.json'), JSON.stringify(R, null, 2));
  console.log('DONE part3');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
