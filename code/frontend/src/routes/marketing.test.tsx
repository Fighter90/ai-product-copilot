import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MarketingGrid } from '@pca/shared';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { MarketingView } from './marketing';

const grid: MarketingGrid = {
  months: [
    { key: '2026-08', ru: 'Август', en: 'August' },
    { key: '2026-09', ru: 'Сентябрь', en: 'September' },
  ],
  weeks: [
    {
      key: '2026-08-01',
      start: '2026-08-01',
      end: '2026-08-07',
      month: '2026-08',
      labelRu: '1 неделя (1-7)',
      labelEn: 'Week 1 (Aug 1-7)',
    },
    {
      key: '2026-08-08',
      start: '2026-08-08',
      end: '2026-08-14',
      month: '2026-08',
      labelRu: '2 неделя (8-14)',
      labelEn: 'Week 2 (Aug 8-14)',
    },
  ],
  sections: [
    { key: 'content', ru: 'Контент-маркетинг', en: 'Content marketing' },
    { key: 'influence', ru: 'Инфопартнёры', en: 'Influence partners' },
  ],
  metrics: [
    {
      key: 'landings_visits',
      ru: 'заходы на лендос (посетители)',
      en: 'Landing page visits',
      section: 'content',
      sync: true,
    },
    {
      key: 'tg_clicks',
      ru: 'переходы по ссылкам тг',
      en: 'Telegram link clicks',
      section: 'content',
      sync: false,
    },
  ],
  cells: [
    {
      weekStart: '2026-08-01',
      metricKey: 'landings_visits',
      value: 486,
      source: 'import',
      updatedAt: '2026-10-27T10:00:00.000Z',
      updatedBy: 'sheet-import',
    },
    {
      weekStart: '2026-08-08',
      metricKey: 'landings_visits',
      value: 531,
      source: 'manual',
      updatedAt: '2026-10-27T11:00:00.000Z',
      updatedBy: 'analyst@example.com',
    },
  ],
};

const handlers = () => ({ onCellSave: vi.fn(), onSync: vi.fn() });

describe('MarketingView', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders the sheet-shaped grid and the imported value (RU)', () => {
    render(<MarketingView grid={grid} isAdmin={false} {...handlers()} />);
    expect(screen.getByText('Август')).toBeInTheDocument();
    expect(screen.getByText('Контент-маркетинг')).toBeInTheDocument();
    expect(screen.getByText('заходы на лендос (посетители)')).toBeInTheDocument();
    // imported cell value is in the input
    expect(screen.getByDisplayValue('486')).toBeInTheDocument();
    expect(screen.getByDisplayValue('531')).toBeInTheDocument();
    // analyst (not admin) sees no sync button but the CSV link is there
    expect(screen.queryByRole('button', { name: 'Синхронизировать' })).not.toBeInTheDocument();
    expect(screen.getByText('CSV')).toBeInTheDocument();
  });

  it('saving a cell fires onCellSave with weekStart/metricKey/value', () => {
    const h = handlers();
    render(<MarketingView grid={grid} isAdmin={false} {...h} />);
    const input = screen.getByDisplayValue('531');
    fireEvent.change(input, { target: { value: '600' } });
    fireEvent.blur(input);
    expect(h.onCellSave).toHaveBeenCalledWith({
      weekStart: '2026-08-08',
      metricKey: 'landings_visits',
      value: 600,
    });
  });

  it('Escape cancels the draft without saving; non-numeric input does not save', () => {
    const h = handlers();
    render(<MarketingView grid={grid} isAdmin={false} {...h} />);
    const input = screen.getByDisplayValue('531');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(h.onCellSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '700' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('531')).toBeInTheDocument();
    expect(h.onCellSave).not.toHaveBeenCalled();
  });

  it('admin sees the sync button and fires onSync', () => {
    const h = handlers();
    render(<MarketingView grid={grid} isAdmin syncing={false} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Синхронизировать' }));
    expect(h.onSync).toHaveBeenCalled();
  });

  it('renders the page without Cyrillic in EN', () => {
    setTestLocale('en');
    render(
      <MarketingView grid={grid} isAdmin syncMessage="Done: 2 cells updated." {...handlers()} />,
    );
    expect(screen.getByText('August')).toBeInTheDocument();
    expect(screen.getByText('Content marketing')).toBeInTheDocument();
    expect(screen.getByText('Landing page visits')).toBeInTheDocument();
    expect(screen.getByText('Done: 2 cells updated.')).toBeInTheDocument();
    expectNoCyrillic(document.body);
  });
});
