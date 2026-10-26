import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { B2bDeal } from '@pca/shared';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { B2bView } from './b2b';

const deals: B2bDeal[] = [
  { id: 1, company: 'BigCorp', tickets: 20, stage: 'paid', dateAdded: '2025-01-01' },
  { id: 2, company: 'SmallCo', tickets: 15, stage: 'lead', dateAdded: '2025-01-02' },
];

const handlers = () => ({ onAdd: vi.fn(), onStageChange: vi.fn(), onRemove: vi.fn() });

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

  it('renders the page and the full table without Cyrillic in EN', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete BigCorp' }));
    expect(h.onRemove).toHaveBeenCalledWith(1);
    expectNoCyrillic(document.body);
  });
});
