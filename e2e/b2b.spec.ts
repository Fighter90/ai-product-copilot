import { test, expect } from '@playwright/test';
import { installMocks } from './fixtures';

/**
 * v3: B2B is a first-class cabinet page again — /app/b2b («B2B-сделки»), the v2.7 «B2B lives
 * in Settings» detour is gone. The legacy /b2b URL redirects into the cabinet (LegacyRedirect),
 * which requires a session — fixtures provide the analyst.
 */
test.describe('B2B-сделки in the cabinet', () => {
  test('/b2b redirects to /app/b2b and renders the deal table', async ({ page }) => {
    await installMocks(page);
    await page.goto('/b2b');
    await expect(page).toHaveURL(/\/app\/b2b$/);
    // The table is collapsed to the first rows — expand to see every deal.
    await page.getByRole('button', { name: /Развернуть полную таблицу/ }).click();
    await expect(page.getByRole('cell', { name: 'BigCorp' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'MidMarket' })).toBeVisible();
  });

  test('nav shows the B2B page and the deal stage can be changed', async ({ page }) => {
    await installMocks(page);
    await page.goto('/app');
    await expect(page.getByRole('link', { name: 'B2B-сделки' })).toBeVisible();
    await page.getByRole('link', { name: 'B2B-сделки' }).click();
    await expect(page).toHaveURL(/\/app\/b2b$/);

    const stage = page.getByLabel('Этап MidMarket');
    await stage.selectOption('paid');
    await expect(page.getByLabel('Этап MidMarket')).toHaveValue('paid');
  });
});
