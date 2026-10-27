// Hypotheses workspace (ANA-37) + «→ гипотеза» deep link (ANA-24). The methodology pages are
// restored as first-class routes: /hypotheses opens the kanban, /decisions the Decision Log —
// no redirect to /report anymore.
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

/** A complete persisted hypothesis (as GET /hypotheses returns) to seed the list. */
const SEEDED_HYPOTHESIS = {
  id: 100,
  diamondPhase: 'develop',
  kind: 'solution',
  subject: 'Подкаст',
  action: 'упростим форму регистрации',
  solution: 'короткая форма в один шаг',
  condition: 'CR вырастет до 5%',
  title: 'Гипотеза про подкаст',
  hiddenAssumptions: [
    { category: 'behavior', text: 'слушатели ленятся заполнять длинные формы' },
    { category: 'market', text: 'конкуренты уже упростили онбординг' },
    { category: 'tech', text: 'форма переиспользуется с лендинга' },
  ],
  validationMethods: [
    { type: 'quantitative', plan: 'A/B-тест формы' },
    { type: 'synthetic', plan: '5 интервью с слушателями' },
  ],
  impact: 5,
  confidence: 5,
  ease: 5,
  impactRationale: 'крупный канал',
  confidenceRationale: 'данные Метрики',
  easeRationale: 'готовые компоненты',
  greenCriteria: 'CR ≥ 5%',
  yellowCriteria: 'CR 3–5%',
  redCriteria: 'CR < 3%',
  deadlineDays: 14,
  source: 'manual',
  iceScore: 125,
  status: 'green',
  deadlineAt: '2026-11-10T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

async function mockWorkspace(
  page: Page,
  opts: Parameters<typeof installMocks>[1] = {},
): Promise<void> {
  await installMocks(page, opts);
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: USER }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('pca.onboarded', '1');
    localStorage.setItem('pca.locale', 'ru');
  });
}

/** Open the seeded editor from the «Слабые места» card on Overview (ANA-24 click-through). */
async function openEditorFromOverview(page: Page): Promise<void> {
  await page.goto('/app');
  await expect(page.getByText('Слабые места', { exact: false }).first()).toBeVisible();
  await page.getByRole('link', { name: '→ гипотеза' }).first().click();
}

test.describe('Hypotheses workspace (ANA-37)', () => {
  test('nav shows Гипотезы and Решения; legacy /hypotheses and /decisions land on the workspace, not /report', async ({
    page,
  }) => {
    await mockWorkspace(page);
    await page.goto('/app/hypotheses');
    await expect(page).toHaveURL(/\/app\/hypotheses$/);
    await expect(page.getByTestId('hyp-kanban')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Гипотезы' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Решения' }).first()).toBeVisible();

    await page.goto('/decisions');
    await expect(page).toHaveURL(/\/app\/decisions$/);
    await expect(page.getByRole('heading', { name: 'Decision Log' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/app\/report/);
  });

  test('editor refuses to save an incomplete hypothesis and shows per-field errors', async ({
    page,
  }) => {
    await mockWorkspace(page);
    await page.goto('/app/hypotheses');
    await page.getByTestId('hyp-new').click();
    const editor = page.getByTestId('hypothesis-editor');
    await expect(editor).toBeVisible();
    // Blank draft → per-field errors, save disabled.
    await expect(page.getByTestId('hyp-save')).toBeDisabled();
    await expect(editor.getByText('Заполните поле').first()).toBeVisible();
    await expect(editor.getByText(/Скрытые допущения/)).toBeVisible();
    await expect(editor.getByText(/Методы проверки/)).toBeVisible();
  });

  test('status change moves a card across kanban columns', async ({ page }) => {
    await mockWorkspace(page, { hypotheses: [SEEDED_HYPOTHESIS] });
    await page.goto('/app/hypotheses');
    const card = page.getByTestId('hyp-card-100');
    await expect(card).toBeVisible();
    await card
      .getByRole('combobox', { name: 'Изменить статус' })
      .selectOption({ label: 'В проверке' });
    const column = page.getByRole('region', { name: 'В проверке' });
    await expect(column.getByTestId('hyp-card-100')).toBeVisible();
  });

  test('delete removes the card from the kanban', async ({ page }) => {
    await mockWorkspace(page, { hypotheses: [SEEDED_HYPOTHESIS] });
    await page.goto('/app/hypotheses');
    page.on('dialog', (d) => void d.accept());
    await page.getByTestId('hyp-card-100').getByRole('button', { name: 'Удалить' }).click();
    await expect(page.getByTestId('hyp-card-100')).toHaveCount(0);
  });

  test('ICE table sorts by the clicked column', async ({ page }) => {
    await mockWorkspace(page, {
      hypotheses: [
        {
          ...SEEDED_HYPOTHESIS,
          id: 100,
          title: 'AAA низкий ICE',
          impact: 1,
          confidence: 1,
          ease: 1,
          iceScore: 1,
        },
        {
          ...SEEDED_HYPOTHESIS,
          id: 101,
          title: 'BBB высокий ICE',
          impact: 9,
          confidence: 9,
          ease: 9,
          iceScore: 729,
        },
      ],
    });
    await page.goto('/app/hypotheses');
    const table = page.getByTestId('hyp-ice-table');
    const rows = table.locator('tbody tr');
    // Default sort: ICE descending.
    await expect(rows).toContainText(['BBB высокий ICE', 'AAA низкий ICE']);
    await table.getByRole('button', { name: 'ICE' }).click();
    await expect(rows).toContainText(['AAA низкий ICE', 'BBB высокий ICE']);
  });
});

