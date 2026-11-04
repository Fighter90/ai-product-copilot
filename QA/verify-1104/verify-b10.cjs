// B10: БАГ-06 last attempt — /app/goals DataGrid rows with archived toggle off/on.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const log = (k, v) => {
  console.log('§', k, JSON.stringify(v).slice(0, 600));
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    locale: 'ru-RU',
    storageState: path.join(DIR, 'state.json'),
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app/goals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  const apiInfo = await page.evaluate(async () => {
    const r = await fetch('/api/live/goals?from=2026-10-06&to=2026-11-04&test=0');
    if (r.status !== 200) return { status: r.status };
    const j = await r.json();
    const goals = j.goals ?? [];
    return {
      status: r.status,
      total: goals.length,
      archived: goals.filter((g) => g.archived === true || g.isArchived === true).length,
    };
  });
  log('bag06_live_goals_api', apiInfo);
  const readTable = () =>
    page.evaluate(() => {
      const tb = document.querySelector('main table');
      return tb
        ? {
            rows: tb.querySelectorAll('tbody tr').length,
            first3: [...tb.querySelectorAll('tbody tr')]
              .slice(0, 3)
              .map((tr) => tr.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)),
          }
        : { rows: -1 };
    });
  const off = await readTable();
  log('bag06_table_off', off);
  const archCb = page.locator('label:has-text("Архивные цели")').first();
  if (await archCb.count()) {
    await archCb
      .locator('input')
      .check()
      .catch(() => {});
    await page.waitForTimeout(2000);
    const on = await readTable();
    log('bag06_table_on', on);
  }
  await page.screenshot({ path: path.join(DIR, 'shots', 'bag06-final.png') });
  await browser.close();
  console.log('DONE B10');
})().catch((e) => {
  console.error('FAIL B10', e);
  process.exit(1);
});
