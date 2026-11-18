import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { B2bDeal } from '@pca/shared';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { renderWithProviders } from '../test/utils';
import { B2bView, B2b } from './b2b';
import { api } from '../lib/api';
import { B2B_STAGES } from '../lib/b2b';

// ANA-164: the container tests go through the real query/mutation glue, so the api module
// is mocked at the boundary (the B2bView tests below stay pure and ignore this mock).
vi.mock('../lib/api', () => ({
  api: {
    b2b: vi.fn(),
    createB2b: vi.fn(),
    updateB2bStage: vi.fn(),
    updateB2bAmount: vi.fn(),
    removeB2b: vi.fn(),
  },
}));

const deals: B2bDeal[] = [
  {
    id: 1,
    company: 'BigCorp',
    tickets: 20,
    stage: 'paid',
    dateAdded: '2025-01-01',
    amountRub: 100000,
    contactEmail: 'ceo@bigcorp.com',
    notes: 'подписать договор',
  },
  { id: 2, company: 'SmallCo', tickets: 15, stage: 'lead', dateAdded: '2025-01-02' },
];

/** EN fixture — latin-only data so expectNoCyrillic covers the kanban rendering too. */
const enDeals: B2bDeal[] = [
  {
    id: 1,
    company: 'BigCorp',
    tickets: 20,
    stage: 'paid',
    dateAdded: '2025-01-01',
    amountRub: 100000,
    contactEmail: 'ceo@bigcorp.com',
    notes: 'sign the contract',
  },
  { id: 2, company: 'SmallCo', tickets: 15, stage: 'lead', dateAdded: '2025-01-02' },
];

const handlers = () => ({
  onAdd: vi.fn(),
  onStageChange: vi.fn(),
  onAmountChange: vi.fn(),
  onRemove: vi.fn(),
});

/** Minimal DataTransfer stub: drag events in jsdom carry no dataTransfer. */
const dt = (id?: number | string) => ({
  setData: vi.fn(),
  effectAllowed: 'move',
  dropEffect: 'move',
  getData: () => (id === undefined ? '' : String(id)),
});

