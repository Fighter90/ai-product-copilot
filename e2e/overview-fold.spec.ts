// ANA-48: the Overview KPI strip («успеваем к 300?» + KPI tiles) must be fully visible without
// scrolling at 1280×800 (desktop) and 375×812 (phone); data-quality notices stay collapsed below.
// The cabinet lives behind auth at /app, so the session endpoint is mocked alongside the metrics.
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

async function mockCabinet(page: Page): Promise<void> {
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
  // Skip the first-visit onboarding card and pin the interface language.
  await page.addInitScript(() => {
    localStorage.setItem('pca.onboarded', '1');
    localStorage.setItem('pca.locale', 'ru');
  });
}

const VIEWPORTS = [
  { name: 'desktop 1280×800', width: 1280, height: 800 },
  { name: 'phone 375×812', width: 375, height: 812 },
] as const;

for (const vp of VIEWPORTS) {
  test(`Overview: KPI strip is above the fold at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await mockCabinet(page);
    await page.goto('/app');

    const strip = page.getByTestId('kpi-strip');
    await expect(strip).toBeVisible();
    await expect(strip.getByText(/Успеваем к 300\?/)).toBeVisible();

    const box = await strip.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    }

    // Data-quality notices are collapsed into one block below the strip.
    const quality = page.getByTestId('data-quality');
    await expect(quality).toBeVisible();
    await expect(quality).not.toHaveAttribute('open', /.*/);
    await expect(page.getByText(/KPI-цель определена автоматически/)).toBeHidden();
    const qBox = await quality.boundingBox();
    if (box && qBox) expect(qBox.y).toBeGreaterThanOrEqual(box.y + box.height);
  });
}
