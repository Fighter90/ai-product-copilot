// B8: capture POST /api/report/insights status + response + final UI state.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log('§', k, JSON.stringify(v).slice(0, 1200));
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(DIR, 'state.json'),
  });
  const page = await ctx.newPage();
  let postInfo = null;
  page.on('response', async (r) => {
    if (r.url().includes('/report/insights')) {
      let body = '';
      try {
        body = (await r.text()).slice(0, 600);
      } catch {
        body = '<no body>';
      }
      postInfo = { status: r.status(), body };
    }
  });

  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const buildBtn = page.locator('main button:has-text("Собрать отчёт")').first();
  if (await buildBtn.count()) {
    await buildBtn.click();
    await page
      .waitForSelector('main button:has-text("Export DOCX")', { timeout: 120000 })
      .catch(() => {});
    await page.waitForTimeout(3000);
  }
  await page.locator('main button:has-text("Сгенерировать AI-анализ")').first().click();
  // poll up to 150s
  let state = null;
  let waited = 0;
  while (waited < 150) {
    await page.waitForTimeout(5000);
    waited += 5;
    state = await page.evaluate(() => {
      const main = document.querySelector('main');
      const t = main.textContent.replace(/\s+/g, ' ');
      return {
        done: t.includes('AI-анализ сгенерирован'),
        pending: t.includes('Генерация') || t.includes('генерируется'),
        unavail: t.match(/AI-анализ недоступен[^.]{0,120}/)?.[0] ?? null,
        narrativeHead:
          t.match(/AI-анализ \(интерпретация[^)]*\)[^И]{0,160}/)?.[0]?.slice(0, 220) ?? null,
      };
    });
    if (state.done || state.unavail) break;
  }
  log('final_state', { state, waited, postInfo });
  await page.screenshot({ path: path.join(DIR, 'shots', 'bag21-final.png'), fullPage: true });
  fs.writeFileSync(path.join(DIR, 'result-b8.json'), JSON.stringify(R, null, 2));
  await browser.close();
  console.log('DONE B8');
})().catch((e) => {
  console.error('FAIL B8', e);
  process.exit(1);
});
