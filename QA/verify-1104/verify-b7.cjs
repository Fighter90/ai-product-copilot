// B7: diagnose AI generate click — console errors, all network, button state after click.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log('§', k, JSON.stringify(v).slice(0, 900));
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(DIR, 'state.json'),
  });
  const page = await ctx.newPage();
  const calls = [];
  const cons = [];
  page.on('request', (r) => {
    if (!r.url().includes('sentry')) calls.push({ m: r.method(), u: r.url().replace(BASE, '') });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') cons.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (e) => cons.push('PAGEERROR ' + String(e).slice(0, 300)));

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
  const genBtn = page.locator('main button:has-text("Сгенерировать AI-анализ")').first();
  const before = await genBtn.evaluate((b) => ({
    disabled: b.disabled,
    txt: b.textContent.trim(),
  }));
  log('btn_before', before);
  await genBtn.click();
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    const progress = !!main.querySelector('[role=progressbar], [class*=progress]');
    const btnStill = [...main.querySelectorAll('button')].find((b) =>
      /Сгенерировать AI|AI-анализ сгенерирован/.test(b.textContent),
    );
    return {
      progressVisible: progress,
      pendingNote: t.includes('Генерация') || t.includes('анализ генерируется'),
      aiCounter: t.match(/AI-гипотез[^.]{0,50}/)?.[0] ?? null,
      errBox: main.querySelector('[role=alert]')?.textContent?.slice(0, 200) ?? null,
      btnNow: btnStill ? { txt: btnStill.textContent.trim(), disabled: btnStill.disabled } : null,
    };
  });
  log('after_click_6s', after);
  const insightCalls = calls.filter((c) => /insight|\/ai\//.test(c.u));
  log('insight_calls', insightCalls);
  log('console_errs', cons.slice(0, 10));
  await page.waitForTimeout(30000);
  const late = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent.replace(/\s+/g, ' ') ?? '';
    return {
      done: t.includes('AI-анализ сгенерирован'),
      counter: t.match(/AI-гипотез[^.]{0,50}/)?.[0] ?? null,
      pending: !!document.querySelector('[class*=progress]'),
    };
  });
  log('after_36s', late);
  const insightCallsLate = calls.filter((c) => /insight|\/ai\//.test(c.u));
  log('insight_calls_late', insightCallsLate);
  fs.writeFileSync(path.join(DIR, 'result-b7.json'), JSON.stringify(R, null, 2));
  await browser.close();
  console.log('DONE B7');
})().catch((e) => {
  console.error('FAIL B7', e);
  process.exit(1);
});
