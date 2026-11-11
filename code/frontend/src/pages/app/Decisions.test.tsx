import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Decision, Hypothesis } from '@pca/shared';
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

describe('Decisions page (Decision Log)', () => {
  afterEach(() => setTestLocale('ru'));

  it('lists decisions with the number, outcome and linked hypothesis title', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([DECISION]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const list = await screen.findByTestId('dec-list');
    expect(list).toHaveTextContent('DL-001');
    expect(list).toHaveTextContent('Подтверждено');
    expect(list).toHaveTextContent('Гипотеза про подкаст');
    expect(list).toHaveTextContent('критерий достигнут');
  });

  it('shows the empty state when there are no decisions', async () => {
    vi.mocked(decisionsApi.list).mockResolvedValue([]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([]);
    renderWithProviders(<Decisions />, '/app/decisions');
    expect(await screen.findByText(/Пока нет решений/)).toBeInTheDocument();
  });

  it('creates a decision linked to a hypothesis (validates evidence first)', async () => {
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
    // After the first input the remaining per-field errors become visible.
    expect(
      screen.getByText('Нужно минимум одно доказательство (цитата + источник)'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Гипотеза'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Разрез'), { target: { value: 'канал: подкаст' } });
    fireEvent.change(screen.getAllByLabelText('Вывод')[0]!, { target: { value: 'CR вырос' } });
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

    await waitFor(() =>
      expect(decisionsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          hypothesisId: 100,
          outcome: 'green',
          decidedBy: 'Analyst',
          evidence: [{ quote: 'CR 5.4%', source: 'Метрика' }],
        }),
      ),
    );
    expect(editor).not.toBeInTheDocument();
  });

  it('marks an AI auto-populated draft with the AI badge and plain rows without it (ANA-128)', async () => {
    const aiDraft: Decision = { ...DECISION, id: 2, number: 'DL-002', source: 'ai' };
    vi.mocked(decisionsApi.list).mockResolvedValue([DECISION, aiDraft]);
    vi.mocked(hypothesesApi.list).mockResolvedValue([HYPOTHESIS]);
    renderWithProviders(<Decisions />, '/app/decisions');

    const list = await screen.findByTestId('dec-list');
    // Exactly one AI badge — only for the source: 'ai' draft (the manual row renders none).
    const badges = within(list).getAllByText('AI');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.closest('li')).toHaveTextContent('DL-002');
  });
});