test.describe('«→ гипотеза» deep link (ANA-24)', () => {
  test('click → prefilled editor → save → the hypothesis lands in the kanban', async ({ page }) => {
    await mockWorkspace(page);
    await openEditorFromOverview(page);

    const editor = page.getByTestId('hypothesis-editor');
    await expect(editor).toBeVisible();
    // Segment and evidence from the weak spot are prefilled…
    const subject = page.locator('#hyp-subject');
    const title = page.locator('#hyp-title');
    await expect(subject).not.toHaveValue('');
    await expect(title).not.toHaveValue('');
    await expect(editor.getByText('Доказательства', { exact: false })).toBeVisible();
    // …and the URL carried the seed (no /report detour, nothing lost).
    await expect(page).toHaveURL(/\/app\/hypotheses/);

    // Fill the remaining required fields.
    await page.locator('#hyp-action').fill('сократим форму до одного шага');
    await page.locator('#hyp-solution').fill('одноэкранная регистрация');
    await page.locator('#hyp-condition').fill('CR вырастет до 5%');
    // Assumptions: one prefilled (Поведение) — add Рынок + Технологии.
    const addBtns = editor.getByRole('button', { name: 'Добавить' });
    await addBtns.nth(0).click();
    await addBtns.nth(0).click();
    const catSelects = editor.getByRole('combobox', { name: 'Категория допущения' });
    await catSelects.nth(1).selectOption({ label: 'Рынок' });
    await catSelects.nth(2).selectOption({ label: 'Технологии' });
    const assumptionInputs = editor.getByRole('textbox', { name: 'Текст допущения' });
    await assumptionInputs.nth(1).fill('конкуренты уже упростили форму');
    await assumptionInputs.nth(2).fill('форма переиспользуется с лендинга');
    // Validation methods: two distinct types.
    await addBtns.nth(1).click();
    await addBtns.nth(1).click();
    const typeSelects = editor.getByRole('combobox', { name: 'Тип метода' });
    await typeSelects.nth(1).selectOption({ label: 'Синтетика' });
    const planInputs = editor.getByRole('textbox', { name: 'План проверки' });
    await planInputs.nth(0).fill('A/B-тест формы');
    await planInputs.nth(1).fill('5 интервью с пользователями');
    // ICE rationales + traffic light.
    await page.locator('#hyp-impactRationale').fill('много визитов с низкой конверсией');
    await page.locator('#hyp-confidenceRationale').fill('данные Метрики подтверждают');
    await page.locator('#hyp-easeRationale').fill('готовый компонент формы');
    await page.locator('#hyp-greenCriteria').fill('CR ≥ 5% за 2 недели');
    await page.locator('#hyp-yellowCriteria').fill('CR 3–5%');
    await page.locator('#hyp-redCriteria').fill('CR < 3%');

    await expect(page.getByTestId('hyp-save')).toBeEnabled();
    await page.getByTestId('hyp-save').click();
    await expect(editor).toHaveCount(0);

    // The saved hypothesis appears in the kanban backlog and the ICE table.
    const backlog = page.getByRole('region', { name: 'Бэклог' });
    await expect(backlog.getByTestId('hyp-card-100')).toBeVisible();
    await expect(page.getByTestId('hyp-ice-table')).toContainText('низкая конверсия');
  });
});

test.describe('Decision Log (ANA-37)', () => {
  test('list + create a decision linked to a hypothesis', async ({ page }) => {
    await mockWorkspace(page, { hypotheses: [SEEDED_HYPOTHESIS] });
    await page.goto('/app/decisions');
    await expect(page.getByText('Пока нет решений')).toBeVisible();

    await page.getByTestId('dec-new').click();
    const editor = page.getByTestId('decision-editor');
    await expect(editor).toBeVisible();
    await page.locator('#dec-hypothesis').selectOption({ label: '#100 Гипотеза про подкаст' });
    await page.locator('#dec-scope').fill('канал: подкаст');
    await editor.getByRole('textbox', { name: 'Вывод' }).fill('CR вырос с 2.9% до 5.4%');
    await editor.getByRole('textbox', { name: 'Цитата / цифра' }).fill('CR 5.4% при 420 визитах');
    await editor.getByRole('textbox', { name: 'Источник' }).fill('Метрика, срез 01–14 января');
    await page.locator('#dec-rationale').fill('критерий зелёного света достигнут');
    await page.locator('#dec-next').fill('масштабируем форму на остальные каналы');
    // «Кто решил» prefilled from the session user.
    await expect(page.locator('#dec-by')).toHaveValue('Analyst');

    await expect(page.getByTestId('dec-save')).toBeEnabled();
    await page.getByTestId('dec-save').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId('dec-list')).toContainText('DL-001');
    await expect(page.getByTestId('dec-list')).toContainText('Гипотеза про подкаст');
    await expect(page.getByTestId('dec-list')).toContainText('Подтверждено');
  });
});
