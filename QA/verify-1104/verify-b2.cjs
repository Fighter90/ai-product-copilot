// Part B2: interactive. БАГ-03 (b2b), 04 (export downloads), 05 (marketing cells),
// 12 (history compare proper), 13 (goal detail), 15/14 (hypotheses), 19 (payments tags),
// 21 (AI counter), 08 (explore full), 09 (behavior full weighted), 02 (report finance).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const SHOTS = path.join(DIR, 'shots');
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log('§', k, JSON.stringify(v).slice(0, 600));
};
const netLog = [];
const num = (s) => parseInt(String(s).replace(/[\s\u00a0]/g, ''), 10);
const pct = (s) => parseFloat(String(s).replace('%', '').replace(',', '.'));

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

  // ---------- БАГ-12: history compare (proper) ----------
  await page.goto(`${BASE}/app/history`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const snapOpts = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('main select')];
    const snap = sels.find(
      (s) => s.options.length > 2 && /Отчёт/.test(s.options[1]?.textContent ?? ''),
    );
    return snap ? [...snap.options].map((o) => o.textContent.trim()) : null;
  });
  log('bag12_snapshot_options', snapOpts?.slice(0, 8));
  if (snapOpts && snapOpts.length > 2) {
    const sels = page.locator('main select');
    // select[0]=author filter, [1]=snapA, [2]=snapB (structure may differ; find by option count)
    await sels.nth(1).selectOption({ index: 2 }); // A = «Отчёт 17.10–30.10.2026»
    await sels.nth(2).selectOption({ index: 1 }); // B = «Отчёт 01.11.2025–31.10.2026» (365d)
    await page.waitForTimeout(2200);
    const diff1 = await page.evaluate(() => {
      const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
      const cut = t.slice(t.indexOf('Старый:'), t.indexOf('Старый:') + 700);
      return {
        oldLine: cut.match(/Старый:[^Н]{0,150}/)?.[0] ?? null,
        newLine: cut.match(/Новый:[^СГП]{0,150}/)?.[0] ?? null,
        warn:
          t.match(
            /длину периодов[^.]{0,160}\.|периоды[^.]{0,160}дн[^.]{0,60}\.|не сравнимы[^.]{0,120}\./,
          )?.[0] ?? null,
        visitsDiff: t.match(/Визиты[^Д]{0,120}/)?.[0] ?? null,
      };
    });
    log('bag12_compare_365_vs_14', diff1);
    await page.screenshot({ path: path.join(SHOTS, 'bag12-compare-real.png'), fullPage: true });
    // now two similar-length periods: index 2 vs 3
    await sels.nth(1).selectOption({ index: 2 });
    await sels.nth(2).selectOption({ index: 3 });
    await page.waitForTimeout(2200);
    const diff2 = await page.evaluate(() => {
      const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
      return {
        warn: t.match(/длину периодов[^.]{0,160}\.|периоды[^.]{0,160}дн[^.]{0,60}\./)?.[0] ?? null,
      };
    });
    log('bag12_compare_similar_lengths', diff2);
  }

  // ---------- БАГ-13: goal detail ----------
  const goalId = process.env.GOAL_ID || '672478769';
  await page.goto(`${BASE}/app/goals/${goalId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const gd = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
    return {
      title: document.querySelector('main h1, main h2')?.textContent?.trim() ?? null,
      crCaption: t.match(/Конверсия[^%.]{0,40}%?[^.]{0,60}/g)?.slice(0, 3) ?? null,
      byVisitsCaption: t.includes('по визитам с целью'),
      mainSnippet: t.slice(0, 300),
    };
  });
  log('bag13_goal_detail', gd);
  await page.screenshot({ path: path.join(SHOTS, 'bag13-goal-detail2.png') });

  // ---------- БАГ-08: Explore full + weighted ----------
  await page.goto(`${BASE}/app/explore/sources`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  const expLive = netLog.filter((e) => e.u.includes('/api/live/')).slice(-4);
  const exp = await page.evaluate(() => {
    const main = document.querySelector('main');
    const table = main.querySelector('table');
    const rows = table
      ? [...table.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.querySelectorAll('td, th')].map((c) => c.textContent.trim()),
        )
      : [];
    return {
      mainSnippet: main.textContent.replace(/\s+/g, ' ').slice(0, 400),
      hasTable: !!table,
      head: table
        ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim())
        : null,
      rows,
      banner:
        main.textContent.match(/Данные Метрики временно[^.]{0,80}|недоступн[^.]{0,80}/)?.[0] ??
        null,
    };
  });
  log('bag08_explore', {
    liveCalls: expLive,
    hasTable: exp.hasTable,
    head: exp.head,
    rowCount: exp.rows.length,
    banner: exp.banner,
    snippet: exp.mainSnippet,
  });
  if (exp.hasTable && exp.rows.length) {
    const head = exp.head ?? [];
    const visitsIdx = head.findIndex((h) => /визит/i.test(h));
    const bounceIdx = head.findIndex((h) => /отказ/i.test(h));
    const totalRow = exp.rows.find((r) => /итог/i.test(r[0] ?? ''));
    let wv = 0,
      wb = 0,
      simple = [],
      n = 0;
    for (const r of exp.rows) {
      if (/итог/i.test(r[0] ?? '')) continue;
      const v = num(r[visitsIdx]);
      const b = pct(r[bounceIdx]);
      if (!Number.isFinite(v) || !Number.isFinite(b) || v <= 0) continue;
      wv += v;
      wb += (b / 100) * v;
      simple.push(b);
      n++;
    }
    const weighted = (wb / wv) * 100;
    const sm = simple.reduce((a, b) => a + b, 0) / (simple.length || 1);
    log('bag08_explore_weighted', {
      rows: n,
      totalRow,
      weighted: weighted.toFixed(2),
      simpleMean: sm.toFixed(2),
    });
  }

  // ---------- БАГ-09: behavior full table + weighted + insights ----------
  await page.goto(`${BASE}/app/behavior`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const beh = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    const table = [...main.querySelectorAll('table')][0];
    const rows = table
      ? [...table.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.querySelectorAll('td')].map((c) => c.textContent.trim()),
        )
      : [];
    const insightsEl = [...main.querySelectorAll('h3')].find((h) =>
      /Ключевые наблюдения/.test(h.textContent),
    );
    return {
      avg: t.match(/Средние:[^С]{0,80}/)?.[0] ?? null,
      insights: insightsEl
        ? insightsEl.parentElement.textContent.replace(/\s+/g, ' ').slice(0, 500)
        : null,
      rows,
    };
  });
  let wv = 0,
    wb = 0,
    n = 0;
  const target = {};
  for (const r of beh.rows) {
    const v = num(r[1]);
    const b = pct(r[3]);
    if (!Number.isFinite(v) || !Number.isFinite(b)) continue;
    wv += v;
    wb += (b / 100) * v;
    n++;
    if (/builder-payment|PCxPS_special/.test(r[0]))
      target[r[0]] = { visits: v, bounce: r[3], cr: r[5] };
  }
  const behWeighted = wv ? (wb / wv) * 100 : null;
  log('bag09_behavior_full', {
    rowCount: beh.rows.length,
    avg: beh.avg,
    computedWeighted: behWeighted === null ? null : behWeighted.toFixed(2),
    insights: beh.insights,
    specialPages: target,
  });

  // ---------- БАГ-02 + 04 + 21: report ----------
  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const rep = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    return {
      snippet: t.slice(0, 500),
      paidBits: (t.match(/Оплачено[^.]{0,110}/g) || []).slice(0, 5),
      заявкаНеоплата: t.includes('заявка ≠ оплата'),
      aiCounter: t.match(/AI-гипотез[^.]{0,60}/)?.[0] ?? null,
      exportBtns: [...main.querySelectorAll('button, a')]
        .filter((b) => /Export (DOCX|PDF)/.test(b.textContent))
        .map((b) => ({ txt: b.textContent.trim(), tag: b.tagName })),
      generateBtn: !![...main.querySelectorAll('button')].find((b) =>
        /Сгенерировать AI/.test(b.textContent),
      ),
    };
  });
  log('bag02_report', rep);

  // БАГ-04: export downloads
  for (const kind of ['DOCX', 'PDF']) {
    const btn = page
      .locator(`button:has-text("Export ${kind}"), a:has-text("Export ${kind}")`)
      .first();
    if (await btn.count()) {
      const navPromise = page
        .waitForNavigation({ timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 45000 }),
          btn.click(),
          navPromise,
        ]);
        const fname = download ? download.suggestedFilename() : null;
        const pathD = download ? await download.path() : null;
        const size = pathD ? fs.statSync(pathD).size : null;
        log(`bag04_${kind}`, { downloaded: !!download, fname, size, navigated: await navPromise });
      } catch (e) {
        log(`bag04_${kind}`, { error: String(e).slice(0, 160) });
      }
    } else {
      log(`bag04_${kind}`, 'button not found');
    }
  }

  // БАГ-21: AI counter — before/after generation (tiles count for dup check)
  const tilesBefore = await page.evaluate(
    () => document.querySelectorAll('main [data-testid*=b2b], main [class*=grid] > div').length,
  );
  if (rep.generateBtn) {
    const aiBefore = await page.evaluate(
      () => document.querySelector('main')?.textContent?.match(/AI-гипотез[^.]{0,60}/)?.[0] ?? null,
    );
    await page.locator('button:has-text("Сгенерировать AI-анализ")').first().click();
    // poll up to 90s for done/unavailable
    let aiAfter = null;
    let waited = 0;
    while (waited < 90) {
      await page.waitForTimeout(5000);
      waited += 5;
      aiAfter = await page.evaluate(() => {
        const t = document.querySelector('main')?.textContent ?? '';
        return {
          counter: t.match(/AI-гипотез[^.]{0,60}/)?.[0] ?? null,
          done: t.includes('AI-анализ сгенерирован'),
          unavail: t.match(/AI-анализ недоступен[^.]{0,80}/)?.[0] ?? null,
        };
      });
      if (aiAfter.done || aiAfter.unavail) break;
    }
    const tilesAfter = await page.evaluate(
      () => document.querySelectorAll('main [data-testid*=b2b], main [class*=grid] > div').length,
    );
    log('bag21_ai', { aiBefore, aiAfter, waited, tilesBefore, tilesAfter });
    await page.screenshot({ path: path.join(SHOTS, 'bag21-ai.png'), fullPage: true });
  }

  // ---------- БАГ-05: marketing cells ----------
  await page.goto(`${BASE}/app/marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const cellProbe = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('td input')];
    const filled = inputs.find((i) => i.value.trim() !== '');
    return {
      total: inputs.length,
      firstFilled: filled
        ? { aria: filled.getAttribute('aria-label')?.slice(0, 60), value: filled.value }
        : null,
    };
  });
  log('bag05_probe', cellProbe);
  if (cellProbe.firstFilled) {
    const inp = page
      .locator('td input')
      .filter(({}) => true)
      .nth(0);
    // find the actual filled one by value
    const idx = await page.evaluate(() =>
      [...document.querySelectorAll('td input')].findIndex((i) => i.value.trim() !== ''),
    );
    const cell = page.locator('td input').nth(idx);
    const original = cellProbe.firstFilled.value;
    // 1) letters rejected
    await cell.click();
    await cell.fill('abc');
    const afterLetters = await cell.inputValue();
    // 2) Esc reverts
    await cell.fill('42');
    await cell.press('Escape');
    const afterEsc = await cell.inputValue();
    // 3) clear saves empty (DELETE)
    await cell.fill('');
    await cell.press('Enter');
    await page.waitForTimeout(1800);
    const afterClear = await cell.inputValue();
    const clearedOk = afterClear === '';
    // 4) restore original
    await cell.fill(original);
    await cell.press('Enter');
    await page.waitForTimeout(1800);
    const restored = await cell.inputValue();
    log('bag05_cell', { original, afterLetters, afterEsc, afterClear, clearedOk, restored });
    await page.screenshot({ path: path.join(SHOTS, 'bag05-marketing.png') });
  }

  // ---------- БАГ-03: B2B validation + delete confirm ----------
  await page.goto(`${BASE}/app/b2b`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  // -5 tickets
  await page.fill('input[aria-label="Компания"]', 'QA БАГ-03 тест');
  await page.fill('input[aria-label="Билеты"]', '-5');
  await page.click('button[type=submit]');
  await page.waitForTimeout(1200);
  const b2bErr = await page.evaluate(() => {
    const main = document.querySelector('main');
    const err =
      main.textContent.match(/билет[ы]?[^.]{0,120}|ошибк[^.]{0,120}|должно[^.]{0,120}/i)?.[0] ??
      null;
    const posted = netLog.some(
      (e) => e.u.includes('/api/b2b') && e.m === 'POST' && e.s >= 200 && e.s < 300,
    );
    return { err, posted };
  });
  log('bag03_neg_tickets', b2bErr);
  // valid deal then delete with confirm
  await page.fill('input[aria-label="Компания"]', 'QA БАГ-03 тест');
  await page.fill('input[aria-label="Билеты"]', '1');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2000);
  const created = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('main table tbody tr')];
    const row = rows.find((r) => /QA БАГ-03 тест/.test(r.textContent));
    return row
      ? { found: true, text: row.textContent.replace(/\s+/g, ' ').slice(0, 120) }
      : { found: false };
  });
  log('bag03_created', created);
  if (created.found) {
    let dialogSeen = null;
    page.once('dialog', (d) => {
      dialogSeen = { type: d.type(), message: d.message() };
      d.accept();
    });
    const row = page.locator('tr:has-text("QA БАГ-03 тест")').first();
    await row.locator('button:has-text("Удалить")').click();
    await page.waitForTimeout(2500);
    const gone = await page.evaluate(
      () =>
        ![...document.querySelectorAll('main table tbody tr')].some((r) =>
          /QA БАГ-03 тест/.test(r.textContent),
        ),
    );
    log('bag03_delete', { dialogSeen, gone });
  }

  // ---------- БАГ-14/15: hypotheses ----------
  await page.goto(`${BASE}/app/hypotheses`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=hyp-new]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.click('[data-testid=hyp-new]');
  await page.waitForSelector('[data-testid=hypothesis-editor]');
  await page.waitForTimeout(700);
  const modal = await page.evaluate(() => {
    const dlg = document.querySelector('[role=dialog]');
    const tas = [...dlg.querySelectorAll('textarea')].map((t) => t.offsetHeight);
    return {
      noHScroll: dlg.scrollWidth <= dlg.clientWidth + 1,
      freshAlerts: dlg.querySelectorAll('[role=alert]').length,
      textareaMinH: tas.length ? Math.min(...tas) : null,
      title: dlg.querySelector('h3')?.textContent ?? null,
    };
  });
  log('bag14_modal', modal);
  await page.screenshot({ path: path.join(SHOTS, 'bag14-modal.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // create test hypothesis → kanban placement → delete confirm
  await page.click('[data-testid=hyp-new]');
  await page.waitForSelector('[data-testid=hypothesis-editor]');
  await page.fill(
    '[data-testid=hypothesis-editor] input[name=title], [data-testid=hypothesis-editor] input >> nth=0',
    'QA БАГ-15 карточка 1104',
  );
  await page.waitForTimeout(300);
  const saveBtn = page
    .locator(
      '[data-testid=hypothesis-editor] button[type=submit], [data-testid=hypothesis-editor] button:has-text("Сохранить")',
    )
    .first();
  await saveBtn.click().catch(() => {});
  await page.waitForTimeout(2000);
  const hyp15 = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('[data-testid=hyp-kanban] section')].map((s) => ({
      label: s.getAttribute('aria-label'),
      hasCard: [...s.querySelectorAll('article')].some((a) => /QA БАГ-15/.test(a.textContent)),
    }));
    const card = [...document.querySelectorAll('article')].find((a) =>
      /QA БАГ-15/.test(a.textContent),
    );
    const col = card ? card.closest('section') : null;
    let overflow = false;
    if (card && col) {
      const cr = card.getBoundingClientRect();
      const kr = col.getBoundingClientRect();
      overflow = cr.right > kr.right + 1 || cr.left < kr.left - 1;
    }
    return { cols, overflow };
  });
  log('bag15_kanban', hyp15);
  if (hyp15.cols.some((c) => c.hasCard)) {
    let dlg = null;
    page.once('dialog', (d) => {
      dlg = { type: d.type(), message: d.message() };
      d.accept();
    });
    const card = page.locator('article:has-text("QA БАГ-15 карточка 1104")').first();
    await card.locator('button:has-text("Удалить")').click();
    await page.waitForTimeout(2500);
    const gone = await page.evaluate(
      () =>
        ![...document.querySelectorAll('article')].some((a) =>
          /QA БАГ-15 карточка 1104/.test(a.textContent),
        ),
    );
    log('bag15_delete', { nativeDialog: dlg, gone });
  }

  // ---------- БАГ-19: payments tags on funnel ----------
  await page.goto(`${BASE}/app/funnel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const pay19 = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
    return {
      manualRu: t.includes('вручную'),
      manualEn: /\bmanual\b/.test(t),
      b2cLoss: t.match(/B2C-ветка[^:]*:[^.]{0,90}/)?.[0] ?? null,
      b2bLoss: t.match(/B2B[^.]{0,60}потеряно[^.]{0,60}|потери B2B[^.]{0,60}/)?.[0] ?? null,
      visitsTop: t.match(/Визиты\s*([\d\s\u00a0]+)/)?.[1]?.trim() ?? null,
    };
  });
  log('bag19_payments_labels', pay19);

  fs.writeFileSync(path.join(DIR, 'result-b2.json'), JSON.stringify(R, null, 2));
  fs.writeFileSync(path.join(DIR, 'netlog-b2.json'), JSON.stringify(netLog, null, 2));
  await browser.close();
  console.log('DONE B2');
})().catch((e) => {
  console.error('FAIL B2', e);
  process.exit(1);
});
