import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AUTONOMY_LEVEL_LABELS, AUTONOMY_MATRIX, DECISION_STATUSES } from '@pca/shared';
import type { AutonomyMatrixResponse, Decision, DecisionListItem, Hypothesis } from '@pca/shared';
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
  decisionsApi: { list: vi.fn(), create: vi.fn(), setStatus: vi.fn(), autonomyMatrix: vi.fn() },
}));

import { decisionsApi, hypothesesApi } from '../../lib/hypotheses-api';
import { Decisions } from './Decisions';

const HYPOTHESIS = {
  id: 100,
  title: 'Гипотеза про подкаст',
  status: 'in_progress',
} as Hypothesis;

const DECISION: Decision = {
  id: 1,
  number: 'DL-001',
  hypothesisId: 100,
  date: '2026-01-15',
  decision: 'масштабируем подкаст',
  status: 'accepted',
  method: 'quantitative',
  scope: 'канал: подкаст',
  periodDays: 14,
  findings: [{ text: 'CR вырос', confidence: 'high' }],
  evidence: [{ quote: 'CR 5.4%', source: 'Метрика' }],
  outcome: 'green',
  outcomeRationale: 'критерий достигнут',
  nextStep: 'масштабируем',
  decidedBy: 'Analyst',
  createdAt: '2026-01-15T00:00:00.000Z',
  updatedAt: '2026-01-15T00:00:00.000Z',
};

/** Minimal DataTransfer stub: drag events in jsdom carry no dataTransfer (b2b pattern). */
const dt = (id?: number | string) => ({
  setData: vi.fn(),
  effectAllowed: 'move',
  dropEffect: 'move',
  getData: () => (id === undefined ? '' : String(id)),
});

/** The list view is behind the switcher since ANA-169 — kanban is the default view. */
async function openListView(): Promise<HTMLElement> {
  // The switcher exists only after the skeleton (the query has resolved).
  fireEvent.click(await screen.findByTestId('dec-view-list'));
  return screen.findByTestId('dec-list');
}