describe('B2bView', () => {
  afterEach(() => setTestLocale('ru'));

  it('ANA-164: shows the kanban by default — all 4 stage columns with pipeline totals', () => {
    render(<B2bView deals={deals} {...handlers()} />);
    expect(screen.getByTestId('b2b-kanban')).toBeInTheDocument();
    for (const s of B2B_STAGES) {
      expect(screen.getByTestId(`b2b-col-${s}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('b2b-col-paid-tickets')).toHaveTextContent('20 билетов');
    expect(screen.getByText(/Всего билетов в пайплайне/)).toBeInTheDocument();
    // The full table is NOT rendered until the switcher asks for it.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('ANA-187: kanban card company names hyphenate long words instead of breaking mid-word', () => {
    // Регресс 16.11 (тёмная тема): длинные RU-слова рвались посреди слова без переноса.
    render(<B2bView deals={deals} {...handlers()} />);
    const card = screen.getByTestId('b2b-card-1');
    const company = card.querySelector('span.break-words');
    expect(company).not.toBeNull();
    expect(company?.className).toContain('hyphens-auto');
  });

  it('ANA-164: deal cards show company, contact, amount, date and next step', () => {
    render(<B2bView deals={deals} {...handlers()} />);
    const card = screen.getByTestId('b2b-card-1');
    expect(card).toHaveTextContent('BigCorp');
    expect(card).toHaveTextContent('ceo@bigcorp.com');
    expect(card).toHaveTextContent('100 000 ₽');
    expect(card).toHaveTextContent('Следующий шаг');
    expect(card).toHaveTextContent('подписать договор');
    expect(card.textContent).toMatch(/2025/);
    expect(screen.getByTestId('b2b-card-2')).toHaveTextContent('SmallCo');
  });

  it('ANA-164: column headers carry counters — deals count, tickets and ₽ sums', () => {
    render(<B2bView deals={deals} {...handlers()} />);
    expect(screen.getByTestId('b2b-col-paid-count')).toHaveTextContent('1');
    expect(screen.getByTestId('b2b-col-paid-tickets')).toHaveTextContent('20 билетов');
    expect(screen.getByTestId('b2b-col-paid-amount')).toHaveTextContent('100 000 ₽');
    expect(screen.getByTestId('b2b-col-lead-count')).toHaveTextContent('1');
    // Anti-hallucination: a stage where no deal carries an amount shows no ₽ counter at all.
    expect(screen.queryByTestId('b2b-col-lead-amount')).not.toBeInTheDocument();
  });

  it('ANA-164: dropping a card on another stage column calls onStageChange', () => {
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    fireEvent.dragStart(screen.getByTestId('b2b-card-2'), { dataTransfer: dt(2) });
    fireEvent.drop(screen.getByTestId('b2b-col-paid'), { dataTransfer: dt(2) });
    expect(h.onStageChange).toHaveBeenCalledWith({ id: 2, stage: 'paid' });
  });

  it('ANA-164: drop onto the same column, empty or unknown card id is a no-op', () => {
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    fireEvent.dragStart(screen.getByTestId('b2b-card-2'), { dataTransfer: dt(2) });
    fireEvent.drop(screen.getByTestId('b2b-col-lead'), { dataTransfer: dt(2) });
    fireEvent.drop(screen.getByTestId('b2b-col-paid'), { dataTransfer: dt() });
    fireEvent.drop(screen.getByTestId('b2b-col-paid'), { dataTransfer: dt(999) });
    expect(h.onStageChange).not.toHaveBeenCalled();
  });

  it('ANA-164: a garbage drop payload (non-integer) is a no-op', () => {
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    // 'abc' → NaN, '12.5' → not an integer: neither resolves to a card id.
    fireEvent.drop(screen.getByTestId('b2b-col-paid'), { dataTransfer: dt('abc') });
    fireEvent.drop(screen.getByTestId('b2b-col-paid'), { dataTransfer: dt('12.5') });
    expect(h.onStageChange).not.toHaveBeenCalled();
  });

  it('ANA-164: a deal cleared to amountRub: null shows no invented ₽ anywhere', () => {
    // The clear-PATCH round-trips null (the e2e fixture merges it into the GET state): the
    // card must drop its amount line and the column must hide the ₽ counter (absence ≠ 0 ₽).
    const cleared: B2bDeal[] = [{ ...deals[0]!, amountRub: null as unknown as number }, deals[1]!];
    render(<B2bView deals={cleared} {...handlers()} />);
    const card = screen.getByTestId('b2b-card-1');
    expect(card).toHaveTextContent('BigCorp');
    expect(card).not.toHaveTextContent('0 ₽');
    expect(screen.queryByTestId('b2b-col-paid-amount')).not.toBeInTheDocument();
  });

  it('ANA-164: mobile 390 — the board scrolls horizontally inside its container (Trello-style)', () => {
    render(<B2bView deals={deals} {...handlers()} />);
    // jsdom computes no layout; the 390px fit is asserted as a styling contract here.
    // The real layout check lives in e2e/mobile.spec.ts (/app/b2b, no page overflow).
    expect(screen.getByTestId('b2b-kanban')).toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('b2b-col-lead')).toHaveClass('min-w-[16rem]', 'shrink-0');
  });

  it('ANA-164: the «Канбан / Таблица» switcher swaps the views', () => {
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Таблица' }));
    expect(screen.getByTestId('b2b-table')).toBeInTheDocument();
    expect(screen.queryByTestId('b2b-kanban')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Канбан' }));
    expect(screen.getByTestId('b2b-kanban')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('adds a deal from the form', () => {
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    fireEvent.change(screen.getByLabelText('Компания'), { target: { value: 'NewCo' } });
    fireEvent.change(screen.getByLabelText('Билеты'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(h.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'NewCo', tickets: 5, stage: 'lead' }),
    );
  });

  it('renders the kanban and the full table without Cyrillic in EN', async () => {
    setTestLocale('en');
    const h = handlers();
    render(<B2bView deals={enDeals} {...h} />);
    expect(screen.getByTestId('b2b-col-paid-tickets')).toHaveTextContent('20 tickets');
    expect(screen.getByTestId('b2b-card-1')).toHaveTextContent('Next step');
    expect(screen.getByTestId('b2b-card-1')).toHaveTextContent('sign the contract');
    expectNoCyrillic(document.body);

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByTestId('b2b-table')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stage SmallCo'), { target: { value: 'invoiced' } });
    expect(h.onStageChange).toHaveBeenCalledWith({ id: 2, stage: 'invoiced' });
    // БАГ-03 + ANA-120: удаление — через styled ConfirmDialog, не window.confirm().
    const confirmSpy = vi.spyOn(window, 'confirm');
    fireEvent.click(screen.getByRole('button', { name: 'Delete BigCorp' }));
    // The styled dialog names the deal and its tickets; the native confirm is never called.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByTestId('confirm-body')).toHaveTextContent(
      'Delete the deal “BigCorp” (20 tickets)?',
    );
    // Accept removes the deal.
    fireEvent.click(screen.getByTestId('confirm-accept'));
    expect(h.onRemove).toHaveBeenCalledWith(1);
    expectNoCyrillic(document.body);
  });

  it('ANA-120: deal removal asks via the styled ConfirmDialog (not window.confirm)', () => {
    const h = handlers();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<B2bView deals={deals} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Таблица' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить BigCorp' }));
    // The styled dialog names the deal and its tickets; the native confirm is never called.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-body')).toHaveTextContent(
      'Удалить сделку «BigCorp» (20 билетов)?',
    );
    // Cancel keeps the deal.
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(h.onRemove).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-body')).not.toBeInTheDocument();
    // Accept removes the deal.
    fireEvent.click(screen.getByRole('button', { name: 'Удалить BigCorp' }));
    fireEvent.click(screen.getByTestId('confirm-accept'));
    expect(h.onRemove).toHaveBeenCalledWith(1);
    confirmSpy.mockRestore();
  });

  it('adds a deal with an amount and edits the amount inline (ANA-50)', () => {
    const h = handlers();
    const withAmounts: B2bDeal[] = [
      { ...deals[0]!, amountRub: 100000 },
      { ...deals[1]!, amountRub: 200000 },
    ];
    render(<B2bView deals={withAmounts} {...h} />);
    // The create form accepts an optional ₽ amount.
    fireEvent.change(screen.getByLabelText('Компания'), { target: { value: 'RichCo' } });
    fireEvent.change(screen.getByLabelText('Билеты'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Сумма, ₽'), { target: { value: '350000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(h.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'RichCo', tickets: 7, amountRub: 350000 }),
    );

    // Inline edit in the table view: commits on blur, empty input clears (null).
    fireEvent.click(screen.getByRole('button', { name: 'Таблица' }));
    const amountInput = screen.getByLabelText('Сумма сделки: BigCorp');
    fireEvent.change(amountInput, { target: { value: '500000' } });
    fireEvent.blur(amountInput);
    expect(h.onAmountChange).toHaveBeenCalledWith({ id: 1, amountRub: 500000 });

    const clear = screen.getByLabelText('Сумма сделки: SmallCo');
    fireEvent.change(clear, { target: { value: '' } });
    fireEvent.blur(clear);
    expect(h.onAmountChange).toHaveBeenCalledWith({ id: 2, amountRub: null });
  });
});

/**
 * ANA-119 (регресс 28.10, БАГ-03): прямые кейсы валидации формы B2B — отклоняются пустая
 * компания и билеты ≤ 0 (и не-целые): ошибка формы видна (role=alert), сохранение не уходит.
 */
describe('B2bView — БАГ-03: отклонение невалидной сделки', () => {
  afterEach(() => setTestLocale('ru'));

  it('rejects a blank company — alert is shown, the save is not sent', () => {
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    fireEvent.change(screen.getByLabelText('Компания'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Билеты'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите компанию');
    expect(h.onAdd).not.toHaveBeenCalled();
  });

  it.each(['0', '-5', '2.5'])(
    'rejects tickets = %s — alert is shown, the save is not sent',
    (raw) => {
      const h = handlers();
      render(<B2bView deals={deals} {...h} />);
      fireEvent.change(screen.getByLabelText('Компания'), { target: { value: 'NewCo' } });
      fireEvent.change(screen.getByLabelText('Билеты'), { target: { value: raw } });
      fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Билетов: целое число не меньше 1');
      expect(h.onAdd).not.toHaveBeenCalled();
    },
  );

  it('shows the validation alert through i18n in EN too', () => {
    setTestLocale('en');
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Tickets'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    // First visible error is the company one (checked before tickets).
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the company name');
    expect(h.onAdd).not.toHaveBeenCalled();
  });

  it('after a rejected submit a valid submit goes through and clears the alert', () => {
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    fireEvent.change(screen.getByLabelText('Компания'), { target: { value: 'NewCo' } });
    fireEvent.change(screen.getByLabelText('Билеты'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(h.onAdd).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Билеты'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(h.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'NewCo', tickets: 3, stage: 'lead' }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * ANA-164: the container owns the optimistic kanban drop — while the PATCH is in flight the
 * card already sits in the target column; on failure it rolls back and the user is told.
 */
describe('B2b container — optimistic kanban drop (ANA-164)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    setTestLocale('ru');
  });

  const dropCard2OnPaid = async (): Promise<void> => {
    vi.mocked(api.b2b).mockResolvedValue(deals);
    renderWithProviders(<B2b />, '/app/b2b');
    await screen.findByTestId('b2b-card-2');
    fireEvent.dragStart(screen.getByTestId('b2b-card-2'), { dataTransfer: dt(2) });
    fireEvent.drop(screen.getByTestId('b2b-col-paid'), { dataTransfer: dt(2) });
  };

  it('drop sends the PATCH with the target stage and moves the card optimistically', async () => {
    vi.mocked(api.updateB2bStage).mockImplementation(() => new Promise(() => {})); // pending
    await dropCard2OnPaid();
    // Optimistic UI: the card lands in the target column while the PATCH is in flight
    // (the mutation runs asynchronously, so the move is awaited rather than synchronous).
    await waitFor(() => {
      expect(
        within(screen.getByTestId('b2b-col-paid')).getByTestId('b2b-card-2'),
      ).toBeInTheDocument();
    });
    expect(
      within(screen.getByTestId('b2b-col-lead')).queryByTestId('b2b-card-2'),
    ).not.toBeInTheDocument();
    // API check: the drop triggered the stage PATCH (v5 passes the mutation context as 2nd arg).
    expect(api.updateB2bStage).toHaveBeenCalledWith({ id: 2, stage: 'paid' }, expect.anything());
  });

  it('a failed PATCH rolls the card back and explains itself inline (no window.alert)', async () => {
    vi.mocked(api.updateB2bStage).mockRejectedValue(new Error('boom'));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await dropCard2OnPaid();
    expect(
      await waitFor(() => within(screen.getByTestId('b2b-col-lead')).getByTestId('b2b-card-2')),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('b2b-col-paid')).queryByTestId('b2b-card-2'),
    ).not.toBeInTheDocument();
    // Inline styled error names the reason — the native alert is never called
    // (the БАГ-03 / ANA-120 convention this file documents).
    expect(await screen.findByTestId('b2b-stage-error')).toHaveTextContent(
      'Не удалось изменить этап сделки: boom',
    );
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('a non-Error PATCH failure explains itself inline too', async () => {
    vi.mocked(api.updateB2bStage).mockRejectedValue('boom-string');
    await dropCard2OnPaid();
    expect(await screen.findByTestId('b2b-stage-error')).toHaveTextContent(
      'Не удалось изменить этап сделки: boom-string',
    );
  });

  it('a new drop clears the inline error and succeeds', async () => {
    vi.mocked(api.updateB2bStage).mockRejectedValueOnce(new Error('boom'));
    await dropCard2OnPaid();
    expect(await screen.findByTestId('b2b-stage-error')).toBeInTheDocument();
    // Retry: the same card dropped onto «paid» again — the new attempt clears the error…
    vi.mocked(api.updateB2bStage).mockResolvedValue({ ...deals[1]!, stage: 'paid' });
    fireEvent.drop(screen.getByTestId('b2b-col-paid'), { dataTransfer: dt(2) });
    await waitFor(() => {
      expect(screen.queryByTestId('b2b-stage-error')).not.toBeInTheDocument();
    });
  });
});
