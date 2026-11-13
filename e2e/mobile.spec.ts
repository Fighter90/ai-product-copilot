// Mobile (iPhone 14 profile on chromium, 390×844) smoke: every cabinet page renders without
// horizontal overflow, and the hamburger menu opens and navigates. Runs only under the
// `mobile-iphone-14` Playwright project (chromium, see playwright.config.ts — ANA-146). v3: the
// cabinet lives behind auth at /app — fixtures provide the session; admin, so
// the admin page is covered too.
import { test, expect } from '@playwright/test';
import { CABINET_USER, installMocks } from './fixtures';

const ADMIN = {
  ...CABINET_USER,
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};

const PAGES: ReadonlyArray<readonly [path: string, marker: RegExp]> = [
  ['/app', /Цель|Дайджест|успеваем/],
  ['/app/traffic', /Каналы/],
  ['/app/behavior', /Страницы входа/],
  ['/app/funnel', /Воронка/],
  ['/app/kpi', /цел|Прогресс|Цели/i],
  ['/app/report', /Собрать отчёт/],
  ['/app/history', /Отчётов пока нет|История/],
  ['/app/marketing', /Контент-маркетинг|Маркетинг/],
  ['/app/admin/metrika', /Метрика и данные/],
  ['/help', /Справка/],
];

/** No element forces the page wider than the viewport (allow 1px rounding). */
async function expectNoHorizontalScroll(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Mobile (iPhone 14) — no horizontal scroll on any page', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);
  for (const [path, marker] of PAGES) {
    test(`${path} fits the viewport`, async ({ page }) => {
      await installMocks(page, { user: ADMIN });
      await page.goto(path);
      // Scope to <main> so the marker matches page content, not the (hidden) desktop nav links.
      await expect(page.locator('main').getByText(marker).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }

  test('hamburger menu opens and navigates', async ({ page }) => {
    await installMocks(page, { user: ADMIN });
    await page.goto('/app');
    // Desktop nav links are hidden on mobile; the hamburger toggles the drawer (aria-label="menu").
    // The bottom tab bar also has an «Отчёт» link — scope to the drawer.
    await page.getByRole('button', { name: 'menu' }).click();
    const reportLink = page.getByTestId('mobile-drawer-panel').getByRole('link', { name: 'Отчёт' });
    await expect(reportLink).toBeVisible();
    await reportLink.click();
    await expect(page).toHaveURL(/\/app\/report$/);
    await expectNoHorizontalScroll(page);
  });
});

/** ANA-152: a complete hypothesis to open in the «Посмотреть» popup on the 390×844 viewport. */
const VIEW_HYPOTHESIS = {
  id: 100,
  diamondPhase: 'develop',
  kind: 'solution',
  subject: 'Слушатели подкаста',
  action: 'упростим регистрацию',
  solution: 'короткая форма в один шаг',
  condition: 'CR вырастет до 5%',
  title: 'Гипотеза про подкаст: короткая форма регистрации вместо длинной',
  description: 'Слушатели испытывают низкую конверсию при регистрации, потому что форма длинная.',
  hiddenAssumptions: [
    { category: 'behavior', text: 'слушатели ленятся заполнять длинные формы' },
    { category: 'market', text: 'конкуренты уже упростили онбординг' },
    { category: 'tech', text: 'форма переиспользуется с лендинга' },
  ],
  validationMethods: [
    { type: 'quantitative', plan: 'A/B-тест формы' },
    { type: 'synthetic', plan: '5 интервью со слушателями' },
  ],
  impact: 5,
  confidence: 5,
  ease: 5,
  impactRationale: 'крупный канал с низкой конверсией',
  confidenceRationale: 'данные Метрики подтверждают',
  easeRationale: 'готовые компоненты формы',
  greenCriteria: 'CR ≥ 5% за две недели',
  yellowCriteria: 'CR 3–5%',
  redCriteria: 'CR < 3%',
  deadlineDays: 14,
  source: 'manual',
  iceScore: 125,
  status: 'in_progress',
  deadlineAt: '2026-11-28T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

test.describe('Mobile — hypothesis «Посмотреть» popup (ANA-152)', () => {
  test.setTimeout(60_000);

  test('the popup fits the 390px viewport: no horizontal overflow, dialog inside the screen', async ({
    page,
  }) => {
    await installMocks(page, { user: ADMIN, hypotheses: [VIEW_HYPOTHESIS] });
    await page.goto('/app/hypotheses');
    await page.getByTestId('hyp-card-100').getByTestId('hyp-view-btn').click();

    const modal = page.getByTestId('hyp-view-modal');
    await expect(modal).toBeVisible();
    // The full description renders — nothing replaced by the card's small heading.
    await expect(modal).toContainText('короткая форма в один шаг');
    await expect(modal).toContainText('CR вырастет до 5%');
    // Nothing pushes the page wider than the phone screen, and the dialog stays inside it.
    await expectNoHorizontalScroll(page);
    const box = (await modal.boundingBox()) as { x: number; width: number };
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // The content scrolls inside the popup, not the page.
    await expect(modal).toContainText('CR ≥ 5% за две недели');
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });
});
