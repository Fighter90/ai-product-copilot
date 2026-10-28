import { test, expect } from '@playwright/test';
import { installMocks } from './fixtures';

test.describe('Global filter header (cabinet /app)', () => {
  test('period presets change the displayed date range', async ({ page }) => {
    await installMocks(page);
    await page.goto('/app');
    // Default range is the 14-day preset (13 days ago → today), so click 7д first to force a change.
    const range = page.locator('header span.font-mono').first();
    const rangeBefore = (await range.textContent()) ?? '';
    await page.getByRole('button', { name: '7д' }).click();
    await expect(range).not.toHaveText(rangeBefore);
    await page.getByRole('button', { name: '14д' }).click();
    await expect(range).toHaveText(rangeBefore);
  });

  test('segment toggle is interactive; archived toggle lives on /app/goals (БАГ-06)', async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto('/app');
    await page.getByLabel('Сегмент').selectOption('b2b');
    await expect(page.getByLabel('Сегмент')).toHaveValue('b2b');
    // «Архивные цели» фильтрует список целей — тумблер скрыт на Обзоре (где списка нет).
    await page.goto('/app/goals');
    const archived = page.getByLabel('Архивные цели');
    await expect(archived).not.toBeChecked();
    await archived.check();
    await expect(archived).toBeChecked();
  });
});
