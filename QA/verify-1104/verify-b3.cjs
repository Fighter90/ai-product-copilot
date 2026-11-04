// Part B3: finishers. БАГ-12 defaults+note, 03 (b2b), 14/15 (hypotheses), 04/02/21 (report build),
// 08 (explore «Итого» row), 19 (payments tags), 13 retry.
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

  // ---------- БАГ-12: defaults + mismatch note ----------
  await page.goto(`${BASE}/app/history`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const h12 = await page.evaluate(() => {
    const sel = (lbl) => document.querySelector(`main select[aria-label="${lbl}"]`);
    const oldSel = sel('Старый:');
    const newSel = sel('Новый:');
    const optText = (s, val) =>
      s ? [...s.options].find((o) => o.value === val)?.textContent.trim() : null;
    const note = document.querySelector('main p[role=note]');
    const authors = [...document.querySelectorAll('main table tbody tr')]
      .slice(0, 12)
      .map((tr) => tr.querySelectorAll('td')[3]?.textContent.trim());
    return {
      oldDefault: optText(oldSel, oldSel?.value),
      newDefault: optText(newSel, newSel?.value),
      note: note?.textContent.trim() ?? null,
      authors,
    };
  });
  log('bag12_defaults', h12);

  // ---------- БАГ-08: explore «Итого» ----------
  await page.goto(`${BASE}/app/explore/sources`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  const exp = await page.evaluate(() => {
    const table = document.querySelector('main table');
    const rows = table
      ? [...table.querySelectorAll('tbody tr, tfoot tr')].map((tr) =>
          [...tr.querySelectorAll('td, th')].map((c) => c.textContent.trim()),
        )
      : [];
    return {
      head: table
        ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim())
        : null,
      rows,
    };
  });
  const head = exp.head ?? [];
  const vi = head.findIndex((h) => /визит/i.test(h));
  const bi = head.findIndex((h) => /отказ/i.test(h));
  const totalRow = exp.rows.find((r) => /итог/i.test(r[0] ?? ''));
  let wv = 0,
    wb = 0;
  for (const r of exp.rows) {
    if (/итог/i.test(r[0] ?? '')) continue;
    const v = num(r[vi]);
    const b = pct(r[bi]);
    if (!Number.isFinite(v) || !Number.isFinite(b) || v <= 0) continue;
    wv += v;
    wb += (b / 100) * v;
  }
  log('bag08_explore_total', {
    totalRow,
    computedWeighted: ((wb / wv) * 100).toFixed(2),
    dataRows: exp.rows.filter((r) => !/итог/i.test(r[0] ?? '')).length,
  });

  // ---------- БАГ-03: B2B ----------
  await page.goto(`${BASE}/app/b2b`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.fill('input[aria-label="Компания"]', 'QA БАГ-03 тест 0411');
  await page.fill('input[aria-label="Билеты"]', '-5');
  await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  const b2bErr = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
    const errEl = document.querySelector(
      'main [role=alert], main .text-red-700, main .text-red-600',
    );
    return {
      err: errEl?.textContent?.trim() ?? null,
      snippet: t.match(/QA БАГ-03[^]{0,80}/)?.[0] ?? null,
    };
  });
  log('bag03_neg_tickets', b2bErr);
  await page.screenshot({ path: path.join(SHOTS, 'bag03-b2b-error.png') });
  // valid deal then delete with confirm
  await page.fill('input[aria-label="Билеты"]', '1');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2200);
  const created = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('main table tbody tr')];
    const row = rows.find((r) => /QA БАГ-03 тест 0411/.test(r.textContent));
    return row
      ? { found: true, text: row.textContent.replace(/\s+/g, ' ').slice(0, 140) }
      : { found: false };
  });
  log('bag03_created', created);
  if (created.found) {
    let dlg = null;
    page.once('dialog', (d) => {
      dlg = { type: d.type(), message: d.message() };
      d.accept();
    });
    const row = page.locator('tr:has-text("QA БАГ-03 тест 0411")').first();
    await row.locator('button:has-text("Удалить")').click();
    await page.waitForTimeout(2500);
    const gone = await page.evaluate(
      () =>
        ![...document.querySelectorAll('main table tbody tr')].some((r) =>
          /QA БАГ-03 тест 0411/.test(r.textContent),
        ),
    );
    log('bag03_delete', { nativeDialog: dlg, gone });
    await page.screenshot({ path: path.join(SHOTS, 'bag03-b2b-deleted.png') });
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
  await page.waitForTimeout(500);
  // create → kanban → delete (native confirm on prod; styled dialog in local tree)
  await page.click('[data-testid=hyp-new]');
  await page.waitForSelector('[data-testid=hypothesis-editor]');
  const titleInput = page.locator('[data-testid=hypothesis-editor] input').first();
  await titleInput.fill('QA БАГ-15 карточка 0411');
  await page.waitForTimeout(400);
  const saveBtn = page.locator('[data-testid=hypothesis-editor] button[type=submit]').first();
  const saveTxt = await saveBtn.textContent().catch(() => null);
  await saveBtn.click().catch(() => {});
  await page.waitForTimeout(2500);
  const hyp15 = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('[data-testid=hyp-kanban] section')].map((s) => ({
      label: s.getAttribute('aria-label'),
      cards: [...s.querySelectorAll('article')].map((a) =>
        a.textContent.replace(/\s+/g, ' ').slice(0, 40),
      ),
    }));
    const card = [...document.querySelectorAll('article')].find((a) =>
      /QA БАГ-15 карточка 0411/.test(a.textContent),
    );
    let overflow = null;
    if (card) {
      const col = card.closest('section');
      const cr = card.getBoundingClientRect();
      const kr = col.getBoundingClientRect();
      overflow = cr.right > kr.right + 1 || cr.left < kr.left - 1;
    }
    return {
      cols: cols.map((c) => ({
        l: c.label,
        n: c.cards.length,
        qa: c.cards.find((x) => /QA/.test(x)) ?? null,
      })),
      overflow,
    };
  });
  log('bag15_kanban', hyp15);
  if (hyp15.cols.some((c) => /QA/.test(c.qa ?? ''))) {
    let dlg = null;
    page.once('dialog', (d) => {
      dlg = { type: d.type(), message: d.message() };
      d.accept();
    });
    const card = page.locator('article:has-text("QA БАГ-15 карточка 0411")').first();
    await card.locator('button:has-text("Удалить")').click();
    await page.waitForTimeout(2500);
    const gone = await page.evaluate(
      () =>
        ![...document.querySelectorAll('article')].some((a) =>
          /QA БАГ-15 карточка 0411/.test(a.textContent),
        ),
    );
    log('bag15_delete', { nativeDialog: dlg, gone });
  }

  // ---------- БАГ-02/04/21: build report ----------
  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const buildBtn = page.locator('main button:has-text("Собрать отчёт")').first();
  if (await buildBtn.count()) {
    await buildBtn.click();
    // wait for snapshot: export buttons appear
    await page
      .waitForSelector('main button:has-text("Export DOCX")', { timeout: 120000 })
      .catch(() => {});
  }
  await page.waitForTimeout(3000);
  const rep = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    return {
      paidBits: (t.match(/Оплачено[^.]{0,110}/g) || []).slice(0, 6),
      applicationsBits: (
        t.match(/Заявк[аи][^.,]{0,30}\(B2C\)[^Д]{0,80}|заявки[^.;]{0,60}/g) || []
      ).slice(0, 4),
      заявкаНеоплата: t.includes('заявка ≠ оплата'),
      aiCounter: t.match(/AI-гипотез[^.]{0,70}/)?.[0] ?? null,
      exportBtns: [...main.querySelectorAll('button, a')]
        .filter((b) => /Export (DOCX|PDF)/.test(b.textContent))
        .map((b) => b.textContent.trim()),
      generateBtn: !![...main.querySelectorAll('button')].find((b) =>
        /Сгенерировать AI/.test(b.textContent),
      ),
      alreadyGenerated: t.includes('уже сгенерирован'),
    };
  });
  log('bag02_report_built', rep);

  for (const kind of ['DOCX', 'PDF']) {
    const btn = page.locator(`main button:has-text("Export ${kind}")`).first();
    if (await btn.count()) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 60000 }),
          btn.click(),
        ]);
        const p = await download.path();
        log(`bag04_${kind}`, {
          downloaded: !!download,
          fname: download.suggestedFilename(),
          size: p ? fs.statSync(p).size : null,
        });
      } catch (e) {
        log(`bag04_${kind}`, { error: String(e).slice(0, 200) });
      }
    } else log(`bag04_${kind}`, 'no button');
  }

  // БАГ-21: AI counter
  if (rep.generateBtn) {
    await page.locator('main button:has-text("Сгенерировать AI-анализ")').first().click();
    let ai = null;
    let waited = 0;
    while (waited < 100) {
      await page.waitForTimeout(5000);
      waited += 5;
      ai = await page.evaluate(() => {
        const t = document.querySelector('main')?.textContent ?? '';
        return {
          counter: t.match(/AI-гипотез[^.]{0,70}/)?.[0] ?? null,
          done: t.includes('AI-анализ сгенерирован') || t.includes('уже сгенерирован'),
          unavail: t.match(/AI-анализ недоступен[^.]{0,90}/)?.[0] ?? null,
        };
      });
      if (ai.done || ai.unavail) break;
    }
    log('bag21_ai_generation', { ai, waited });
    await page.screenshot({ path: path.join(SHOTS, 'bag21-ai-after.png'), fullPage: true });
  } else {
    log('bag21_ai_generation', {
      note: 'no generate button (already generated or AI off)',
      aiCounter: rep.aiCounter,
      already: rep.alreadyGenerated,
    });
    await page.screenshot({ path: path.join(SHOTS, 'bag21-ai-state.png'), fullPage: true });
  }

  // ---------- БАГ-19: payments tags on funnel ----------
  await page.goto(`${BASE}/app/funnel`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const pay19 = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
    const rows = [...document.querySelectorAll('main table tbody tr')]
      .map((tr) => tr.textContent.replace(/\s+/g, ' ').trim())
      .filter((x) => /вручную|manual|CSV/.test(x));
    return {
      manualRu: t.includes('вручную'),
      manualEn: /\bmanual\b/.test(t),
      rows: rows.slice(0, 4),
      b2cLoss: t.match(/B2C-ветка[^.]{0,100}/)?.[0] ?? null,
    };
  });
  log('bag19_payments', pay19);

  // ---------- БАГ-13 retry: goal detail ----------
  await page.goto(`${BASE}/app/goals/672478769`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const gd = await page.evaluate(() => {
    const t = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '';
    return {
      byVisitsCaption: t.includes('по визитам с целью'),
      crBits: (t.match(/Конверсия[^.]{0,70}/g) || []).slice(0, 4),
      four29: t.includes('Too Many Requests'),
    };
  });
  log('bag13_retry', gd);
  await page.screenshot({ path: path.join(SHOTS, 'bag13-goal-retry.png') });

  fs.writeFileSync(path.join(DIR, 'result-b3.json'), JSON.stringify(R, null, 2));
  await browser.close();
  console.log('DONE B3');
})().catch((e) => {
  console.error('FAIL B3', e);
  process.exit(1);
});
