// ANA-26 / ANA-30: cabinet access by role. The backend is mocked at the network layer (like
// overview-fold.spec.ts): `/api/auth/me` decides who the viewer is.
//   admin   — sees the «Администрирование» nav section and opens every /app/admin/* page;
//   analyst — no admin nav; a direct visit to /app/admin/* renders the 403 panel;
//   guest   — any /app/* URL redirects to /login?next=…; signing in returns to the target.
import { test, expect, type Page } from '@playwright/test';
import { installMocks } from './fixtures';

type Role = 'admin' | 'analyst';

const user = (role: Role) => ({
  id: role === 'admin' ? 1 : 2,
  email: `${role}@example.com`,
  name: role === 'admin' ? 'Admin' : 'Analyst',
  role,
  locale: 'ru',
  isActive: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  lastLoginAt: null,
});

const ADMIN_PAGES = [
  { path: '/app/admin/users', heading: 'Пользователи' },
  { path: '/app/admin/ai', heading: 'AI-провайдеры' },
  { path: '/app/admin/metrika', heading: 'Метрика и данные' },
  { path: '/app/admin/audit', heading: 'Журнал действий' },
] as const;

async function mockSession(page: Page, role: Role | null): Promise<void> {
  // Catch-all first: Playwright gives priority to routes registered later, so specific mocks win.
  await page.route('**/api/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await installMocks(page);
  // v3 settings shape is Record<key, SettingView>; an empty object keeps admin pages calm.
  await page.route('**/api/settings', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/notifications', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // Users page: ANA-29 counter options (no Metrika counters configured in the mock).
  await page.route('**/api/admin/counters', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: 0, counters: [] }),
    }),
  );
  await page.route('**/api/admin/user-counters', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  // Metrika page: pc-goals audit (GoalsManager) — an empty but well-shaped report.
  await page.route('**/api/admin/metrika/goals/audit*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        expected: [],
        dead: [],
        duplicates: [],
        goals: [],
        days: 90,
        permission: null,
        canWrite: true,
        warnings: [],
      }),
    }),
  );
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: role ? user(role) : null }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('pca.onboarded', '1');
    // The v3 onboarding tour checks pca.tour.v1.<role> === 'done' (onboarding/tour.ts) —
    // mark both roles seen so the tour overlay never covers admin pages.
    localStorage.setItem('pca.tour.v1.admin', 'done');
    localStorage.setItem('pca.tour.v1.analyst', 'done');
    localStorage.setItem('pca.locale', 'ru');
  });
}

test.describe('role: admin', () => {
  test('sees the admin nav section with every admin page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockSession(page, 'admin');
    await page.goto('/app');
    const nav = page.getByRole('navigation', { name: 'cabinet' });
    await expect(nav.getByText('Администрирование')).toBeVisible();
    for (const p of ADMIN_PAGES) {
      await expect(nav.locator(`a[href="${p.path}"]`)).toBeVisible();
    }
  });

  for (const p of ADMIN_PAGES) {
    test(`opens ${p.path}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await mockSession(page, 'admin');
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Нет доступа' })).toHaveCount(0);
    });
  }
});

test.describe('role: analyst', () => {
  test('has no admin nav section', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockSession(page, 'analyst');
    await page.goto('/app');
    const nav = page.getByRole('navigation', { name: 'cabinet' });
    await expect(nav.locator('a[href="/app/report"]')).toBeVisible();
    await expect(nav.getByText('Администрирование')).toHaveCount(0);
    await expect(nav.locator('a[href^="/app/admin/"]')).toHaveCount(0);
  });

  for (const p of ADMIN_PAGES) {
    test(`direct visit to ${p.path} → 403 panel`, async ({ page }) => {
      await mockSession(page, 'analyst');
      await page.goto(p.path);
      await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${p.path}$`));
    });
  }
});

test.describe('role: guest', () => {
  for (const path of ['/app', '/app/report', '/app/admin/users']) {
    test(`${path} redirects to /login?next=…`, async ({ page }) => {
      await mockSession(page, null);
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(path);
      await expect(page.getByRole('heading', { name: 'Вход в кабинет' })).toBeVisible();
    });
  }

  test('signing in as admin returns to the requested admin page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockSession(page, null);
    await page.route('**/api/auth/login', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: user('admin') }),
      }),
    );
    await page.goto('/app/admin/users');
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Пароль').fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/app\/admin\/users$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Пользователи' })).toBeVisible();
  });
});
