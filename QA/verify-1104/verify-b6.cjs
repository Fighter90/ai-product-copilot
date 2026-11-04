// Part B6: precise finishing. БАГ-07 per-table dupes (by header signature), БАГ-21 AI state with
// network, hyp id=5 existence check.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const SHOTS = path.join(DIR, 'shots');
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log('§', k, JSON.stringify(v).slice(0, 900));
};
const netLog = [];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(DIR, 'state.json'),
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/') && !u.includes('sentry'))
      netLog.push({ u: u.replace(BASE, ''), s: r.status(), m: r.request().method() });
  });

  // leftover hyp check
  const hyps = await page.request.get(`${BASE}/api/hypotheses`);
  const hypList = await hyps.json().catch(() => []);
  log(
    'hyps_leftover',
    (hypList || []).filter((h) => /QA/.test(h.title)).map((h) => ({ id: h.id, title: h.title })),
  );

  // ---------- БАГ-07: per-table dupes ----------
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=kpi-strip]', { timeout: 30000 });
  await page.waitForTimeout(3000);
  const tables = await page.evaluate(() => {
    const sig = (tb) =>
      [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim()).join('|');
    return [...document.querySelectorAll('main table')].map((tb) => ({
      sig: sig(tb),
      aria: tb.closest('[role=region]')?.getAttribute('aria-label') ?? null,
      rows: [...tb.querySelectorAll('tbody tr')]
        .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
        .slice(0, 30),
    }));
  });
  const pageTables = tables.filter((t) => /Страница/.test(t.sig));
  const utmTables = tables.filter((t) => /^Source\|/.test(t.sig));
  const normPage = (u) =>
    String(u)
      .toLowerCase()
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '') || '/';
  const analyze = (rows, keyFn) => {
    const seen = {};
    const dups = [];
    rows.map(keyFn).forEach((k) => {
      seen[k] = (seen[k] ?? 0) + 1;
    });
    for (const [k, n] of Object.entries(seen)) if (n > 1) dups.push({ key: k, n });
    return { rows: rows.length, dupKeys: dups, top5: rows.slice(0, 5).map((r) => r.join(' ')) };
  };
  log(
    'bag07_page_tables',
    pageTables.map((t) => ({ sig: t.sig, ...analyze(t.rows, (r) => normPage(r[0])) })),
  );
  log(
    'bag07_utm_tables',
    utmTables.map((t) => ({
      sig: t.sig,
      ...analyze(t.rows, (r) => `${r[0]}|${r[1]}|${r[2]}`.toLowerCase()),
    })),
  );

  // ---------- БАГ-21: build report → AI state ----------
  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const providers = await page.request.get(`${BASE}/api/ai/available`).catch(() => null);
  log('ai_available_api', {
    status: providers ? providers.status() : 'err',
    body: providers ? (await providers.text()).slice(0, 300) : null,
  });
  const buildBtn = page.locator('main button:has-text("Собрать отчёт")').first();
  if (await buildBtn.count()) {
    await buildBtn.click();
    await page
      .waitForSelector('main button:has-text("Export DOCX")', { timeout: 120000 })
      .catch(() => {});
    await page.waitForTimeout(3000);
  }
  const repAi = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    const genBtn = [...main.querySelectorAll('button')].find((b) =>
      /Сгенерировать AI|AI-анализ сгенерирован/.test(b.textContent),
    );
    const provSel = [...main.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => /Авто|Auto/.test(o.textContent)),
    );
    return {
      genBtn: genBtn
        ? {
            txt: genBtn.textContent.trim(),
            disabled: genBtn.disabled,
            title: genBtn.getAttribute('title'),
          }
        : null,
      provOpts: provSel ? [...provSel.options].map((o) => o.textContent.trim()) : null,
      aiCounter: t.match(/AI-гипотез[^.]{0,70}/)?.[0] ?? null,
      aiNotes: t.match(/AI-анализ[^.]{0,90}/g)?.slice(0, 5) ?? null,
      noProviders: t.match(/нет (настроенных|подключённых|доступных)[^.]{0,80}/i)?.[0] ?? null,
    };
  });
  log('bag21_ai_state', repAi);
  await page.screenshot({ path: path.join(SHOTS, 'bag21-ai-state.png'), fullPage: true });

  // click generate (if enabled) and watch network
  const genBtn = page.locator('main button:has-text("Сгенерировать AI-анализ")').first();
  if ((await genBtn.count()) && !(await genBtn.isDisabled().catch(() => true))) {
    await genBtn.click();
    let polled = null;
    let waited = 0;
    while (waited < 110) {
      await page.waitForTimeout(5000);
      waited += 5;
      polled = await page.evaluate(() => {
        const t = document.querySelector('main')?.textContent.replace(/\s+/g, ' ') ?? '';
        return {
          counter: t.match(/AI-гипотез[^.]{0,70}/)?.[0] ?? null,
          done: t.includes('AI-анализ сгенерирован'),
          pending: t.match(/генерир[^.]{0,80}/i)?.[0] ?? null,
          unavail: t.match(/недоступен[^.]{0,90}/)?.[0] ?? null,
        };
      });
      if (polled.done || polled.unavail) break;
    }
    const aiCalls = netLog.filter((e) => e.u.includes('insight') || e.u.includes('/ai/'));
    log('bag21_generate', { polled, waited, aiCalls: aiCalls.slice(-6) });
    await page.screenshot({ path: path.join(SHOTS, 'bag21-after-gen.png'), fullPage: true });
  } else {
    log('bag21_generate', 'generate button missing or disabled');
  }

  fs.writeFileSync(path.join(DIR, 'result-b6.json'), JSON.stringify(R, null, 2));
  fs.writeFileSync(path.join(DIR, 'netlog-b6.json'), JSON.stringify(netLog, null, 2));
  await browser.close();
  console.log('DONE B6');
})().catch((e) => {
  console.error('FAIL B6', e);
  process.exit(1);
});
