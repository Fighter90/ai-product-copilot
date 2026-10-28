import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Hypothesis } from '@pca/shared';
import { renderWithProviders } from '../../test/utils';
import { setTestLocale } from '../../test/i18n-utils';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Analyst' }, isAdmin: false }),
}));
vi.mock('../../lib/hypotheses-api', () => ({
  hypothesesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setStatus: vi.fn(),
    importAi: vi.fn(),
  },
  decisionsApi: { list: vi.fn(), create: vi.fn() },
}));
vi.mock('../../lib/api', () => ({
  api: { listSnapshots: vi.fn(), getSnapshot: vi.fn() },
}));

import { hypothesesApi } from '../../lib/hypotheses-api';
import { api } from '../../lib/api';
import { Hypotheses } from './Hypotheses';

const h = (over: Partial<Hypothesis>): Hypothesis =>
  ({
    id: 1,
    diamondPhase: 'develop',
    kind: 'solution',
    subject: 'Подкаст',
    action: 'сократим форму',
    solution: 'один шаг',
    condition: 'CR вырастет',
    title: 'Гипотеза A',
    hiddenAssumptions: [
      { category: 'behavior', text: 'a' },
      { category: 'market', text: 'b' },
      { category: 'tech', text: 'c' },
    ],
    validationMethods: [
      { type: 'quantitative', plan: 'A/B' },
      { type: 'synthetic', plan: 'интервью' },
    ],
    impact: 5,
    confidence: 5,
    ease: 5,
    impactRationale: 'i',
    confidenceRationale: 'c',
    easeRationale: 'e',
    greenCriteria: 'g',
    yellowCriteria: 'y',
    redCriteria: 'r',
    deadlineDays: 14,
    iceScore: 125,
    status: 'draft',
    deadlineAt: '2026-11-10T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  }) as Hypothesis;

const SEEDED: Hypothesis[] = [
  h({ id: 1, title: 'AAA низкий', impact: 1, confidence: 1, ease: 1, iceScore: 1 }),
  h({
    id: 2,
    title: 'BBB высокий',
    impact: 9,
    confidence: 9,
    ease: 9,
    iceScore: 729,
    source: 'ai',
    aiProvider: 'openrouter',
    aiModel: 'claude-sonnet-4-6',
    unverifiedNumbers: ['5123'],
  }),
];

function mockData({ list = SEEDED, snapshot }: { list?: Hypothesis[]; snapshot?: unknown } = {}) {
  vi.mocked(hypothesesApi.list).mockResolvedValue(list);
  vi.mocked(api.listSnapshots).mockResolvedValue(
    snapshot ? [{ id: 'snap-1', generatedAt: '', dateFrom: '', dateTo: '' }] : [],
  );
  vi.mocked(api.getSnapshot).mockResolvedValue(snapshot as never);
}

describe('Hypotheses page', () => {
  beforeEach(() => mockData());
  afterEach(() => setTestLocale('ru'));

  it.skip('renders the kanban columns with ICE, the AI badge and the unverified-numbers warning', async () => {
    const { container } = renderWithProviders(<Hypotheses />, '/app/hypotheses');
    expect(await screen.findByTestId('hyp-kanban')).toBeInTheDocument();
    for (const col of [
      'Бэклог',
      'В проверке',
      'Подтверждена',
      'Частично',
      'Отклонена',
      'Просрочена',
    ]) {
      expect(screen.getByRole('region', { name: col })).toBeInTheDocument();
    }
    expect(screen.getByTestId('hyp-card-2')).toHaveTextContent('BBB высокий');
    expect(screen.getByTestId('hyp-card-2')).toHaveTextContent('729');
    expect(screen.getAllByText('AI').length).toBeGreaterThan(0); // source badges on kanban cards
    expect(screen.getAllByText(/цифры не из среза/).length).toBeGreaterThan(0); // ANA-38 warning badges
    expect(container).toBeTruthy();
  });

  it('sorts the ICE table descending by default and flips on header click', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const table = await screen.findByTestId('hyp-ice-table');
    expect(table.textContent).toMatch(/BBB высокий[\s\S]*AAA низкий/);
    expect(table.querySelector('th[aria-sort="descending"]')).not.toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'ICE' })[0]!);
    await waitFor(() => expect(table.querySelector('th[aria-sort="ascending"]')).not.toBeNull());
    expect(table.textContent).toMatch(/AAA низкий[\s\S]*BBB высокий/);
  });

  it('ANA-24: opens the editor prefilled from the ?segment&evidence deep link', async () => {
    renderWithProviders(
      <Hypotheses />,
      '/app/hypotheses?segment=%D0%9F%D0%BE%D0%B4%D0%BA%D0%B0%D1%81%D1%82&evidence=CR+0%2C7%25',
    );
    const editor = await screen.findByTestId('hypothesis-editor');
    expect((screen.getByLabelText('Целевая аудитория') as HTMLInputElement).value).toBe('Подкаст');
    expect(editor).toHaveTextContent('Доказательства');
    expect(editor).toHaveTextContent('CR 0,7%');
  });

  it.skip('refuses to save an incomplete draft (per-field errors) and creates a valid one — FLAKY: editor opens intermittently; доводится в ANA-37', async () => {
    vi.mocked(hypothesesApi.create).mockResolvedValue(SEEDED[0]!);
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click(await screen.findByTestId('hyp-new'));

    await waitFor(() => expect(screen.getByTestId('hyp-save')).toBeDisabled());
    expect(screen.getAllByText('Заполните поле').length).toBeGreaterThan(0);
    expect(screen.getByText('Нужно минимум 3 допущения')).toBeInTheDocument();
    expect(screen.getByText('Нужно минимум 2 метода проверки')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Целевая аудитория'), { target: { value: 'Подкаст' } });
    fireEvent.change(screen.getByLabelText('Действие'), { target: { value: 'упростим форму' } });
    fireEvent.change(screen.getByLabelText('Решение'), { target: { value: 'один шаг' } });
    fireEvent.change(screen.getByLabelText('Условие'), { target: { value: 'CR вырастет' } });
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Тест' } });
    // 3 assumptions across all categories.
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getAllByRole('button', { name: 'Добавить' })[0]!);
    }
    const cats = screen.getAllByLabelText('Категория допущения');
    fireEvent.change(cats[1]!, { target: { value: 'market' } });
    fireEvent.change(cats[2]!, { target: { value: 'tech' } });
    const texts = screen.getAllByLabelText('Текст допущения');
    texts.forEach((el, i) => fireEvent.change(el, { target: { value: `допущение ${i}` } }));
    // 2 methods of distinct types.
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить' })[1]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить' })[1]!);
    const plans = screen.getAllByLabelText('План проверки');
    fireEvent.change(plans[0]!, { target: { value: 'A/B-тест' } });
    fireEvent.change(plans[1]!, { target: { value: 'интервью' } });
    fireEvent.change(screen.getByLabelText('Обоснование', { selector: '#hyp-impactRationale' }), {
      target: { value: 'i' },
    });
    fireEvent.change(
      screen.getByLabelText('Обоснование', { selector: '#hyp-confidenceRationale' }),
      {
        target: { value: 'c' },
      },
    );
    fireEvent.change(screen.getByLabelText('Обоснование', { selector: '#hyp-easeRationale' }), {
      target: { value: 'e' },
    });
    fireEvent.change(screen.getByLabelText('🟢 Зелёный'), { target: { value: 'g' } });
    fireEvent.change(screen.getByLabelText('🟡 Жёлтый'), { target: { value: 'y' } });
    fireEvent.change(screen.getByLabelText('🔴 Красный'), { target: { value: 'r' } });

    await waitFor(() => expect(screen.getByTestId('hyp-save')).toBeEnabled());
    fireEvent.click(screen.getByTestId('hyp-save'));

    await waitFor(() =>
      expect(hypothesesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Подкаст', title: 'Тест' }),
      ),
    );
  });

  it('БАГ-15: shows «Просрочена» as its own kanban column, separate from «Отклонена»', async () => {
    mockData({ list: [h({ id: 3, title: 'CCC просроченная', status: 'expired' })] });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    expect(await screen.findByTestId('hyp-kanban')).toBeInTheDocument();
    const expired = screen.getByRole('region', { name: 'Просрочена' });
    const rejected = screen.getByRole('region', { name: 'Отклонена' });
    expect(expired).toHaveTextContent('CCC просроченная');
    expect(rejected).toHaveTextContent('— пусто —');
  });

  it('БАГ-14: the editor hides «Заполните поле» until a field is touched', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click(await screen.findByTestId('hyp-new'));
    await waitFor(() => expect(screen.getByTestId('hyp-save')).toBeDisabled());
    expect(screen.queryByText('Заполните поле')).not.toBeInTheDocument();

    // First input anywhere reveals the remaining per-field errors.
    fireEvent.change(screen.getByLabelText('Целевая аудитория'), { target: { value: 'x' } });
    expect(screen.getAllByText('Заполните поле').length).toBeGreaterThan(0);
  });

  it('moves a card via the status select (ANA-37 kanban)', async () => {
    vi.mocked(hypothesesApi.setStatus).mockResolvedValue(SEEDED[0]!);
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const select = (await screen.findAllByRole('combobox', { name: 'Изменить статус' }))[0]!;
    fireEvent.change(select, { target: { value: 'in_progress' } });
    await waitFor(() => expect(hypothesesApi.setStatus).toHaveBeenCalledWith(1, 'in_progress'));
  });

  it('deletes after confirm', async () => {
    vi.mocked(hypothesesApi.remove).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Удалить' }))[0]!);
    await waitFor(() => expect(hypothesesApi.remove).toHaveBeenCalledWith(1));
    vi.restoreAllMocks();
  });

  it('ANA-38: imports an AI hypothesis from the latest snapshot with provenance', async () => {
    vi.mocked(hypothesesApi.importAi).mockResolvedValue(SEEDED[0]!);
    mockData({
      snapshot: {
        id: 'snap-1',
        generatedHypotheses: {
          problems: [
            {
              id: 'P01',
              segment: 'слушатель',
              trouble: 'не понимает цену',
              action: 'оставить заявку',
              barrier: 'длинная форма',
              evidence: 'CR 0,7%',
              unverifiedNumbers: [],
            },
          ],
          solutions: [
            {
              id: 'S01',
              problemId: 'P01',
              action: 'короткая форма',
              userBenefit: 'регистрация за 1 шаг',
              businessResult: 'CR +30%',
              successCriteria: 'CR ≥ 5%',
              risks: [{ kind: 'value', note: 'r' }],
              validation: {
                whatToVerify: 'спрос',
                methods: ['интервью', 'клик-тест'],
                audience: 'слушатели',
                channel: 'email',
                successCriteria: '≥10%',
              },
              ice: {
                impact: 7,
                confidence: 5,
                ease: 8,
                impactRationale: 'i',
                confidenceRationale: 'c',
                easeRationale: 'e',
                score: 280,
              },
              trafficLight: { green: 'g', yellow: 'y', red: 'r' },
              deadline: '2026-12-01',
              unverifiedNumbers: ['5123'],
            },
          ],
          meta: { provider: 'openrouter', model: 'claude-sonnet-4-6' },
        },
      },
    });

    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const list = await screen.findByTestId('hyp-ai-list');
    expect(list).toHaveTextContent('короткая форма');
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать' }));
    await waitFor(() =>
      expect(hypothesesApi.importAi).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openrouter',
          model: 'claude-sonnet-4-6',
          snapshotId: 'snap-1',
          solution: expect.objectContaining({ id: 'S01' }),
          problem: expect.objectContaining({ id: 'P01' }),
        }),
      ),
    );
  });
});
