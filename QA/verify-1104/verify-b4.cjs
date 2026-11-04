// Part B4: finishers + cleanup. БАГ-03 cleanup (delete QA deal), 15 (API create + UI delete),
// 06 (/app/goals archived toggle with live list), 21 (AI providers state), 07 (top dupes precise).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://dashboardcamp.ru';
const DIR = __dirname;
const SHOTS = path.join(DIR, 'shots');
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log('§', k, JSON.stringify(v).slice(0, 700));
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(DIR, 'state.json'),
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  // ---------- БАГ-03 cleanup: delete QA deal via UI (table behind toggle) ----------
  await page.goto(`${BASE}/app/b2b`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const tblToggle = page
    .locator(
      'main button:has-text("Сделки"), main button:has-text("Детализация"), main button:has-text("Показать"), main button:has-text("Таблица")',
    )
    .first();
  if (await tblToggle.count()) {
    await tblToggle.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  let rowsNow = await page.evaluate(() =>
    [...document.querySelectorAll('main table tbody tr')].map((tr) =>
      tr.textContent.replace(/\s+/g, ' ').trim().slice(0, 100),
    ),
  );
  log('bag03_rows_before_cleanup', rowsNow.slice(0, 6));
  const qaRow = page.locator('tr:has-text("QA БАГ-03 тест 0411")').first();
  if (await qaRow.count()) {
    let dlg = null;
    page.once('dialog', (d) => {
      dlg = { type: d.type(), message: d.message() };
      d.accept();
    });
    await qaRow.locator('button:has-text("Удалить")').click();
    await page.waitForTimeout(2500);
    const gone = await page.evaluate(
      () =>
        ![...document.querySelectorAll('main table tbody tr')].some((r) =>
          /QA БАГ-03 тест 0411/.test(r.textContent),
        ),
    );
    log('bag03_cleanup', { nativeDialog: dlg, gone });
  } else {
    log('bag03_cleanup', 'qa row not found (already gone or table hidden)');
  }

  // ---------- БАГ-15: create via API → kanban → UI delete ----------
  const HYP = {
    diamondPhase: 'develop',
    kind: 'solution',
    subject: 'QA-verify 0411',
    action: 'проверяем удаление',
    solution: 'карточка создаётся скриптом',
    condition: 'если карточка видна в канбане',
    title: 'QA БАГ-15 карточка 0411 (удаляется скриптом)',
    hiddenAssumptions: [
      { category: 'behavior', text: 'допущение поведение' },
      { category: 'market', text: 'допущение рынок' },
      { category: 'tech', text: 'допущение техника' },
    ],
    validationMethods: [
      { type: 'quantitative', plan: 'A/B' },
      { type: 'synthetic', plan: 'интервью' },
    ],
    impact: 5,
    confidence: 5,
    ease: 5,
    impactRationale: 'обоснование I',
    confidenceRationale: 'обоснование C',
    easeRationale: 'обоснование E',
    greenCriteria: 'зелёный',
    yellowCriteria: 'жёлтый',
    redCriteria: 'красный',
    deadlineDays: 14,
  };
  const resp = await page.request.post(`${BASE}/api/hypotheses`, { data: HYP });
  const createdH = await resp.json().catch(() => ({}));
  log('bag15_create_api', { status: resp.status(), id: createdH?.id });
  if (createdH?.id) {
    await page.goto(`${BASE}/app/hypotheses`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`[data-testid=hyp-card-${createdH.id}]`, { timeout: 30000 });
    const placement = await page.evaluate((cid) => {
      const card = document.querySelector(`[data-testid=hyp-card-${cid}]`);
      const col = card?.closest('section');
      const c = col?.getBoundingClientRect();
      const r = card?.getBoundingClientRect();
      return {
        column: col?.getAttribute('aria-label'),
        overflow: c && r ? r.right > c.right + 1 || r.left < c.left - 1 : null,
      };
    }, createdH.id);
    log('bag15_placement', placement);
    let dlg = null;
    page.once('dialog', (d) => {
      dlg = { type: d.type(), message: d.message() };
      d.accept();
    });
    await page
      .locator(`[data-testid=hyp-card-${createdH.id}]`)
      .locator('button:has-text("Удалить")')
      .click();
    await page.waitForTimeout(2500);
    const gone = await page.evaluate(
      (cid) => !document.querySelector(`[data-testid=hyp-card-${cid}]`),
      createdH.id,
    );
    log('bag15_delete_ui', { nativeDialog: dlg, gone });
    await page.screenshot({ path: path.join(SHOTS, 'bag15-delete.png') });
  }

  // ---------- БАГ-06: /app/goals archived toggle ----------
  await page.goto(`${BASE}/app/goals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const goalsBase = await page.evaluate(() => {
    const main = document.querySelector('main');
    const cards = [...main.querySelectorAll('article')].map((a) => ({
      title:
        a.querySelector('h3, h2, strong')?.textContent?.trim() ??
        a.textContent.replace(/\s+/g, ' ').slice(0, 60),
      archivedPill: [...a.querySelectorAll('span')].some(
        (s) => s.textContent.trim() === 'Архивная',
      ),
    }));
    const hiddenNote =
      main.textContent.match(/скрыто[^.]{0,60}|архивн[^.]{0,60}скрыт[^.]{0,40}/i)?.[0] ?? null;
    return { cardsCount: cards.length, cards: cards.slice(0, 10), hiddenNote };
  });
  log('bag06_goals_default', goalsBase);
  const archCb = page.locator('label:has-text("Архивные цели")').first();
  if (await archCb.count()) {
    await archCb
      .locator('input')
      .check()
      .catch(() => archCb.click());
    await page.waitForTimeout(2000);
    const goalsArch = await page.evaluate(() => {
      const main = document.querySelector('main');
      const cards = [...main.querySelectorAll('article')];
      return {
        cardsCount: cards.length,
        archivedShown: cards.filter((a) =>
          [...a.querySelectorAll('span')].some((s) => s.textContent.trim() === 'Архивная'),
        ).length,
        note: main.textContent.match(/показ[а-я]*[^.]{0,70}|архивн[^.]{0,60}/i)?.[0] ?? null,
      };
    });
    log('bag06_goals_archived_on', goalsArch);
    await page.screenshot({ path: path.join(SHOTS, 'bag06-goals-arch-on.png'), fullPage: true });
    await archCb
      .locator('input')
      .uncheck()
      .catch(() => {});
    await page.waitForTimeout(1200);
  }

  // ---------- БАГ-21: AI providers state on report ----------
  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const repAi = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    const genBtn = [...main.querySelectorAll('button')].find((b) =>
      /Сгенерировать AI|AI-анализ сгенерирован/.test(b.textContent),
    );
    const provSel = main.querySelector('select');
    const provOpts = provSel ? [...provSel.options].map((o) => o.textContent.trim()) : null;
    return {
      genBtn: genBtn
        ? {
            txt: genBtn.textContent.trim(),
            disabled: genBtn.disabled,
            title: genBtn.getAttribute('title'),
          }
        : null,
      provOpts,
      noProvidersNote:
        t.match(/нет (настроенных|подключённых)[^.]{0,80}|AI-провайдер[^.]{0,80}/i)?.[0] ?? null,
      aiCounter: t.match(/AI-гипотез[^.]{0,70}/)?.[0] ?? null,
      generatedBy: t.match(/сгенериров[ан][^.:]{0,80}/)?.[0] ?? null,
    };
  });
  log('bag21_ai_providers', repAi);
  await page.screenshot({ path: path.join(SHOTS, 'bag21-providers.png') });

  // ---------- БАГ-07: top lists precise + dupes ----------
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=kpi-strip]', { timeout: 30000 });
  await page.waitForTimeout(3000);
  const tops = await page.evaluate(() => {
    const out = {};
    [...document.querySelectorAll('main h2, main h3')].forEach((h) => {
      const txt = h.textContent.trim();
      if (!/Топ страниц входа|Топ страниц выхода|UTM-разбивка/.test(txt)) return;
      const card = h.closest('section') || h.parentElement?.parentElement;
      const rows = card
        ? [...card.querySelectorAll('table tbody tr')].map((tr) =>
            [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()),
          )
        : [];
      out[txt] = rows.slice(0, 25);
    });
    return out;
  });
  log('bag07_tops_raw', tops);
  const norm = (u) =>
    String(u)
      .toLowerCase()
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '') || '/';
  const dupCheck = {};
  for (const [card, rows] of Object.entries(tops)) {
    const keys = rows.map((r) => norm(r[0]));
    const seen = {};
    const dups = [];
    keys.forEach((k) => {
      seen[k] = (seen[k] ?? 0) + 1;
    });
    for (const [k, n] of Object.entries(seen)) if (n > 1) dups.push({ key: k, n });
    dupCheck[card] = { rows: rows.length, dupKeys: dups };
  }
  log('bag07_dupes', dupCheck);

  fs.writeFileSync(path.join(DIR, 'result-b4.json'), JSON.stringify(R, null, 2));
  await browser.close();
  console.log('DONE B4');
})().catch((e) => {
  console.error('FAIL B4', e);
  process.exit(1);
});