describe('Decisions page (Decision Log)', () => {
  afterEach(() => setTestLocale('ru'));

  it('lists decisions with the number, outcome and linked hypothesis title', async () => {
    const rejected = { ...DECISION, id: 7, number: 'DL-007', status: 'rejected' as const };
    vi.mocked(decisionsApi.list).mockResolvedValue([DECISION, rejected]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const list = await openListView();
    expect(list).toHaveTextContent('DL-001');
    expect(list).toHaveTextContent('Подтверждено');
    expect(list).toHaveTextContent('Принято');
    expect(list).toHaveTextContent('масштабируем подкаст');
    expect(list).toHaveTextContent('Гипотеза про подкаст');
    expect(list).toHaveTextContent('критерий достигнут');
    // ANA-169: the lane pill renders next to the outcome светофор (rejected → red tone).
    expect(list).toHaveTextContent('DL-007');
    expect(list).toHaveTextContent('Отклонено');
  });

  it('shows the empty state when there are no decisions', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([]);
    renderWithProviders(<Decisions />, '/app/decisions');
    expect(await screen.findByText(/Пока нет решений/)).toBeInTheDocument();
  });

  it('creates a decision linked to a hypothesis (formulation + evidence required)', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    vi.mocked(decisionsApi.create).mockResolvedValue(DECISION);
    renderWithProviders(<Decisions />, '/app/decisions');

    fireEvent.click(await screen.findByTestId('dec-new'));
    const editor = await screen.findByTestId('decision-editor');
    // Blank form → save disabled, and «Заполните поле» errors stay hidden until the user
    // touches a field (БАГ-14 dirty tracking).
    await waitFor(() => expect(screen.getByTestId('dec-save')).toBeDisabled());
    expect(
      screen.queryByText('Нужно минимум одно доказательство (цитата + источник)'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Заполните поле')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Гипотеза'), { target: { value: '100' } });
    // After the first input the remaining per-field errors become visible — including the
    // formulation «что делаем» (ANA-169).
    expect(
      screen.getByText('Нужно минимум одно доказательство (цитата + источник)'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Гипотеза'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Решение (что делаем)'), {
      target: { value: 'масштабируем подкаст' },
    });
    fireEvent.change(screen.getByLabelText('Разрез'), { target: { value: 'канал: подкаст' } });
    // ANA-189-feedback: выводы необязательны — решение сохраняется без них.
    fireEvent.change(screen.getByLabelText('Цитата / цифра'), { target: { value: 'CR 5.4%' } });
    fireEvent.change(screen.getByLabelText('Источник'), { target: { value: 'Метрика' } });
    fireEvent.change(screen.getByLabelText('Обоснование исхода'), {
      target: { value: 'критерий достигнут' },
    });
    fireEvent.change(screen.getByLabelText('Следующий шаг'), { target: { value: 'масштабируем' } });
    // «Кто решил» is prefilled from the session user.
    expect((screen.getByLabelText('Кто решил') as HTMLInputElement).value).toBe('Analyst');

    await waitFor(() => expect(screen.getByTestId('dec-save')).toBeEnabled());
    fireEvent.click(screen.getByTestId('dec-save'));
    // eslint-disable-next-line no-console
    console.log('AFTER-SAVE:', JSON.stringify(vi.mocked(decisionsApi.create).mock.calls));

    await waitFor(() =>
      expect(decisionsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          hypothesisId: 100,
          decision: 'масштабируем подкаст',
          outcome: 'green',
          decidedBy: 'Analyst',
          evidence: [{ quote: 'CR 5.4%', source: 'Метрика' }],
          findings: [],
        }),
      ),
    );
    expect(editor).not.toBeInTheDocument();
  });

      it('ANA-189-feedback: findings are optional — a filled row is included, an empty one is dropped', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    vi.mocked(decisionsApi.create).mockResolvedValue(DECISION);
    renderWithProviders(<Decisions />, '/app/decisions');

    fireEvent.click(await screen.findByTestId('dec-new'));
    await screen.findByTestId('decision-editor');

    fireEvent.change(screen.getByLabelText('Гипотеза'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Решение (что делаем)'), {
      target: { value: 'масштабируем подкаст' },
    });
    fireEvent.change(screen.getByLabelText('Разрез'), { target: { value: 'канал: подкаст' } });
    fireEvent.change(screen.getByLabelText('Цитата / цифра'), { target: { value: 'CR 5.4%' } });
    fireEvent.change(screen.getByLabelText('Источник'), { target: { value: 'Метрика' } });
    fireEvent.change(screen.getByLabelText('Обоснование исхода'), {
      target: { value: 'критерий достигнут' },
    });
    fireEvent.change(screen.getByLabelText('Следующий шаг'), { target: { value: 'масштабируем' } });

    // Пустая строка выводов не блокирует Save и не уходит в API (findings необязательны).
    await waitFor(() => expect(screen.getByTestId('dec-save')).toBeEnabled());

    // Добавляем строку и заполняем только текст (селект уверенности остаётся дефолтным).
    const findingsLabel = screen.getByText('Выводы');
    const findingsSection = findingsLabel.parentElement ?? document.body;
    fireEvent.click(within(findingsSection).getByRole('button', { name: /Добавить/ }));
    const findingInput = screen.getAllByLabelText('Вывод')[0]!;
    fireEvent.change(findingInput, { target: { value: 'CR вырос' } });
    await waitFor(() => expect(findingInput).toHaveValue('CR вырос'));

    fireEvent.click(screen.getByTestId('dec-save'));
    await waitFor(() => expect(decisionsApi.create).toHaveBeenCalledTimes(1));
    expect(decisionsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        findings: [{ text: 'CR вырос', confidence: 'medium' }],
      }),
    );
  });



  it('marks an AI auto-populated draft with the AI badge and plain rows without it (ANA-128)', async () => {
    const aiDraft: Decision = { ...DECISION, id: 2, number: 'DL-002', source: 'ai' };
    vi.mocked(decisionsApi.list).mockResolvedValue([DECISION, aiDraft]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const list = await openListView();
    // Exactly one AI badge — only for the source: 'ai' draft (the manual row renders none).
    const badges = within(list).getAllByText('AI');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.closest('li')).toHaveTextContent('DL-002');
  });
});

