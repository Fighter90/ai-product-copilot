import { test, expect } from '@playwright/test';
import { installMocks } from './fixtures';

test.describe('Report — snapshot, on-screen render, export, AI', () => {
  test('builds a snapshot and renders the full report on screen', async ({ page }) => {
    await installMocks(page);
    await page.goto('/app/report');
    // ANA-39: one primary build action — «Собрать отчёт» (rep.build).
    await page.getByRole('button', { name: 'Собрать отчёт' }).click();
    // On-screen render = the same sections the exports produce; titles are <summary> rows of
    // collapsible <details> blocks (first two open), not headings.
    const full = page.getByRole('article', { name: 'Полный отчёт' });
    // Section titles appear twice (TOC link + <summary> row) — take the first occurrence.
    await expect(full.getByText('Краткие итоги', { exact: true }).first()).toBeVisible();
    await expect(
      full.getByText('Воронка: визит → заявка → оплата', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      full.getByText('Каналы: трафик и конверсия', { exact: true }).first(),
    ).toBeVisible();
    await expect(full.getByText('Глоссарий и принципы', { exact: true }).first()).toBeVisible();
    await expect(full.getByText('Приложение с данными', { exact: true }).first()).toBeVisible();
  });

  test('exports DOCX and PDF and generates the AI analysis', async ({ page }) => {
    await installMocks(page);
    await page.goto('/app/report');
    await page.getByRole('button', { name: 'Собрать отчёт' }).click();
    await expect(page.getByRole('article', { name: 'Полный отчёт' })).toBeVisible();

    // The app downloads via a programmatic <a> to the download endpoint; asserting the response
    // (status + attachment filename) is deterministic, a bare download-event wait is not.
    const docxResp = page.waitForResponse('**/api/report/download/**');
    await page.getByRole('button', { name: 'Export DOCX' }).click();
    const r1 = await docxResp;
    expect(r1.status()).toBe(200);
    expect(r1.headers()['content-disposition']).toContain('productcamp-report-snap-e2e.docx');

    const pdfResp = page.waitForResponse('**/api/report/download/**');
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const r2 = await pdfResp;
    expect(r2.status()).toBe(200);
    expect(r2.headers()['content-disposition']).toContain('productcamp-report-snap-e2e.pdf');

    // The insights mock answers the automatic GET as well — the narrative may already be on
    // screen (then the button is disabled with «уже сгенерирован»); click only if needed.
    const gen = page.getByRole('button', { name: 'Сгенерировать AI-анализ' });
    if (await gen.isEnabled().catch(() => false)) await gen.click();
    await expect(page.getByText(/AI-анализ: визиты растут/)).toBeVisible();
  });
});
