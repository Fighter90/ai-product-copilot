// ANA-49: the global filter panel must be axe-clean — every control labelled, roles and
// states exposed, keyboard/focus handled, and the «Догрузить N дней» prompt (coverage
// endpoint) accessible too. Full-rule axe scan of `#filter-controls` with `color-contrast`
// disabled: text contrast is covered (and allowlisted) by contrast.spec.ts — duplicating it
// here would fail on tracked token defects that belong to that spec.
// The backend is mocked at the network layer (same approach as contrast/roles specs).
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installMocks } from './fixtures';

type Role = 'admin' | 'analyst' | null;

const USER = (role: Role) => ({
  id: role === 'admin' ? 1 : 2,
  email: `${role ?? 'anon'}@example.com`,
  name: role === 'admin' ? 'Admin' : 'Analyst',
  role,
  locale: 'ru',
  isActive: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  lastLoginAt: null,
});

async function mockApi(
  page: Page,
  role: Role,
  coverage: { from: string; to: string; days: number },
): Promise<void> {
  // Catch-all first: later (specific) routes win.
  await page.route('**/api/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await installMocks(page);
  await page.route('**/api/settings', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/notifications', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/metrics/coverage', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(coverage) }),
  );
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: role ? USER(role) : null }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('pca.onboarded', '1');
    localStorage.setItem('pca.locale', 'ru');
    localStorage.setItem('pca.theme', 'dark');
  });
}

/** Kill animations and wait for react-query to settle — same prep as contrast.spec.ts. */
async function prepareForScan(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !document.querySelector('.skeleton'), undefined, {
    timeout: 15_000,
  });
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }',
  });
}

async function scanPanel(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('#filter-controls')
    .disableRules(['color-contrast'])
    .analyze();
  if (results.violations.length > 0)
    console.log('filter-panel violations:', JSON.stringify(results.violations));
  expect(results.violations).toEqual([]);
}

test('desktop: filter panel has no axe violations (ANA-49)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page, 'analyst', { from: '2026-09-01', to: '2026-10-26', days: 56 });
  await page.goto('/app');
  await expect(page.locator('#filter-controls')).toBeVisible();
  await prepareForScan(page);
  await scanPanel(page);
});

test('mobile: filter bottom-sheet has no axe violations and shows the period (ANA-49)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, 'analyst', { from: '2026-09-01', to: '2026-10-26', days: 56 });
  await page.goto('/app');
  const trigger = page.getByRole('button', { name: /Фильтры/ });
  await expect(trigger).toBeVisible();
  // The collapsed trigger itself indicates the current period (ANA-49 finding).
  // NBSP-aware (\s covers U+00A0) and Cyrillic-aware (\w is latin-only — use a negated class).
  await expect(trigger).toContainText(/Фильтры[\s\S]*\d{1,2}\s[^\d\s.]+\.?\s\d{4}[\s\S]*/);
  await trigger.click();
  await expect(page.locator('#filter-controls')).toBeVisible();
  await prepareForScan(page);
  // The sheet carries the current period AND the comparison baseline.
  await expect(page.locator('#filter-controls')).toContainText('vs ');
  await scanPanel(page);
});

test('coverage prompt: «Догрузить N дней» renders and is axe-clean (ANA-49)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Cache starts 5 days back (mid-period) → the first ~8 days of the default 14-day
  // window are uncovered → the prompt must render.
  const day = (offset: number): string =>
    new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  await mockApi(page, 'admin', { from: day(5), to: day(0), days: 5 });
  await page.goto('/app');
  await expect(page.locator('#filter-controls')).toBeVisible();
  await prepareForScan(page);

  const prompt = page.getByRole('status').filter({ hasText: 'Метрика загружена только с' });
  await expect(prompt).toBeVisible();
  // Admin sees an enabled backfill action; non-admins get a disabled one (covered below).
  await expect(prompt.getByRole('button', { name: /Догрузить/ })).toBeEnabled();
  await scanPanel(page);
});

test('coverage prompt: backfill is disabled for non-admins with an explanation (ANA-49)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const day = (offset: number): string =>
    new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  await mockApi(page, 'analyst', { from: day(5), to: day(0), days: 5 });
  await page.goto('/app');
  await expect(page.locator('#filter-controls')).toBeVisible();
  await prepareForScan(page);

  const prompt = page.getByRole('status').filter({ hasText: 'Метрика загружена только с' });
  await expect(prompt).toBeVisible();
  const action = prompt.getByRole('button', { name: /Догрузить/ });
  await expect(action).toBeDisabled();
  await expect(action).toHaveAttribute('title', 'Догрузка доступна только администратору');
});

test('coverage fully covering the period hides the backfill prompt', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const day = (offset: number): string =>
    new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  // Default period is 14 days; the cache reaches further back → no prompt.
  await mockApi(page, 'analyst', { from: day(120), to: day(0), days: 120 });
  await page.goto('/app');
  await expect(page.locator('#filter-controls')).toBeVisible();
  await prepareForScan(page);
  await expect(
    page.getByRole('status').filter({ hasText: 'Метрика загружена только с' }),
  ).toHaveCount(0);
  await scanPanel(page);
});
