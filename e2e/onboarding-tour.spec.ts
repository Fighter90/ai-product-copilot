// ANA-141: the onboarding tour is an overlay, never a render gate.
// A fresh storage (no tour flags) shows the tour exactly once and skipping persists the flag;
// `?tour=0` keeps every cabinet page fully rendered with zero tour clicks (automated checks,
// repeat users after clearing cookies).
import { test, expect, type Page } from '@playwright/test';
import { installMocks } from './fixtures';

/**
 * Cabinet mocks over a FRESH storage: installMocks seeds `pca.tour.v1.* = 'done'` and
 * `pca.locale = 'ru'` via an addInitScript registered at the END of installMocks (e2e/fixtures.ts
 * — not route mocks, not page.evaluate), so a removal script registered AFTER it is guaranteed to
 * run later on every navigation (init scripts run in registration order) and recreates the
 * first-visit state.
 */
async function mockCabinet(page: Page): Promise<void> {
  await installMocks(page);
  await page.addInitScript(() => {
    localStorage.removeItem('pca.tour.v1.analyst');
    localStorage.removeItem('pca.tour.v1.admin');
  });
}

test('fresh visit: the tour appears once and skipping persists the flag', async ({ page }) => {
  await mockCabinet(page);
  await page.goto('/app');

  const tour = page.getByTestId('onboarding-tour');
  await expect(tour).toBeVisible();

  // One «Пропустить тур» click dismisses it for good.
  await tour.getByRole('button', { name: 'Пропустить тур' }).first().click();
  await expect(page.getByTestId('onboarding-tour')).toHaveCount(0);

  // Skipping persists: the per-role «done» flag lands in localStorage. (Init scripts re-run on
  // every navigation, so a reload would reset the flags again — the flag itself is the product
  // contract a returning visitor's browser keeps.)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pca.tour.v1.analyst')))
    .toBe('done');
});

test('fresh visit: the cabinet content renders under the open tour', async ({ page }) => {
  await mockCabinet(page);
  await page.goto('/app');

  await expect(page.getByTestId('onboarding-tour')).toBeVisible();
  // The tour is a non-modal overlay: the page underneath is present, not gated.
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('main').locator('button').first()).toBeAttached();
});

test('?tour=0: pages render with no tour and no clicks', async ({ page }) => {
  await mockCabinet(page);

  await page.goto('/app?tour=0');
  await expect(page.getByTestId('onboarding-tour')).toHaveCount(0);
  await expect(page.getByRole('main')).toBeVisible();

  await page.goto('/app/traffic?tour=0');
  await expect(page.getByTestId('onboarding-tour')).toHaveCount(0);
  await expect(page.getByRole('main')).toBeVisible();
});
