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
    status: 'in_progress',
    source: 'ai',
    aiProvider: 'openrouter',
    aiModel: 'claude-sonnet-4-6',
    unverifiedNumbers: ['5123'],
  }),
];

/** ANA-129: a light draft — only the title, everything else blank. */
const LIGHT_DRAFT: Partial<Hypothesis> = {
  subject: '',
  action: '',
  solution: '',
  condition: '',
  hiddenAssumptions: [],
  validationMethods: [],
  impactRationale: '',
  confidenceRationale: '',
  easeRationale: '',
  greenCriteria: '',
  yellowCriteria: '',
  redCriteria: '',
};

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

  it('renders the kanban columns with ICE, the AI badge and the unverified-numbers warning', async () => {
    const { container } = renderWithProviders(<Hypotheses />, '/app/hypotheses');
    expect(await screen.findByTestId('hyp-kanban')).toBeInTheDocument();
    for (const col of [
      'Черновики',
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

  it('sorts the ICE table descending by default and flips on header click; drafts stay out (ANA-129)', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const table = await screen.findByTestId('hyp-ice-table');
    // AAA is a draft (status draft) — it never enters the ICE prioritisation table.
    expect(table.textContent).toContain('BBB высокий');
    expect(table.textContent).not.toContain('AAA низкий');
    expect(table.querySelector('th[aria-sort="descending"]')).not.toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'ICE' })[0]!);
    await waitFor(() => expect(table.querySelector('th[aria-sort="ascending"]')).not.toBeNull());
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

  it('ANA-129: creates a light draft in two clicks — only the title is required', async () => {
    vi.mocked(hypothesesApi.create).mockResolvedValue(SEEDED[0]!);
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click(await screen.findByTestId('hyp-new')); // click 1 — open the editor
    const save = await screen.findByTestId('hyp-save');
    // Blank title still blocks the save; format errors are not shown for a draft.
    expect(save).toBeDisabled();
    expect(screen.getByTestId('hypothesis-editor')).toHaveTextContent('Черновик: достаточно');
    expect(screen.queryByText('Нужно минимум 3 допущения')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Быстрая идея' } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save); // click 2 — save the draft
    await waitFor(() =>
      expect(hypothesesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Быстрая идея',
          subject: '',
          hiddenAssumptions: [],
          validationMethods: [],
        }),
      ),
    );
  }, 45_000);

  it('ANA-129: taking an incomplete draft into work shows the format checklist and blocks the move', async () => {
    vi.mocked(hypothesesApi.setStatus).mockResolvedValue(SEEDED[0]!);
    mockData({ list: [h({ id: 7, title: 'DDD черновик', ...LIGHT_DRAFT })] });
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const select = await screen.findByRole('combobox', { name: 'Изменить статус' });
    fireEvent.change(select, { target: { value: 'in_progress' } });

    const dialog = await screen.findByTestId('hyp-work-checklist');
    expect(screen.getByRole('heading', { name: 'Чеклист формата' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('≥3 скрытых допущения');
    expect(dialog).toHaveTextContent('≥2 метода проверки');
    // The transition is blocked while the checklist is open — no API call.
    expect(hypothesesApi.setStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    expect(screen.queryByTestId('hyp-work-checklist')).not.toBeInTheDocument();
    expect(hypothesesApi.setStatus).not.toHaveBeenCalled();
  });

  it('ANA-129: a complete draft moves to «В проверке» without the checklist', async () => {
    vi.mocked(hypothesesApi.setStatus).mockResolvedValue(SEEDED[0]!);
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    const select = (await screen.findAllByRole('combobox', { name: 'Изменить статус' }))[0]!;
    fireEvent.change(select, { target: { value: 'in_progress' } });
    await waitFor(() => expect(hypothesesApi.setStatus).toHaveBeenCalledWith(1, 'in_progress'));
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

  it('БАГ-14: the editor hides «Заполните поле» until a field is touched (draft: title only)', async () => {
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click(await screen.findByTestId('hyp-new'));
    await waitFor(() => expect(screen.getByTestId('hyp-save')).toBeDisabled());
    expect(screen.queryByText('Заполните поле')).not.toBeInTheDocument();

    // Touching an OPTIONAL field reveals only the title error — no format-error wall (ANA-129).
    fireEvent.change(screen.getByLabelText('Целевая аудитория'), { target: { value: 'x' } });
    expect(screen.getByText('Заполните поле')).toBeInTheDocument(); // exactly one — the title
    expect(screen.queryByText('Нужно минимум 3 допущения')).not.toBeInTheDocument();
  });

  it('БАГ-15 removal-UX: delete asks via the styled ConfirmDialog (not window.confirm)', async () => {
    vi.mocked(hypothesesApi.remove).mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderWithProviders(<Hypotheses />, '/app/hypotheses');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Удалить' }))[0]!);
    // The styled dialog names the hypothesis; the native confirm is never called.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByTestId('confirm-body')).toHaveTextContent(
      'Удалить гипотезу «AAA низкий»?',
    );
    // Cancel keeps the card.
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(hypothesesApi.remove).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-body')).not.toBeInTheDocument();
    // Accept deletes.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Удалить' }))[0]!);
    fireEvent.click(await screen.findByTestId('confirm-accept'));
    await waitFor(() => expect(hypothesesApi.remove).toHaveBeenCalledWith(1));
    confirmSpy.mockRestore();
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
