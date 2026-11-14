import { test, expect, type Page } from '@playwright/test';
import { installMocks } from './fixtures';

/**
 * v3: B2B is a first-class cabinet page again — /app/b2b («B2B-сделки»), the v2.7 «B2B lives
 * in Settings» detour is gone. The legacy /b2b URL redirects into the cabinet (LegacyRedirect),
 * which requires a session — fixtures provide the analyst.
 * ANA-164: the page is a drag-and-drop kanban by default; the deal table lives behind the
 * «Канбан / Таблица» switcher.
 */

/** A real DataTransfer object from the page context (jsdom-style stubs cannot cross the wire). */
async function dataTransfer(page: Page, dealId: number): Promise<unknown> {
  return page.evaluateHandle((id) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', String(id));
    return dt;
  }, dealId);
}

test.describe('B2B-сделки in the cabinet', () => {
  test('/b2b redirects to /app/b2b and renders the deal kanban', async ({ page }) => {
    await installMocks(page);
    await page.goto('/b2b');
    await expect(page).toHaveURL(/\/app\/b2b$/);
    // Kanban by default: every stage column is present, each deal renders as a card.
    for (const stage of ['lead', 'negotiation', 'invoiced', 'paid']) {
      await expect(page.getByTestId(`b2b-col-${stage}`)).toBeVisible();
    }
    await expect(page.getByTestId('b2b-card-1')).toContainText('BigCorp');
    await expect(page.getByTestId('b2b-card-2')).toContainText('MidMarket');
  });

  test('the view switcher shows the deal table and the stage can be changed there', async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto('/app');
    await expect(page.getByRole('link', { name: 'B2B-сделки' })).toBeVisible();
    await page.getByRole('link', { name: 'B2B-сделки' }).click();
    await expect(page).toHaveURL(/\/app\/b2b$/);
    // Table view via the «Канбан / Таблица» switcher.
    await page.getByTestId('b2b-view-table').click();
    await expect(page.getByRole('cell', { name: 'BigCorp', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'MidMarket', exact: true })).toBeVisible();

    const stage = page.getByLabel('Этап MidMarket');
    await stage.selectOption('paid');
    await expect(page.getByLabel('Этап MidMarket')).toHaveValue('paid');
    // Back to the board.
    await page.getByTestId('b2b-view-kanban').click();
    await expect(page.getByTestId('b2b-card-2')).toContainText('MidMarket');
  });

  test('ANA-164: drag-and-drop between columns changes the deal stage (PATCH)', async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto('/app/b2b');
    // MidMarket (id 2) sits in «invoiced»; drop it onto «paid».
    const dt = await dataTransfer(page, 2);
    const patchPromise = page.waitForRequest(
      (r) => r.method() === 'PATCH' && r.url().includes('/api/b2b/2'),
    );
    await page.getByTestId('b2b-card-2').dispatchEvent('dragstart', { dataTransfer: dt });
    await page.getByTestId('b2b-col-paid').dispatchEvent('drop', { dataTransfer: dt });

    const req = await patchPromise;
    expect(JSON.parse(req.postData() ?? '{}')).toMatchObject({ stage: 'paid' });
    // The mock state merged the body and the board refetches — the card stays in «paid».
    await expect(page.getByTestId('b2b-col-paid').getByTestId('b2b-card-2')).toBeVisible();
    // Counters follow the deal: the paid column now holds both deals.
    await expect(page.getByTestId('b2b-col-paid-count')).toHaveText('2');
  });
});
