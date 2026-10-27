import { test, expect } from '@playwright/test';
import { CABINET_USER, installMocks } from './fixtures';

/**
 * Cross-page navigation journey: the cabinet shell (v3, behind auth at /app — `/` is the public
 * landing) boots and every nav link reaches a page that renders. Admin session so the
 * «Администрирование» section is visible too. Per-feature depth lives in the focused specs
 * (report/filters/dashboard-pages/b2b). Backend is mocked via the shared fixtures.
 */
const ADMIN = {
  ...CABINET_USER,
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};

test('dashboard shell renders nav and every page is reachable', async ({ page }) => {
  await installMocks(page, { user: ADMIN });
  await page.goto('/app');

  await expect(page.getByRole('link', { name: 'Обзор' })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();

  for (const [name, marker] of [
    ['Трафик', 'Каналы — визиты'],
    ['Поведение', 'Страницы входа'],
    ['Воронка и B2B', 'Воронка конверсии'],
  ] as const) {
    await page.getByRole('link', { name }).click();
    await expect(page.getByText(marker).first()).toBeVisible();
  }

  await page.getByRole('link', { name: 'Отчёт' }).click();
  await expect(page.getByRole('button', { name: 'Собрать отчёт' })).toBeVisible();

  await page.getByRole('link', { name: 'История' }).click();
  await expect(page.getByText(/Отчётов пока нет|Всего отчётов/)).toBeVisible();

  await page.getByRole('link', { name: 'B2B-сделки' }).click();
  await expect(page.getByRole('cell', { name: 'BigCorp' })).toBeVisible();

  await page.getByRole('link', { name: 'Маркетинг' }).click();
  await expect(page.getByText('Контент-маркетинг', { exact: true })).toBeVisible();

  // Admin-only section (ANA-29): settings moved from v2 /settings to /app/admin/metrika.
  await page.getByRole('link', { name: 'Метрика и данные' }).click();
  await expect(page.getByRole('heading', { name: 'Метрика и данные' })).toBeVisible();
});