describe('Decisions autonomy badges + matrix (ANA-138)', () => {
  afterEach(() => setTestLocale('ru'));

  const MATRIX: AutonomyMatrixResponse = {
    required: 'A1',
    levels: AUTONOMY_LEVEL_LABELS,
    matrix: AUTONOMY_MATRIX,
  };

  const row = (list: HTMLElement, number: string): HTMLElement => {
    const li = within(list)
      .getAllByRole('listitem')
      .find((el) => el.textContent?.includes(number));
    expect(li, `row ${number}`).toBeDefined();
    return li!;
  };

  it('shows type, level and PM-escalation badges on an escalated AI decision (ANA-138)', async () => {
    // `pricing` has max A0 but the required level is A1 → escalation with a machine-readable
    // reason the UI localizes; the manual row next to it carries no autonomy badges at all.
    const escalated: DecisionListItem = {
      ...DECISION,
      id: 3,
      number: 'DL-003',
      source: 'ai',
      decisionType: 'pricing',
      autonomy: {
        type: 'pricing',
        unclassified: false,
        maxAutonomy: 'A0',
        required: 'A1',
        escalation: { required: true, reason: 'autonomy-exceeded' },
      },
    };
    vi.mocked(decisionsApi.list).mockResolvedValue([DECISION, escalated]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const list = await openListView();
    const escRow = row(list, 'DL-003');
    expect(within(escRow).getByText('Ценообразование')).toBeInTheDocument();
    expect(within(escRow).getByText('A1')).toBeInTheDocument();
    const escBadge = within(escRow).getByText('⚠️ Требует PM-эскалации');
    expect(escBadge).toHaveAttribute('title', expect.stringContaining('решение за PM'));

    // The manual row (DL-001) shows none of the autonomy badges.
    const manualRow = row(list, 'DL-001');
    expect(within(manualRow).queryByText('Ценообразование')).not.toBeInTheDocument();
    expect(within(manualRow).queryByText('⚠️ Требует PM-эскалации')).not.toBeInTheDocument();
  });

  it('localizes the unclassified-type reason on an AI row without a type (ANA-138)', async () => {
    // Legacy wave without the backfill / a future unclassifiable draft: the API assessed it
    // conservatively as `strategic` (A0) with reason `unclassified-type` — the badge shows
    // the localized reason text, not the raw code.
    const unclassified: DecisionListItem = {
      ...DECISION,
      id: 4,
      number: 'DL-004',
      source: 'ai',
      autonomy: {
        type: 'strategic',
        unclassified: true,
        maxAutonomy: 'A0',
        required: 'A1',
        escalation: { required: true, reason: 'unclassified-type' },
      },
    };
    vi.mocked(decisionsApi.list).mockResolvedValue([unclassified]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const list = await openListView();
    const escBadge = within(row(list, 'DL-004')).getByText('⚠️ Требует PM-эскалации');
    expect(escBadge).toHaveAttribute('title', expect.stringContaining('Тип решения не распознан'));
  });

  it('shows no escalation badge when the type allows the required level (ANA-138)', async () => {
    const draft: DecisionListItem = {
      ...DECISION,
      id: 5,
      number: 'DL-005',
      source: 'ai',
      decisionType: 'hypothesis-draft',
      autonomy: {
        type: 'hypothesis-draft',
        unclassified: false,
        maxAutonomy: 'A1',
        required: 'A1',
        escalation: { required: false, reason: null },
      },
    };
    vi.mocked(decisionsApi.list).mockResolvedValue([draft]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const list = await openListView();
    const draftRow = row(list, 'DL-005');
    expect(within(draftRow).getByText('Черновик гипотезы')).toBeInTheDocument();
    expect(within(draftRow).queryByText('⚠️ Требует PM-эскалации')).not.toBeInTheDocument();
  });

  it('renders the autonomy matrix from GET /api/decisions/autonomy-matrix (ANA-138)', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([]);
    vi.mocked(decisionsApi.autonomyMatrix).mockResolvedValue(MATRIX);
    renderWithProviders(<Decisions />, '/app/decisions');

    const table = await screen.findByTestId('autonomy-matrix');
    // One row per decision type, in taxonomy order.
    const typeCells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((tr) => (tr as HTMLTableRowElement).cells[0]!.textContent);
    expect(typeCells).toEqual([
      'Анализ данных',
      'Черновик гипотезы',
      'Запуск эксперимента',
      'Ценообразование',
      'Бюджет',
      'Публичные коммуникации',
      'Стратегия',
      'Юридическое решение',
    ]);
    // The escalation rule is derived from the served matrix: A2/A1 types are fine at A1,
    // every A0 type escalates to PM.
    const pricingRow = within(table)
      .getAllByRole('row')
      .find((tr) => tr.textContent?.includes('Ценообразование'));
    expect(pricingRow).toHaveTextContent('A0');
    expect(pricingRow).toHaveTextContent('⚠️ Эскалация к PM');
    const dataRow = within(table)
      .getAllByRole('row')
      .find((tr) => tr.textContent?.includes('Анализ данных'));
    expect(dataRow).toHaveTextContent('A2');
    expect(dataRow).toHaveTextContent('Без эскалации');
  });

  it('keeps the matrix table inside a horizontal-scroll container so 390px never overflows the page (ANA-138)', () => {
    // ANA-135 regression-guard pattern: jsdom cannot measure layout, so the structural
    // guarantee is that the table sits in an overflow-x-auto wrapper — page-level
    // horizontal scroll becomes impossible at a 390px viewport.
    vi.mocked(decisionsApi.list).mockResolvedValue([]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([]);
    vi.mocked(decisionsApi.autonomyMatrix).mockResolvedValue(MATRIX);
    renderWithProviders(<Decisions />, '/app/decisions');

    return screen
      .findByTestId('autonomy-matrix')
      .then((table) => expect(table.closest('.overflow-x-auto')).not.toBeNull());
  });

  it('shows the badges and matrix in the en locale too (ANA-138)', async () => {
    setTestLocale('en');
    const escalated: DecisionListItem = {
      ...DECISION,
      id: 6,
      number: 'DL-006',
      source: 'ai',
      decisionType: 'pricing',
      autonomy: {
        type: 'pricing',
        unclassified: false,
        maxAutonomy: 'A0',
        required: 'A1',
        escalation: { required: true, reason: 'autonomy-exceeded' },
      },
    };
    vi.mocked(decisionsApi.list).mockResolvedValue([escalated]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    vi.mocked(decisionsApi.autonomyMatrix).mockResolvedValue(MATRIX);
    renderWithProviders(<Decisions />, '/app/decisions');

    const list = await openListView();
    expect(within(row(list, 'DL-006')).getByText('Pricing')).toBeInTheDocument();
    expect(within(row(list, 'DL-006')).getByText('⚠️ Needs PM escalation')).toBeInTheDocument();
    expect(await screen.findByTestId('autonomy-matrix')).toHaveTextContent('Escalation rule');
    expect(screen.getByTestId('autonomy-matrix')).toHaveTextContent('No escalation');
  });
});

describe('Decisions kanban (ANA-169)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => setTestLocale('ru'));

  /** Seed: one accepted manual decision + one deferred one. */
  const seeded = (over: Partial<Decision> & Pick<Decision, 'id' | 'status'>): Decision => ({
    ...DECISION,
    ...over,
  });

  it('renders the kanban by default — one lane per workflow status with counters', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([
      seeded({ id: 1, status: 'accepted' }),
      seeded({ id: 2, status: 'in_progress', number: 'DL-002' }),
      seeded({ id: 3, status: 'deferred', number: 'DL-003' }),
      seeded({ id: 4, status: 'rejected', number: 'DL-004' }),
    ]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const board = await screen.findByTestId('dec-kanban');
    for (const status of DECISION_STATUSES) {
      expect(screen.getByTestId(`dec-col-${status}`)).toBeInTheDocument();
    }
    // Every card sits in its own lane with the formulation, hypothesis, date and author.
    const accepted = screen.getByTestId('dec-col-accepted');
    const card = within(accepted).getByTestId('dec-card-1');
    expect(card).toHaveTextContent('масштабируем подкаст');
    expect(card).toHaveTextContent('Гипотеза про подкаст');
    expect(card).toHaveTextContent('Кто решил: Analyst');
    expect(card).toHaveTextContent('DL-001');
    expect(
      within(screen.getByTestId('dec-col-in_progress')).getByTestId('dec-card-2'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('dec-col-deferred')).getByTestId('dec-card-3'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('dec-col-rejected')).getByTestId('dec-card-4'),
    ).toBeInTheDocument();
    // Lane counters.
    expect(screen.getByTestId('dec-col-accepted-count')).toHaveTextContent('1');
    expect(screen.getByTestId('dec-col-rejected-count')).toHaveTextContent('1');
    // The list is NOT rendered until the switcher asks for it.
    expect(screen.queryByTestId('dec-list')).not.toBeInTheDocument();
    expect(board).toBeInTheDocument();
  });

  it('drag-and-drop to another lane patches the decision status (ANA-169)', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([seeded({ id: 1, status: 'accepted' })]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    vi.mocked(decisionsApi.setStatus).mockResolvedValue({ ...DECISION, status: 'in_progress' });
    renderWithProviders(<Decisions />, '/app/decisions');

    await screen.findByTestId('dec-kanban');
    fireEvent.dragStart(screen.getByTestId('dec-card-1'), { dataTransfer: dt(1) });
    fireEvent.drop(screen.getByTestId('dec-col-in_progress'), { dataTransfer: dt(1) });
    await waitFor(() => expect(decisionsApi.setStatus).toHaveBeenCalledWith(1, 'in_progress'));
  });

  it('ignores empty/garbage drop payloads and same-lane drops (ANA-169)', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([seeded({ id: 1, status: 'accepted' })]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    await screen.findByTestId('dec-kanban');
    fireEvent.dragStart(screen.getByTestId('dec-card-1'), { dataTransfer: dt(1) });
    // No payload → no move.
    fireEvent.drop(screen.getByTestId('dec-col-deferred'), { dataTransfer: dt() });
    // Garbage payload → no move.
    fireEvent.drop(screen.getByTestId('dec-col-deferred'), { dataTransfer: dt('abc') });
    // Same lane → no move.
    fireEvent.drop(screen.getByTestId('dec-col-accepted'), { dataTransfer: dt(1) });
    expect(decisionsApi.setStatus).not.toHaveBeenCalled();
  });

  it('the switcher toggles between kanban and the original list view (ANA-169)', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([DECISION]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    expect(await screen.findByTestId('dec-kanban')).toBeInTheDocument();
    expect(screen.queryByTestId('dec-list')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dec-view-list'));
    expect(await screen.findByTestId('dec-list')).toBeInTheDocument();
    expect(screen.queryByTestId('dec-kanban')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dec-view-kanban'));
    expect(await screen.findByTestId('dec-kanban')).toBeInTheDocument();
    expect(screen.queryByTestId('dec-list')).not.toBeInTheDocument();
  });

  it('keeps the board inside a horizontal-scroll container so 390px never overflows the page (ANA-169)', async () => {
    // ANA-135 regression-guard pattern: jsdom cannot measure layout, so the structural
    // guarantee is that the board sits in an overflow-x-auto wrapper and each lane keeps a
    // fixed min width on mobile — the page itself never scrolls horizontally.
    vi.mocked(decisionsApi.list).mockResolvedValue([DECISION]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const board = await screen.findByTestId('dec-kanban');
    expect(board).toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('dec-col-accepted')).toHaveClass('min-w-[16rem]');
  });

  it('shows the kanban lanes in the en locale too (ANA-169)', async () => {
    setTestLocale('en');
    vi.mocked(decisionsApi.list).mockResolvedValue([seeded({ id: 1, status: 'deferred' })]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    expect(await screen.findByTestId('dec-kanban')).toBeInTheDocument();
    expect(screen.getByTestId('dec-col-deferred')).toHaveTextContent('Deferred');
    expect(screen.getByTestId('dec-col-accepted')).toHaveTextContent('Accepted');
    expect(screen.getByTestId('dec-view-list')).toHaveTextContent('List');
  });
});
