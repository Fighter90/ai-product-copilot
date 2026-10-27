// Mobile (iPhone 14) smoke: every cabinet page renders without horizontal overflow, and the
// hamburger menu opens and navigates. Runs only under the `mobile-iphone-14` Playwright project
// (webkit). v3: the cabinet lives behind auth at /app — fixtures provide the session; admin, so
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
