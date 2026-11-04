// Prod verification part 4: БАГ-19 (payments), БАГ-20 (charts), БАГ-21 (report).
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
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(__dirname, '.state.json'),
  });
  const page = await ctx.newPage();

  // ---------- БАГ-19: B2C payments card on /app/funnel ----------
  await page.goto(`${BASE}/app/funnel`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=b2c-days-count]', { timeout: 30000 });
  const daysBefore = await page.getByTestId('b2c-days-count').textContent();
  // Save a 0-ticket day for today (does not change paid totals; safe to delete right away).
  await page.fill('form input[type=date]', today);
  await page.fill('form input[type=number]', '0');
  await page.getByRole('button', { name: 'Сохранить день' }).click();
  await page.waitForSelector(`[data-testid=b2c-row-${today}]`, { timeout: 15000 });
  const rowText = await page.getByTestId(`b2c-row-${today}`).textContent();
  const savedMsg = await page
    .locator('[role=status]')
    .last()
    .textContent()
    .catch(() => null);
  log('bag19_saved', { rowText: rowText?.slice(0, 120), savedMsg, daysBefore });
  await page.screenshot({ path: path.join(SHOTS, 'bag19-saved.png') });

  // Delete → stale «Оплаты за … сохранены» must disappear.
  await page.getByRole('button', { name: `Удалить день: ${today}` }).click();
  await page.waitForTimeout(1500);
  const afterDelete = await page.evaluate(
    (d) => ({
      rowGone: !document.querySelector(`[data-testid=b2c-row-${d}]`),
      staleStatuses: [...document.querySelectorAll('[role=status]')]
        .map((e) => e.textContent)
        .filter((t) => t && t.includes('сохранены')),
      daysAfter: document.querySelector('[data-testid=b2c-days-count]')?.textContent ?? null,
    }),
    today,
  );
  log('bag19_after_delete', afterDelete);
  await page.screenshot({ path: path.join(SHOTS, 'bag19-deleted.png') });

  // ---------- БАГ-20: traffic + behavior charts ----------
  await page.goto(`${BASE}/app/traffic`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000); // charts render
  await page.screenshot({ path: path.join(SHOTS, 'bag20-traffic.png'), fullPage: true });
  await page.goto(`${BASE}/app/behavior`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(SHOTS, 'bag20-behavior.png'), fullPage: true });
  log('bag20_screenshots', ['bag20-traffic.png', 'bag20-behavior.png']);

  // ---------- БАГ-21: report ----------
  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const buildBtn = page.getByRole('button', { name: /Собрать отчёт/ }).first();
  await buildBtn.click();
  // Wait for the built snapshot KPI strip.
  await page.waitForSelector('text=AI-гипотез', { timeout: 60000 });
  await page.waitForTimeout(1500);
  const reportState1 = await page.evaluate(() => {
    const main = document.querySelector('main');
    const b2bTiles = [...main.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && /Оплачено B2B/.test(el.textContent ?? ''),
    ).length;
    const aiLine = main?.innerText.match(/AI-гипотез: [^\n]*/)?.[0] ?? null;
    const generatedBy = main?.innerText.match(/Сгенерировано:[^\n]*/)?.[0] ?? null;
    const ordersCreated = (main?.innerText.match(/ЗАКАЗОВ СОЗДАНО/gi) ?? []).length;
    return { b2bTiles, aiLine, generatedBy, ordersCreated };
  });
  log('bag21_right_after_build', reportState1);
  await page.screenshot({ path: path.join(SHOTS, 'bag21-report-fresh.png') });

  // Poll up to 100s for the AI counter to fill in (БАГ-21: the page polls the snapshot).
  let finalAi = reportState1.aiLine;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(5000);
    finalAi = await page.evaluate(
      () => document.querySelector('main')?.innerText.match(/AI-гипотез: [^\n]*/)?.[0] ?? null,
    );
    if (finalAi && !finalAi.includes('не сгенерированы')) break;
  }
  const reportState2 = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      aiLine: main?.innerText.match(/AI-гипотез: [^\n]*/)?.[0] ?? null,
      generatedBy: main?.innerText.match(/Сгенерировано:[^\n]*/)?.[0] ?? null,
    };
  });
  log('bag21_after_poll', { waited: true, ...reportState2 });
  await page.screenshot({ path: path.join(SHOTS, 'bag21-report-final.png') });

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'result-part4.json'), JSON.stringify(R, null, 2));
  console.log('DONE part4');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
