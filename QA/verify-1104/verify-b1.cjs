// Part B1: БАГ-01 (set EVENT_DATE via admin UI → единый дедлайн), 11 (segment), 12 (compare),
// 13 (goal detail), 08 (explore), 09 (insights), 02 (report finance), 06 (archived goals on admin).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const SHOTS = path.join(DIR, 'shots');
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log('§', k, JSON.stringify(v).slice(0, 500));
};
const periodRe = /(\d{1,2}\s?[а-яё]+\.?\s?20\d\d)\s*—\s*(\d{1,2}\s?[а-яё]+\.?\s?20\d\d)/;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(DIR, 'state.json'),
    // accept downloads for БАГ-04 later
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  // ---------- БАГ-01: admin/metrika — EVENT_DATE ----------
  await page.goto(`${BASE}/app/admin/metrika`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const evInput = page.locator('label:has-text("Дата события")').locator('input').first();
  const evCount = await evInput.count();
  const evBefore = evCount ? await evInput.inputValue() : 'input-not-found';
  log('bag01_eventdate_before', { evCount, evBefore });
  if (evCount) {
    await evInput.fill('2026-12-31');
    // save: find the form save button near that label
    const saveBtn = page.locator('button:has-text("Сохранить")').first();
    await saveBtn.click();
    await page.waitForTimeout(2500);
    const savedText = await page
      .evaluate(
        () =>
          document
            .querySelector('main')
            ?.textContent?.match(/Сохранено[^.]{0,80}|success[^.]{0,60}/i)?.[0] ?? null,
      )
      .catch(() => null);
    const evAfter = await evInput.inputValue().catch(() => null);
    log('bag01_eventdate_saved', { savedText, evAfter });
  }

  // Overview deadline with EVENT_DATE set
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=kpi-strip]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const hero1 = await page.locator('[data-testid=kpi-strip]').textContent();
  log('bag01_overview_after', {
    deadline: (hero1.match(/дедлайн\s*([^.\n]+)/) || [])[1]?.trim(),
    caveat: await page.locator('[data-testid=deadline-caveat]').count(),
    paceStatus: await page
      .locator('[data-testid=pace-status]')
      .textContent()
      .catch(() => null),
    visitsTile: null,
  });

  // KPI page deadline (прогноз)
  await page.goto(`${BASE}/app/kpi`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const kpiMain = await page.evaluate(() =>
    document.querySelector('main')?.textContent?.replace(/\s+/g, ' '),
  );
  log('bag01_kpi_after', {
    eventDeadline: (
      kpiMain.match(/дедлайн[у ]*—?[^,.]{0,40}|дата события\s*([^,.\n]{0,30})/g) || []
    ).slice(0, 6),
    note: await page
      .locator('[data-testid=deadline-note]')
      .textContent()
      .catch(() => null),
  });
  await page.screenshot({ path: path.join(SHOTS, 'bag01-kpi-eventdate.png') });

  // ---------- БАГ-06: archived goals on admin/metrika (GoalsManager) ----------
  await page.goto(`${BASE}/app/admin/metrika`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const goalsMgr = await page.evaluate(() => {
    const main = document.querySelector('main');
    const cb = [...main.querySelectorAll('label')].filter((l) =>
      /Архивные цели/.test(l.textContent),
    );
    const rows = [...main.querySelectorAll('table tbody tr')].map((tr) =>
      tr.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
    );
    return { hasToggle: cb.length, rowsCount: rows.length, rows: rows.slice(0, 10) };
  });
  log('bag06_admin_goals', goalsMgr);
  if (goalsMgr.hasToggle) {
    await page
      .locator('label:has-text("Архивные цели")')
      .first()
      .locator('input')
      .check()
      .catch(() => {});
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => {
      const main = document.querySelector('main');
      const rows = [...main.querySelectorAll('table tbody tr')].map((tr) =>
        tr.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
      );
      return { rowsCount: rows.length, rows: rows.slice(0, 12) };
    });
    log('bag06_admin_goals_archived_on', after);
    await page
      .locator('label:has-text("Архивные цели")')
      .first()
      .locator('input')
      .uncheck()
      .catch(() => {});
    await page.waitForTimeout(1000);
  }

  // ---------- БАГ-11: segment B2B on Overview (admin) ----------
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=kpi-strip]', { timeout: 30000 });
  const segSelect = page
    .locator('select[aria-label*="сегмент" i], select[name*=segment i]')
    .first();
  const segFound = await segSelect.count();
  if (!segFound) {
    // fallback: select with option B2C+B2B
    const byOpt = page.locator('select:has(option[value="b2b"])').first();
    if (await byOpt.count()) {
      await byOpt.selectOption('b2b');
    }
  } else {
    await segSelect.selectOption('b2b');
  }
  await page.waitForTimeout(3500);
  const seg11 = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid=kpi-strip]');
    const main = document.querySelector('main');
    const syncish = [...main.querySelectorAll('a,button,p,span')]
      .filter((el) => /синхрон|Sync|внести вручную|b2b_manual/i.test(el.textContent))
      .map((el) => ({
        tag: el.tagName,
        txt: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
      }));
    return {
      stripVisible: !!strip,
      hero: strip?.textContent?.replace(/\s+/g, ' ').slice(0, 260) ?? null,
      emptyBlock: main.textContent.match(/B2B-данные[^.]*\./)?.[0] ?? null,
      syncish: syncish.slice(0, 6),
    };
  });
  log('bag11_segment_b2b_admin', seg11);
  await page.screenshot({ path: path.join(SHOTS, 'bag11-b2b-admin.png') });
  const selBack = page.locator('select:has(option[value="b2b"])').first();
  await selBack.selectOption('b2c_b2b').catch(() => {});
  await page.waitForTimeout(1500);

  // analyst role: no sync suggestion
  const ctx2 = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
  });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p2.fill('input[type=email]', 'analyst@dashboardcamp.ru');
  await p2.fill('input[type=password]', 'DemoAnalyst-bf449de4!');
  await p2.click('button[type=submit]');
  const logged = await p2
    .waitForURL('**/app**', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  log('analyst_login', logged);
  if (logged) {
    await p2.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('[data-testid=kpi-strip]', { timeout: 30000 });
    const byOpt2 = p2.locator('select:has(option[value="b2b"])').first();
    await byOpt2.selectOption('b2b').catch(() => {});
    await p2.waitForTimeout(3500);
    const seg11a = await p2.evaluate(() => {
      const strip = document.querySelector('[data-testid=kpi-strip]');
      const main = document.querySelector('main');
      const syncish = [...main.querySelectorAll('a,button,p,span')]
        .filter((el) => /синхрон|b2b_manual|внести вручную|вносятся вручную/i.test(el.textContent))
        .map((el) => ({
          tag: el.tagName,
          txt: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 120),
        }));
      return {
        stripVisible: !!strip,
        hero: strip?.textContent?.replace(/\s+/g, ' ').slice(0, 200) ?? null,
        syncish: syncish.slice(0, 6),
      };
    });
    log('bag11_segment_b2b_analyst', seg11a);
    await p2.screenshot({ path: path.join(SHOTS, 'bag11-b2b-analyst.png') });
  }
  await ctx2.close();

  // ---------- БАГ-12: history compare via selects ----------
  await page.goto(`${BASE}/app/history`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const histSel = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('main select')];
    return sels.map((s) => ({
      options: [...s.options].slice(0, 12).map((o) => o.textContent.trim().slice(0, 80)),
    }));
  });
  log('bag12_selects', histSel);
  if (histSel.length >= 2 && histSel[0].options.length >= 2) {
    // pick first two distinct snapshots: new = index 0, old = index 1 (newest first in list)
    const sels = page.locator('main select');
    await sels.nth(0).selectOption({ index: 0 });
    await sels.nth(1).selectOption({ index: 1 });
    await page.waitForTimeout(2000);
    const diff = await page.evaluate(() => {
      const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
      return {
        old: t.match(/Старый:[^Н]{0,140}/)?.[0] ?? null,
        new: t.match(/Новый:[^С]{0,140}/)?.[0] ?? null,
        warn: t.match(/период[^.]{0,180}дн[^.]{0,80}\./)?.[0] ?? null,
      };
    });
    log('bag12_compare_result', diff);
    await page.screenshot({ path: path.join(SHOTS, 'bag12-compare.png') });
  }

  // ---------- БАГ-13: goal detail conversion caption ----------
  // find goal links from /app/goals (live list may 429) or admin page; try funnel/kpi goal link
  await page.goto(`${BASE}/app/goals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const goalLinks = await page.evaluate(() =>
    [...document.querySelectorAll('main a[href*="/app/goals/"]')]
      .map((a) => ({ href: a.getAttribute('href'), txt: a.textContent.trim().slice(0, 60) }))
      .slice(0, 5),
  );
  log('bag13_goal_links', goalLinks);
  if (goalLinks.length) {
    await page.goto(`${BASE}${goalLinks[0].href}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const conv = await page.evaluate(() => {
      const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
      return {
        cr: t.match(/Конверсия[^%.]{0,30}%?[^.]{0,80}/g)?.slice(0, 4) ?? null,
        byVisits: t.includes('по визитам с целью'),
      };
    });
    log('bag13_goal_detail', conv);
    await page.screenshot({ path: path.join(SHOTS, 'bag13-goal-detail.png') });
  }

  // ---------- БАГ-08: Explore grid ----------
  await page.goto(`${BASE}/app/explore/sources`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const exp = await page.evaluate(() => {
    const main = document.querySelector('main');
    const grid = main.querySelector('table');
    const banner =
      main.textContent.match(/временно недоступн[^.]{0,60}|квот[^.]{0,60}/i)?.[0] ?? null;
    return {
      hasTable: !!grid,
      head: grid ? [...grid.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : null,
      firstRows: grid
        ? [...grid.querySelectorAll('tbody tr')]
            .slice(0, 6)
            .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
        : null,
      totalRow: grid
        ? [...grid.querySelectorAll('tbody tr, tfoot tr')]
            .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
            .filter((r) => /итог/i.test(r.join(' ')))
        : null,
      banner,
    };
  });
  log('bag08_explore_grid', exp);
  await page.screenshot({ path: path.join(SHOTS, 'bag08-explore.png') });

  // ---------- БАГ-09: behavior insights vs tables ----------
  await page.goto(`${BASE}/app/behavior`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const beh = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    const insightsEl = [...main.querySelectorAll('h3')].find((h) =>
      /Ключевые наблюдения/.test(h.textContent),
    );
    const insights = insightsEl
      ? insightsEl.parentElement.textContent.replace(/\s+/g, ' ').slice(0, 900)
      : null;
    const avg = t.match(/Средние:[^В]{0,100}/)?.[0] ?? null;
    return { insights, avg };
  });
  log('bag09_behavior_insights', beh);

  // traffic insights too
  await page.goto(`${BASE}/app/traffic`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const traf = await page.evaluate(() => {
    const main = document.querySelector('main');
    const insightsEl = [...main.querySelectorAll('h3')].find((h) =>
      /Ключевые наблюдения/.test(h.textContent),
    );
    const insights = insightsEl
      ? insightsEl.parentElement.textContent.replace(/\s+/g, ' ').slice(0, 900)
      : null;
    return { insights };
  });
  log('bag09_traffic_insights', traf);

  // ---------- БАГ-02: report finance block ----------
  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const rep = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    return {
      paidBits: t.match(/Оплачено[^.]{0,120}/g)?.slice(0, 6) ?? null,
      gapBits: t.match(/[Оо]сталось[^.]{0,100}/g)?.slice(0, 4) ?? null,
      заявкаНеоплата: t.includes('заявка ≠ оплата'),
      aiCounter: t.match(/AI-гипотез[^.]{0,80}/)?.[0] ?? null,
      exportButtons: [...main.querySelectorAll('button, a')]
        .filter((b) => /DOCX|PDF|Скачать/i.test(b.textContent))
        .map((b) => b.textContent.trim()),
      ordersLabel: t.match(/Заказ[оa][вy][^%.]{0,80}/g)?.slice(0, 4) ?? null,
    };
  });
  log('bag02_report', rep);
  await page.screenshot({ path: path.join(SHOTS, 'bag02-report.png'), fullPage: true });

  fs.writeFileSync(path.join(DIR, 'result-b1.json'), JSON.stringify(R, null, 2));
  await browser.close();
  console.log('DONE B1');
})().catch((e) => {
  console.error('FAIL B1', e);
  process.exit(1);
});
