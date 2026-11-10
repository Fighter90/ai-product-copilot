import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { B2bDeal } from '@pca/shared';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { B2bView } from './b2b';

const deals: B2bDeal[] = [
  { id: 1, company: 'BigCorp', tickets: 20, stage: 'paid', dateAdded: '2025-01-01' },
  { id: 2, company: 'SmallCo', tickets: 15, stage: 'lead', dateAdded: '2025-01-02' },
];

const handlers = () => ({
  onAdd: vi.fn(),
  onStageChange: vi.fn(),
  onAmountChange: vi.fn(),
  onRemove: vi.fn(),
});

describe('B2bView', () => {
  afterEach(() => setTestLocale('ru'));

  it('shows localised stages and pipeline totals (RU)', () => {
    render(<B2bView deals={deals} {...handlers()} />);
    expect(screen.getAllByText('Оплачено').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Лид').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('20 билетов')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();
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

  it('renders the page and the full table without Cyrillic in EN', async () => {
    setTestLocale('en');
    const h = handlers();
    render(<B2bView deals={deals} {...h} />);
    expect(screen.getByText('20 tickets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expectNoCyrillic(document.body);

    fireEvent.click(screen.getByRole('button', { name: 'Expand full table (2)' }));
    expect(screen.getByText('B2B deals')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть полную таблицу (2)' }));
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
      {
        id: 1,
        company: 'BigCorp',
        tickets: 20,
        stage: 'paid',
        dateAdded: '2025-01-01',
        amountRub: 100000,
      },
      {
        id: 2,
        company: 'SmallCo',
        tickets: 15,
        stage: 'lead',
        dateAdded: '2025-01-02',
        amountRub: 200000,
      },
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

    // Inline edit in the full table: commits on blur, empty input clears (null).
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть полную таблицу (2)' }));
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
