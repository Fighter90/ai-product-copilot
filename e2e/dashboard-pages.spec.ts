// Read-only cabinet pages render their data. The cabinet lives behind auth at /app (/ is the public
// Landing), so the session endpoint is mocked alongside the metrics — same approach as
// overview-fold.spec.ts. Live (Reporting API) endpoints get small fixed payloads.
import { test, expect, type Page } from '@playwright/test';
import { installMocks } from './fixtures';

const USER = {
  id: 1,
  email: 'analyst@example.com',
  name: 'Analyst',
  role: 'analyst',
  locale: 'ru',
  isActive: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  lastLoginAt: null,
};

const NOW = new Date().toISOString();
const goal = (id: number, name: string, archived: boolean) => ({
  id,
  name,
  type: 'action',
  event: `event_${id}`,
  reaches: 10,
  goalVisits: 9,
  conversionRate: 1.1,
  previousReaches: 5,
  delta: 1,
  reaches14: 10,
  reaches90: 30,
  status: 'live',
  archived,
  duplicateOf: [],
});
const LIVE_GOALS = {
  from: '2025-01-01',
  to: '2025-01-14',
  previous: { from: '2024-12-18', to: '2024-12-31' },
  visits: 800,
  updatedAt: NOW,
  goals: [goal(1, 'Ticket purchase', false), goal(2, 'Old landing form', true)],
};

async function mockCabinet(page: Page, locale: 'ru' | 'en' = 'ru'): Promise<void> {
  // Catch-all first: Playwright gives priority to routes registered later, so specific mocks win.
  await page.route('**/api/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await installMocks(page);
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: USER }),
    }),
  );
  await page.route('**/api/live/goals?*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIVE_GOALS) }),
  );
  await page.addInitScript((l) => {
    localStorage.setItem('pca.onboarded', '1');
    localStorage.setItem('pca.locale', l);
  }, locale);
}

test.describe('Read-only dashboard pages render their data', () => {
  test('Overview: KPI strip + charts; the auto-detected KPI goal sits in «Качество данных»', async ({
    page,
  }) => {
    await mockCabinet(page);
    await page.goto('/app');
    const strip = page.getByTestId('kpi-strip');
    await expect(strip.getByText(/Успеваем к 300\?/)).toBeVisible();
    // Mocked primary goal is a purchase goal → the KPI tile counts orders.
    await expect(strip.getByText(/Заказов/)).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Топ стран по визитам' })).toBeVisible();

    // Notices are collapsed: the KPI-goal notice is revealed only after expanding the block.
    const quality = page.getByTestId('data-quality');
    await expect(page.getByText(/KPI-цель определена автоматически/)).toBeHidden();
    await quality.locator('summary').click();
    await expect(page.getByText(/KPI-цель определена автоматически/)).toBeVisible();
    await expect(quality.getByText('Ecommerce: покупка')).toBeVisible();
  });

  test('Traffic: channel charts + channel and UTM tables', async ({ page }) => {
    await mockCabinet(page);
    await page.goto('/app/traffic');
    await expect(page.getByText('Каналы — визиты', { exact: true })).toBeVisible();
    await expect(page.getByText(/Каналы — визиты vs заявки/)).toBeVisible();
    await expect(page.getByText('UTM-разбивка')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'podcast' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'spring' })).toBeVisible();
    await expect(page.locator('canvas').nth(1)).toBeVisible();
  });

  test('Behavior: entry + exit pages', async ({ page }) => {
    await mockCabinet(page);
    await page.goto('/app/behavior');
    await expect(page.getByRole('heading', { name: 'Страницы входа' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Страницы выхода' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '/lp' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '/checkout' })).toBeVisible();
  });

  test('Funnel & B2B: «заявка ≠ оплата» stages', async ({ page }) => {
    await mockCabinet(page);
    await page.goto('/app/funnel');
    await expect(page.getByText('Воронка конверсии')).toBeVisible();
    await expect(page.getByText('Оплачено B2B').first()).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('KPI & forecast: goal ring + «Что если»', async ({ page }) => {
    await mockCabinet(page);
    await page.goto('/app/kpi');
    await expect(page.getByText('Главная цель: 300 платных билетов')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Прогноз' })).toBeVisible();
  });

  test('Metrika goals: archived goals appear only with «Архивные цели»', async ({ page }) => {
    await mockCabinet(page);
    await page.goto('/app/goals');
    await expect(page.getByText('Ticket purchase')).toBeVisible();
    await expect(page.getByText('Old landing form')).toBeHidden();
    await page.getByLabel('Архивные цели').check();
    await expect(page.getByText('Old landing form')).toBeVisible();
  });
});

test.describe('English interface', () => {
  for (const path of ['/app/traffic', '/app/behavior', '/app/kpi']) {
    test(`${path} has no Cyrillic UI text`, async ({ page }) => {
      await mockCabinet(page, 'en');
      await page.goto(path);
      await expect(page.locator('main canvas').first()).toBeVisible();
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/[\u0400-\u04FF]/);
    });
  }
});

test.describe('Pages surface an error state when the API fails', () => {
  test('Overview shows an error alert on a 500', async ({ page }) => {
    await mockCabinet(page);
    await installMocks(page, { errors: ['channels'] });
    await page.goto('/app');
    await expect(page.getByRole('alert').first()).toBeVisible();
  });

  test('Traffic shows an error alert on a 500', async ({ page }) => {
    await mockCabinet(page);
    await installMocks(page, { errors: ['channels', 'utm'] });
    await page.goto('/app/traffic');
    await expect(page.getByRole('alert').first()).toBeVisible();
  });
});
