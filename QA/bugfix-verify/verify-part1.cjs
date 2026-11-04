// Prod verification part 1: БАГ-14 (modals), БАГ-15 (kanban + removal UX), БАГ-22 (live title).
// Read-only except: opens modals, clicks delete → checks the dialog → CANCELS (no data change).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dashboardcamp.ru';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const R = {};
const log = (k, v) => {
  R[k] = v;
  console.log(`${k}: ${JSON.stringify(v)}`);
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    storageState: path.join(__dirname, '.state.json'),
  });
  const page = await ctx.newPage();

  // ---------- БАГ-22: /app/live title ----------
  await page.goto(`${BASE}/app/live`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const liveHeader = await page
    .locator('main h1')
    .first()
    .textContent()
    .catch(() => null);
  const quotaBanner = await page.getByText(/квот|недоступн/i).count();
  log('bag22_live_title', { header: liveHeader?.trim(), quotaBannerVisible: quotaBanner > 0 });
  await page.screenshot({ path: path.join(SHOTS, 'bag22-live.png') });

  // ---------- БАГ-14 + БАГ-15: hypotheses ----------
  await page.goto(`${BASE}/app/hypotheses`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=hyp-new]', { timeout: 30000 });
  await page.waitForTimeout(2500);

  // Kanban columns (БАГ-15 part 1)
  const cols = await page.$$eval('[data-testid=hyp-kanban] section', (els) =>
    els.map((el) => ({
      label: el.getAttribute('aria-label'),
      cards: el.querySelectorAll('article').length,
    })),
  );
  log('bag15_columns', cols);

  // Card overflow check (БАГ-15 part 2): every card within its column bounds
  const cardOverflow = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('[data-testid=hyp-kanban] section').forEach((col) => {
      const c = col.getBoundingClientRect();
      col.querySelectorAll('article').forEach((card) => {
        const r = card.getBoundingClientRect();
        if (r.right > c.right + 1 || r.left < c.left - 1) {
          bad.push({ card: card.textContent.slice(0, 40), cardRight: r.right, colRight: c.right });
        }
      });
    });
    return bad;
  });
  log('bag15_card_overflow', cardOverflow);

  // Modal «Новая гипотеза» (БАГ-14)
  await page.click('[data-testid=hyp-new]');
  await page.waitForSelector('[data-testid=hypothesis-editor]');
  await page.waitForTimeout(800);
  const modalState = await page.evaluate(() => {
    const dlg = document.querySelector('[role=dialog]');
    const body = document.querySelector('[data-testid=hypothesis-editor]');
    const alerts = dlg ? dlg.querySelectorAll('[role=alert]').length : -1;
    const textareas = dlg ? [...dlg.querySelectorAll('textarea')] : [];
    const heights = textareas.map((t) => t.offsetHeight);
    return {
      dialogScrollW: dlg?.scrollWidth,
      dialogClientW: dlg?.clientWidth,
      bodyScrollW: body?.scrollWidth,
      bodyClientW: body?.clientWidth,
      freshVisibleAlerts: alerts,
      textareaMinHeight: heights.length ? Math.min(...heights) : null,
    };
  });
  log('bag14_modal_new_hypothesis', modalState);
  await page.screenshot({ path: path.join(SHOTS, 'bag14-modal-new.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // «Новое решение»: the editor is shared — blank draft has kind=solution. Verify via editor again.
  await page.click('[data-testid=hyp-new]');
  await page.waitForSelector('[data-testid=hypothesis-editor]');
  const solutionState = await page.evaluate(() => {
    const dlg = document.querySelector('[role=dialog]');
    return { title: dlg?.querySelector('h3')?.textContent };
  });
  log('bag14_modal_headings', solutionState);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // БАГ-15 part 3: removal UX — click delete, expect styled dialog, then CANCEL.
  const delBtn = page
    .locator('[data-testid=hyp-kanban] article button[aria-label="Удалить"]')
    .first();
  if ((await delBtn.count()) > 0) {
    let nativeDialogSeen = false;
    page.once('dialog', (d) => {
      nativeDialogSeen = true;
      void d.dismiss();
    });
    await delBtn.click();
    await page.waitForTimeout(800);
    const dialogVisible = await page.getByTestId('confirm-body').count();
    const confirmText = dialogVisible ? await page.getByTestId('confirm-body').textContent() : null;
    log('bag15_delete_dialog', {
      styledDialog: dialogVisible > 0,
      text: confirmText,
      nativeDialogSeen,
    });
    await page.screenshot({ path: path.join(SHOTS, 'bag15-delete-dialog.png') });
    if (dialogVisible > 0) {
      await page.getByRole('button', { name: 'Отмена' }).click();
      await page.waitForTimeout(500);
      const stillThere = await page.locator('[data-testid=hyp-kanban] article').count();
      log('bag15_cancel_keeps_card', { cardsAfterCancel: stillThere });
    }
  } else {
    log('bag15_delete_dialog', 'no cards to delete');
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'result-part1.json'), JSON.stringify(R, null, 2));
  console.log('DONE part1');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
