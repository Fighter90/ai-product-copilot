// Prod verification part 2: БАГ-15 with a real card (create via API → check → delete via UI dialog).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dashboardcamp.ru';
const SHOTS = path.join(__dirname, 'shots');
const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log(`${k}: ${JSON.stringify(v)}`);
};

const HYP = {
  diamondPhase: 'develop',
  kind: 'solution',
  subject: 'QA-verify',
  action: 'проверяем удаление',
  solution: 'карточка создаётся скриптом',
  condition: 'если карточка видна в канбане',
  title: 'QA БАГ-15 карточка (удаляется скриптом)',
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

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(__dirname, '.state.json'),
  });
  const page = await ctx.newPage();

  // Create via API (same session).
  const resp = await page.request.post(`${BASE}/api/hypotheses`, { data: HYP });
  const created = await resp.json().catch(() => ({}));
  log('create_hypothesis', { status: resp.status(), id: created?.id ?? created?.error });
  if (resp.status() !== 200 && resp.status() !== 201) {
    await browser.close();
    process.exit(1);
  }
  const id = created.id;

  await page.goto(`${BASE}/app/hypotheses`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-testid=hyp-card-${id}]`, { timeout: 30000 });

  // Column placement + overflow with a real (long) title.
  const placement = await page.evaluate((cardId) => {
    const card = document.querySelector(`[data-testid=hyp-card-${cardId}]`);
    const col = card?.closest('section');
    const c = col?.getBoundingClientRect();
    const r = card?.getBoundingClientRect();
    return {
      column: col?.getAttribute('aria-label'),
      overflow: c && r ? r.right > c.right + 1 || r.left < c.left - 1 : null,
      cardScrollW: card?.scrollWidth,
      cardClientW: card?.clientWidth,
    };
  }, id);
  log('bag15_card_placement', placement);
  await page.screenshot({ path: path.join(SHOTS, 'bag15-card.png') });

  // Delete via UI — on prod this is still the NATIVE confirm (fix not deployed yet).
  let nativeDialogText = null;
  let nativeSeen = false;
  page.once('dialog', (d) => {
    nativeSeen = true;
    nativeDialogText = d.message();
    void d.accept();
  });
  await page.locator(`[data-testid=hyp-card-${id}] button[aria-label="Удалить"]`).click();
  await page.waitForTimeout(1200);
  const styledCount = await page.getByTestId('confirm-body').count();
  log('bag15_delete_removal_ux', {
    nativeConfirmSeen: nativeSeen,
    nativeText: nativeDialogText,
    styledDialogOnProd: styledCount > 0,
  });
  await page.waitForSelector(`[data-testid=hyp-card-${id}]`, { state: 'detached', timeout: 15000 });
  log('bag15_card_deleted', true);

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'result-part2.json'), JSON.stringify(R, null, 2));
  console.log('DONE part2');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
