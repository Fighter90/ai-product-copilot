// Read-only prod verification, part A (2026-11-04, prod v3.3.1 b5c4231).
// Covers: БАГ-01 (deadline), 02 (paid/unified + заявки label), 06 (archived goals),
// 07 (top dupes), 08 (weighted avg), 09 (observations), 10 (funnel), 11 (B2B segment),
// 12 (history compare), 13 (goal conversion caption), 16 (mobile behavior), 17 (goals speed),
// 18 (period persist), 20 (chart shots), 22 (live title).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const SHOTS = path.join(DIR, 'shots');
const API_DUMP = {};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(DIR, 'state.json'),
  });
  const page = await ctx.newPage();
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/') && r.request().method() === 'GET' && !u.includes('sentry')) {
      API_DUMP[u.replace(BASE, '')] = { status: r.status() };
    }
  });

  const authed = await (async () => {
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    return !page.url().includes('/login');
  })();
  console.log('AUTHED', authed);
  if (!authed) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type=email]', 'admin@dashboardcamp.ru');
    await page.fill('input[type=password]', 'DemoAdmin-c8ea7234!');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20000 }),
      page.click('button[type=submit]'),
    ]);
    await page.waitForURL('**/app**', { timeout: 15000 }).catch(() => {});
    await ctx.storageState({ path: path.join(DIR, 'state.json') });
  }

  const R = {};
  const log = (k, v) => {
    R[k] = v;
    console.log('§', k, JSON.stringify(v).slice(0, 400));
  };
  const api = (sfx) => Object.keys(API_DUMP).filter((u) => u.includes(sfx));
  const grabJson = async (url) => {
    const res = await page.request.get(url);
    return { status: res.status(), body: res.status() === 200 ? await res.json() : null };
  };

  // ---------- EVENT_DATE setting (БАГ-01) ----------
  const settings = await grabJson(`${BASE}/api/settings`).catch((e) => ({ err: String(e) }));
  log('settings', {
    status: settings.status,
    keys: settings.body ? Object.keys(settings.body) : null,
    eventDate: settings.body?.EVENT_DATE ?? settings.body?.settings?.EVENT_DATE,
    kpi: settings.body?.KPI_TARGET ?? settings.body?.settings?.KPI_TARGET,
  });

  // ---------- БАГ-01/02/07/09/11: Overview ----------
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=kpi-strip]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const period0 = await page
    .locator('main')
    .textContent()
    .then(
      (t) =>
        (t.match(
          /\d{1,2}[^]{0,3}[а-яё]{3}[^]{0,3}20\d\d[^]{0,3}—[^]{0,3}\d{1,2}[^]{0,3}[а-яё]{3}[^]{0,3}20\d\d/,
        ) || [null])[0],
    )
    .catch(() => null);
  const heroText = await page.locator('[data-testid=kpi-strip]').textContent();
  const paceStatus = await page
    .locator('[data-testid=pace-status]')
    .textContent()
    .catch(() => null);
  const forecastLine = (heroText.match(/Прогноз:[^·]*·\s*дедлайн\s*([^.\n]+)/) || [null, null])[1];
  const caveat = await page.locator('[data-testid=deadline-caveat]').count();
  const caveatText = caveat
    ? await page.locator('[data-testid=deadline-caveat]').first().textContent()
    : null;
  const tiles = await page.$$eval('[data-testid=kpi-tiles] > div', (els) =>
    els.map((el) => ({
      label: el.querySelector('.uppercase')?.textContent?.trim(),
      value: el.querySelector('.text-xl, .text-2xl')?.textContent?.trim(),
      hint: el.lastElementChild?.textContent?.trim(),
    })),
  );
  log('bag01_overview', {
    paceStatus,
    forecastLine,
    deadlineFromHero: forecastLine,
    caveatCount: caveat,
    caveatText,
  });
  log('bag02_overview_tiles', tiles);
  log('bag18_period_initial', { period: period0 });

  // payments summary (the unified paid source)
  const payUrls = api('/api/payments/summary');
  const pays = payUrls.length ? await grabJson(`${BASE}${payUrls[0]}`) : { status: 'not-captured' };
  log('bag02_payments_summary', { url: payUrls[0], status: pays.status, body: pays.body });

  // Top pages / UTM (БАГ-07)
  const lists = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('section, div').forEach(() => {});
    const cards = [...document.querySelectorAll('main h2, main h3')];
    cards.forEach((h) => {
      const card =
        h.closest('section, div.rounded, div[class*=card]') || h.parentElement?.parentElement;
      if (!card) return;
      const rows = [...card.querySelectorAll('table tbody tr, ul li')]
        .slice(0, 30)
        .map((tr) => tr.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (rows.length && /Топ|UTM/.test(h.textContent)) out[h.textContent.trim()] = rows;
    });
    return out;
  });
  log('bag07_top_lists', lists);

  // Observations (БАГ-09)
  const obsText = await page.evaluate(() => {
    const el = [...document.querySelectorAll('main h2, main h3, main strong')].find((h) =>
      /Ключевые наблюдения/i.test(h.textContent),
    );
    if (!el) return null;
    const block = el.closest('section, div') || el.parentElement;
    return block ? block.textContent.replace(/\s+/g, ' ').trim().slice(0, 1200) : null;
  });
  log('bag09_observations', obsText);

  // weak spots table for cross-check
  const weakRows = await page.evaluate(() => {
    const el = [...document.querySelectorAll('main h2')].find((h) =>
      /Слабые места/i.test(h.textContent),
    );
    if (!el) return null;
    const card = el.closest('section') || el.parentElement;
    return [...(card?.querySelectorAll('table tbody tr') ?? [])]
      .slice(0, 8)
      .map((tr) => tr.textContent.replace(/\s+/g, ' ').trim());
  });
  log('bag09_weak_rows', weakRows);

  // channel mix rows for observations cross-check
  const mixApi = api('/api/metrics/channel');
  const mix = mixApi.length ? await grabJson(`${BASE}${mixApi[0]}`) : null;
  log('bag09_channel_api', {
    url: mixApi[0],
    status: mix?.status,
    first: mix?.body?.[0] ?? mix?.body?.slice?.(0, 1) ?? null,
    len: Array.isArray(mix?.body) ? mix.body.length : null,
  });

  // ---------- БАГ-11: segment B2B ----------
  const segBtn = page.locator('button:has-text("B2B")').first();
  const segBtnCount = await segBtn.count();
  if (segBtnCount > 0) {
    await segBtn.click();
    await page.waitForTimeout(3500);
    const segState = await page.evaluate(() => {
      const strip = document.querySelector('[data-testid=kpi-strip]');
      const syncish = [...document.querySelectorAll('main a, main button, main p')]
        .filter((el) => /синхрон|b2b_manual|вносятся вручную|Заполните/i.test(el.textContent))
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
      return {
        stripVisible: !!strip,
        hero: strip?.textContent?.replace(/\s+/g, ' ').slice(0, 300) ?? null,
        emptyish:
          document.querySelector('main')?.textContent?.match(/B2B-данные[^.]*\./)?.[0] ?? null,
        syncish,
      };
    });
    log('bag11_b2b_segment', segState);
    await page.screenshot({ path: path.join(SHOTS, 'bag11-b2b-segment.png') });
    // back to B2C+B2B
    await page
      .locator('button:has-text("B2C")')
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(2500);
  } else {
    log('bag11_b2b_segment', 'segment buttons not found');
  }

  // ---------- БАГ-18: period persistence ----------
  const preset30 = page.locator('button:has-text("30"), button:has-text("30 дн")').first();
  if (await preset30.count()) {
    await preset30.click().catch(() => {});
    await page.waitForTimeout(2500);
    const periodAfter = await page
      .locator('main')
      .textContent()
      .then(
        (t) =>
          (t.match(
            /\d{1,2}[^]{0,3}[а-яё]{3}[^]{0,3}20\d\d[^]{0,3}—[^]{0,3}\d{1,2}[^]{0,3}[а-яё]{3}[^]{0,3}20\d\d/,
          ) || [null])[0],
      )
      .catch(() => null);
    const ls = await page.evaluate(() =>
      Object.fromEntries(Object.entries(localStorage).filter(([k]) => /pca|filter/i.test(k))),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid=kpi-strip]', { timeout: 30000 });
    const periodReload = await page
      .locator('main')
      .textContent()
      .then(
        (t) =>
          (t.match(
            /\d{1,2}[^]{0,3}[а-яё]{3}[^]{0,3}20\d\d[^]{0,3}—[^]{0,3}\d{1,2}[^]{0,3}[а-яё]{3}[^]{0,3}20\d\d/,
          ) || [null])[0],
      )
      .catch(() => null);
    log('bag18_period', { periodAfter, periodReload, ls });
  }

  // ---------- БАГ-01: KPI page ----------
  await page.goto(`${BASE}/app/kpi`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const kpiText = await page.locator('main').textContent();
  const kpiDeadlineNote = await page
    .locator('[data-testid=deadline-note]')
    .textContent()
    .catch(() => null);
  const kpiForecast = (kpiText.match(/дедлайн[^,.\n]{0,60}|Дедлайн[^,.\n]{0,60}/g) || []).slice(
    0,
    4,
  );
  log('bag01_kpi', { kpiDeadlineNote, kpiForecast });
  await page.screenshot({ path: path.join(SHOTS, 'bag01-kpi.png') });

  // ---------- БАГ-13: goal card conversion caption ----------
  const goalConv = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent ?? '';
    const m = t.match(/Конверсия[^%.]{0,40}%[^.]{0,120}/g);
    return m ? m.slice(0, 5) : null;
  });
  log('bag13_goal_conversion', goalConv);

  // ---------- БАГ-10: funnel ----------
  await page.goto(`${BASE}/app/funnel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const funnelText = await page.evaluate(() =>
    document.querySelector('main')?.textContent?.replace(/\s+/g, ' ').slice(0, 2500),
  );
  log('bag10_funnel_text', funnelText);
  await page.screenshot({ path: path.join(SHOTS, 'bag10-funnel.png'), fullPage: true });

  // ---------- БАГ-08: Explore weighted ----------
  await page.goto(`${BASE}/app/explore/sources`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const exploreRows = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('main table')];
    return tables.map((tb) => ({
      head: [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      rows: [...tb.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()),
      ),
    }));
  });
  log('bag08_explore_tables', exploreRows);

  // ---------- БАГ-08/09/16/20: behavior ----------
  await page.goto(`${BASE}/app/behavior`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const behTables = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('main table')];
    return tables.map((tb) => ({
      head: [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      rows: [...tb.querySelectorAll('tbody tr')]
        .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
        .slice(0, 40),
    }));
  });
  const behAvg = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent ?? '';
    const m = t.match(/Средние:[^.]{0,120}/);
    return m ? m[0] : null;
  });
  log('bag08_behavior_tables', { behAvg, tables: behTables });
  await page.screenshot({ path: path.join(SHOTS, 'bag20-behavior.png'), fullPage: true });

  // ---------- БАГ-20: traffic shot ----------
  await page.goto(`${BASE}/app/traffic`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(SHOTS, 'bag20-traffic.png'), fullPage: true });

  // ---------- БАГ-12: history ----------
  await page.goto(`${BASE}/app/history`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const histRows = await page.evaluate(() => {
    const tb = document.querySelector('main table');
    if (!tb) return null;
    return {
      head: [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      rows: [...tb.querySelectorAll('tbody tr')]
        .slice(0, 12)
        .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
    };
  });
  log('bag12_history_table', histRows);
  // try compare on first two rows via checkboxes
  const cmp = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('main input[type=checkbox]')];
    return boxes.length;
  });
  if (cmp >= 2) {
    const boxes = page.locator('main input[type=checkbox]');
    await boxes
      .nth(0)
      .check()
      .catch(() => {});
    await boxes
      .nth(1)
      .check()
      .catch(() => {});
    await page.waitForTimeout(1500);
    const cmpBtn = page
      .locator('main button:has-text("Сравнить"), main button:has-text("сравнить")')
      .first();
    if (await cmpBtn.count()) {
      await cmpBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    const diff = await page.evaluate(() => {
      const t = document.querySelector('main')?.textContent ?? '';
      const oldM = t.match(/Старый:[^]{0,120}/);
      const newM = t.match(/Новый:[^]{0,120}/);
      const warnM = t.match(/период[^.]{0,160}дн[^.]{0,80}\./g);
      return { old: oldM?.[0], new: newM?.[0], warn: warnM };
    });
    log('bag12_compare', diff);
  }
  await page.screenshot({ path: path.join(SHOTS, 'bag12-history.png') });

  // ---------- БАГ-22: live ----------
  await page.goto(`${BASE}/app/live`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const liveH1 = await page
    .locator('main h1')
    .first()
    .textContent()
    .catch(() => null);
  const liveBanner = await page
    .locator('[data-testid=quota-banner], main')
    .textContent()
    .then((t) => /временно недоступн/i.test(t ?? ''))
    .catch(() => false);
  log('bag22_live', { h1: liveH1?.trim(), banner: liveBanner });
  await page.screenshot({ path: path.join(SHOTS, 'bag22-live.png') });

  // ---------- БАГ-17 + 06: goals page ----------
  const t0 = Date.now();
  await page.goto(`${BASE}/app/goals`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main table, main [data-testid], main section', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const goalsLoadMs = Date.now() - t0;
  const goalsState = await page.evaluate(() => {
    const main = document.querySelector('main');
    const cb = [...document.querySelectorAll('input[type=checkbox]')].map((c) => ({
      label:
        c.closest('label')?.textContent?.trim() ??
        c.parentElement?.textContent?.trim()?.slice(0, 40),
      checked: c.checked,
    }));
    const cards = [...main.querySelectorAll('article, [data-testid*=goal]')].length;
    const rows = [...main.querySelectorAll('table tbody tr')].length;
    return {
      checkboxes: cb,
      cards,
      rows,
      text: main.textContent.replace(/\s+/g, ' ').slice(0, 400),
    };
  });
  log('bag17_goals', { goalsLoadMs, goalsState });

  // toggle «Архивные цели» (БАГ-06) — it's in the global FilterBar
  const archLabel = page
    .locator('label:has-text("Архивные цели"), form label:has-text("Архив")')
    .first();
  if (await archLabel.count()) {
    const before = await page.evaluate(
      () => document.querySelector('main').querySelectorAll('table tbody tr, article').length,
    );
    await archLabel
      .locator('input')
      .check()
      .catch(() => archLabel.click());
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      rows: document.querySelector('main').querySelectorAll('table tbody tr').length,
      cards: document.querySelector('main').querySelectorAll('article').length,
      archivedBadges: [...document.querySelectorAll('main span, main div')].filter(
        (el) => el.textContent.trim() === 'Архивная' || el.textContent.trim() === 'Архив',
      ).length,
    }));
    log('bag06_archived', { before, after });
    await page.screenshot({ path: path.join(SHOTS, 'bag06-goals-archived.png') });
    await archLabel
      .locator('input')
      .uncheck()
      .catch(() => archLabel.click());
    await page.waitForTimeout(1500);
  } else {
    log('bag06_archived', 'label not found');
  }

  // ---------- БАГ-16: mobile behavior ----------
  const mp =
    (await ctx
      .browser()
      .newContext({
        viewport: { width: 390, height: 844 },
        locale: 'ru-RU',
        storageState: path.join(DIR, 'state.json'),
      })
      .catch(() => null)) ??
    (await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'ru-RU',
      storageState: path.join(DIR, 'state.json'),
    }));
  const mpage = await mp.newPage();
  await mpage.goto(`${BASE}/app/behavior`, { waitUntil: 'domcontentloaded' });
  await mpage.waitForTimeout(4500);
  const mob = await mpage.evaluate(() => {
    const doc = document.scrollingElement;
    const overflows = [];
    document.querySelectorAll('main *').forEach((el) => {
      if (
        el.scrollWidth > el.clientWidth + 2 &&
        el.clientWidth > 0 &&
        getComputedStyle(el).overflowX === 'visible'
      ) {
        const t = (el.textContent || '').trim().slice(0, 60);
        if (t) overflows.push({ tag: el.tagName, sw: el.scrollWidth, cw: el.clientWidth, text: t });
      }
    });
    return {
      docScrollW: doc.scrollWidth,
      docClientW: doc.clientWidth,
      overflows: overflows.slice(0, 8),
    };
  });
  log('bag16_mobile_behavior', mob);
  await mpage.screenshot({ path: path.join(SHOTS, 'bag16-behavior-390.png'), fullPage: true });
  await mp.close();

  fs.writeFileSync(path.join(DIR, 'result-a.json'), JSON.stringify(R, null, 2));
  fs.writeFileSync(path.join(DIR, 'api-dump.json'), JSON.stringify(API_DUMP, null, 2));
  await browser.close();
  console.log('DONE A');
})().catch((e) => {
  console.error('FAIL A', e);
  process.exit(1);
});
