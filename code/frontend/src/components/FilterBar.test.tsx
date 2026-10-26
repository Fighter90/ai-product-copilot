import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from './FilterBar';
import { useFilters } from '../store/filters';

const initial = useFilters.getState();
beforeEach(() => useFilters.setState(initial, true));

// UTC-базированные ISO-даты — тот же расчёт, что в store/filters (isoDaysAgo),
// чтобы ассерты не зависели от текущей даты и таймзоны CI.
const isoOffset = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const today = isoOffset(0);

const datesToggle = () =>
  screen.getByRole('button', { name: 'Выбрать произвольный период (макс. 365 дней)' });
const presetBtn = (days: number) =>
  screen.getByRole('button', {
    name:
      days === 365
        ? 'Показать данные за последний год'
        : `Показать данные за последние ${days} дней`,
  });
const applyBtn = () => screen.getByRole('button', { name: 'Применить' });

/** Open the custom picker and return its controls. */
function openPicker() {
  fireEvent.click(datesToggle());
  return {
    from: screen.getByLabelText('Дата начала периода'),
    to: screen.getByLabelText('Дата окончания периода'),
    apply: applyBtn(),
  };
}

describe('FilterBar', () => {
  it('applies preset, segment and archived toggle', () => {
    render(<FilterBar />);

    fireEvent.click(presetBtn(7));
    expect(useFilters.getState().from <= useFilters.getState().to).toBe(true);

    fireEvent.change(screen.getByLabelText('Сегмент'), { target: { value: 'b2b' } });
    expect(useFilters.getState().segment).toBe('b2b');

    fireEvent.click(screen.getByLabelText(/архивные/i));
    expect(useFilters.getState().showArchived).toBe(true);
  });

  it('shows the 1г (1 year) preset button', () => {
    render(<FilterBar />);
    expect(presetBtn(365)).toBeInTheDocument();
  });

  it('marks the active preset with aria-pressed (ANA-49)', () => {
    render(<FilterBar />);
    const p7 = presetBtn(7);
    const p14 = presetBtn(14);
    const p30 = presetBtn(30);

    // Default range (14 days) does not press 7д/30д.
    expect(p7).toHaveAttribute('aria-pressed', 'false');
    expect(p30).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(p7);
    expect(p7).toHaveAttribute('aria-pressed', 'true');
    expect(p14).toHaveAttribute('aria-pressed', 'false');
    expect(p30).toHaveAttribute('aria-pressed', 'false');
    // Store range matches the preset: last 7 days ending today.
    expect(useFilters.getState().from).toBe(isoOffset(-6));
    expect(useFilters.getState().to).toBe(today);
  });

  it('toggles custom date picker visibility with aria-expanded', () => {
    render(<FilterBar />);
    const toggle = datesToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Custom date picker is hidden initially
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Дата начала периода')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();
  });

  it('applies custom date range when valid', () => {
    render(<FilterBar />);
    const { from, to } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(-29) } });
    fireEvent.change(to, { target: { value: today } });
    fireEvent.click(applyBtn());
    expect(useFilters.getState().from).toBe(isoOffset(-29));
    expect(useFilters.getState().to).toBe(today);
    // The picker closes after applying
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();
  });

  it('treats a single-day range (from == to) as valid', () => {
    render(<FilterBar />);
    const { from, to, apply } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(-5) } });
    fireEvent.change(to, { target: { value: isoOffset(-5) } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(useFilters.getState().from).toBe(isoOffset(-5));
    expect(useFilters.getState().to).toBe(isoOffset(-5));
  });

  it('disables «Применить» when from > to and shows a hint (ANA-49)', () => {
    render(<FilterBar />);
    const { from, to, apply } = openPicker();
    fireEvent.change(from, { target: { value: '2025-06-15' } });
    fireEvent.change(to, { target: { value: '2025-06-10' } });

    expect(apply).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Дата окончания не может быть раньше даты начала.',
    );
    // Invalid range never reaches the store
    expect(useFilters.getState().from).not.toBe('2025-06-15');
  });

  it('disables «Применить» when from is in the future (ANA-49)', () => {
    render(<FilterBar />);
    const { from, to, apply } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(10) } });
    fireEvent.change(to, { target: { value: isoOffset(20) } });

    expect(apply).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Дата начала не может быть в будущем');
  });

  it('disables «Применить» when the range exceeds 365 days (ANA-49)', () => {
    render(<FilterBar />);
    const { from, apply } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(-400) } });

    expect(apply).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Максимальный период — 365 дней (1 год).');
  });

  it('disables «Применить» when a date is missing (ANA-49)', () => {
    render(<FilterBar />);
    const { from, apply } = openPicker();
    fireEvent.change(from, { target: { value: '' } });

    expect(apply).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите обе даты.');
  });

  it('updates the hint live when an invalid range is fixed (ANA-49)', () => {
    render(<FilterBar />);
    const { from, to, apply } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(-1) } });
    fireEvent.change(to, { target: { value: isoOffset(-5) } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(apply).toBeDisabled();

    // Fix the range — the error hint is replaced by the regular one
    fireEvent.change(to, { target: { value: isoOffset(-1) } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(apply).toBeEnabled();
    expect(screen.getByText('Макс. период: 365 дней (1 год)')).toBeInTheDocument();
  });

  it('closes the picker on Escape and returns focus to the toggle (ANA-49)', () => {
    render(<FilterBar />);
    const toggle = datesToggle();
    fireEvent.click(toggle);
    const from = screen.getByLabelText('Дата начала периода');
    fireEvent.keyDown(from, { key: 'Escape' });

    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('resets custom fields when a preset is chosen (ANA-49)', () => {
    render(<FilterBar />);
    const { from } = openPicker();
    fireEvent.change(from, { target: { value: '2020-01-01' } });

    // Preset wins over the (invalid) custom fields and closes the picker
    fireEvent.click(presetBtn(30));
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();

    // Reopening shows the applied preset range, not the stale custom input
    fireEvent.click(datesToggle());
    expect(screen.getByLabelText('Дата начала периода')).toHaveValue(useFilters.getState().from);
    expect(screen.getByLabelText('Дата окончания периода')).toHaveValue(useFilters.getState().to);
  });

  it('closes custom date picker on ✕ button click', () => {
    render(<FilterBar />);
    openPicker();
    expect(screen.getByLabelText('Дата начала периода')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();
  });

  it('opens the mobile filter sheet and closes it via «Готово»', () => {
    render(<FilterBar />);
    const trigger = screen.getByRole('button', { name: 'Фильтры' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'filter-controls');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByText('Готово'));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the mobile filter sheet via the backdrop', () => {
    render(<FilterBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));
    fireEvent.click(screen.getByLabelText('Закрыть фильтры'));
    expect(screen.getByRole('button', { name: 'Фильтры' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
