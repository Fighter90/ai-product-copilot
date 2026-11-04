// Part B5: targeted finishers. БАГ-03 cleanup (Развернуть полную таблицу → удалить QA-сделку),
// БАГ-15 delete via aria-label button, БАГ-06 archived, БАГ-21 providers, БАГ-07 dupes.
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

  // ---------- БАГ-03 cleanup ----------
  await page.goto(`${BASE}/app/b2b`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const expand = page.locator('main button:has-text("Развернуть полную таблицу")').first();
  if (await expand.count()) {
    await expand.click();
    await page.waitForTimeout(1500);
    const qaRow = page.locator('tr:has-text("QA БАГ-03 тест 0411")').first();
    if (await qaRow.count()) {
      let dlg = null;
      page.once('dialog', (d) => {
        dlg = { type: d.type(), message: d.message() };
        d.accept();
      });
      await qaRow
        .locator('button[aria-label="Удалить QA БАГ-03 тест 0411"], button:has-text("✕")')
        .first()
        .click();
      await page.waitForTimeout(2500);
      const gone = await page.evaluate(
        () =>
          ![...document.querySelectorAll('tr')].some((r) =>
            /QA БАГ-03 тест 0411/.test(r.textContent),
          ),
      );
      log('bag03_cleanup', { nativeDialog: dlg, gone });
    } else {
      log('bag03_cleanup', 'row not found');
    }
  } else {
    log('bag03_cleanup', 'expand button not found');
  }

  // ---------- БАГ-15 delete hyp id=5 ----------
  await page.goto(`${BASE}/app/hypotheses`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=hyp-card-5]', { timeout: 30000 }).catch(() => {});
  if (await page.locator('[data-testid=hyp-card-5]').count()) {
    let dlg = null;
    page.once('dialog', (d) => {
      dlg = { type: d.type(), message: d.message() };
      d.accept();
    });
    await page.locator('[data-testid=hyp-card-5] button[aria-label="Удалить"]').click();
    await page.waitForTimeout(2000);
    const gone = await page.evaluate(() => !document.querySelector('[data-testid=hyp-card-5]'));
    log('bag15_delete_ui', { nativeDialog: dlg, gone });
    await page.screenshot({ path: path.join(SHOTS, 'bag15-delete.png') });
  } else {
    log('bag15_delete_ui', 'card 5 not found');
  }

  // ---------- БАГ-06: archived toggle ----------
  await page.goto(`${BASE}/app/goals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const goalsBase = await page.evaluate(() => {
    const main = document.querySelector('main');
    const cards = [...main.querySelectorAll('article')].map((a) => ({
      title:
        (a.querySelector('h3, h2, strong')?.textContent ?? '').trim() ||
        a.textContent.replace(/\s+/g, ' ').slice(0, 50),
      archPill: [...a.querySelectorAll('span')].some((s) => s.textContent.trim() === 'Архивная'),
    }));
    return {
      cardsCount: cards.length,
      cards: cards.slice(0, 12),
      note: main.textContent.match(/архивн[^.]{0,70}/i)?.[0] ?? null,
    };
  });
  log('bag06_default', goalsBase);
  const archCb = page.locator('label:has-text("Архивные цели")').first();
  if (await archCb.count()) {
    await archCb
      .locator('input')
      .check()
      .catch(() => archCb.click());
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => {
      const main = document.querySelector('main');
      const cards = [...main.querySelectorAll('article')];
      return {
        cardsCount: cards.length,
        archivedCards: cards.filter((a) =>
          [...a.querySelectorAll('span')].some((s) => s.textContent.trim() === 'Архивная'),
        ).length,
        note: main.textContent.match(/архивн[^.]{0,70}|скрыто[^.]{0,50}/i)?.[0] ?? null,
      };
    });
    log('bag06_arch_on', after);
    await page.screenshot({ path: path.join(SHOTS, 'bag06-arch-on.png'), fullPage: true });
    await archCb
      .locator('input')
      .uncheck()
      .catch(() => {});
    await page.waitForTimeout(1200);
  }

  // ---------- БАГ-21: AI providers ----------
  await page.goto(`${BASE}/app/report`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const repAi = await page.evaluate(() => {
    const main = document.querySelector('main');
    const t = main.textContent.replace(/\s+/g, ' ');
    const genBtn = [...main.querySelectorAll('button')].find((b) =>
      /Сгенерировать AI|AI-анализ сгенерирован/.test(b.textContent),
    );
    return {
      genBtn: genBtn
        ? {
            txt: genBtn.textContent.trim(),
            disabled: genBtn.disabled,
            title: genBtn.getAttribute('title'),
          }
        : null,
      aiCounter: t.match(/AI-гипотез[^.]{0,70}/)?.[0] ?? null,
      aiBlock: t.match(/AI-анализ[^.]{0,100}/g)?.slice(0, 4) ?? null,
    };
  });
  log('bag21_ai_providers', repAi);
  await page.screenshot({ path: path.join(SHOTS, 'bag21-providers.png') });

  // ---------- БАГ-07: top lists + dupes ----------
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
      out[txt] = rows.slice(0, 30);
    });
    return out;
  });
  const norm = (u) =>
    String(u)
      .toLowerCase()
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '') || '/';
  const dupCheck = {};
  for (const [card, rows] of Object.entries(tops)) {
    const seen = {};
    const dups = [];
    rows
      .map((r) => norm(r[0]))
      .forEach((k) => {
        seen[k] = (seen[k] ?? 0) + 1;
      });
    for (const [k, n] of Object.entries(seen)) if (n > 1) dups.push({ key: k, n });
    dupCheck[card] = { rows: rows.length, top5: rows.slice(0, 5).map((r) => r[0]), dupKeys: dups };
  }
  log('bag07_dupes', dupCheck);

  fs.writeFileSync(path.join(DIR, 'result-b5.json'), JSON.stringify(R, null, 2));
  await browser.close();
  console.log('DONE B5');
})().catch((e) => {
  console.error('FAIL B5', e);
  process.exit(1);
});
