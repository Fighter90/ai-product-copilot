import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DataGrid, type GridColumn } from './DataGrid';
import { renderWithProviders } from '../test/utils';
import { setTestLocale } from '../test/i18n-utils';

interface Row {
  page: string;
  visits: number;
  bounce: number;
}

const rows: Row[] = [
  { page: '/', visits: 90, bounce: 20 },
  { page: '/lp', visits: 10, bounce: 100 },
];

const cols = (weight: boolean): GridColumn<Row>[] => [
  { id: 'page', header: 'Страница', accessor: (r) => r.page },
  { id: 'visits', header: 'Визиты', kind: 'int', total: 'sum', accessor: (r) => r.visits },
  {
    id: 'bounce',
    header: 'Отказы',
    kind: 'pct',
    total: 'avg',
    // БАГ-08: weighted by visits — (90×20 + 10×100)/100 = 28, not the plain mean 60.
    weightOf: weight ? (r) => r.visits : undefined,
    accessor: (r) => r.bounce,
  },
];

const totalsText = (): string => {
  const foot = document.querySelector('tfoot');
  expect(foot).not.toBeNull();
  return within(foot as HTMLElement).getByRole('row').textContent ?? '';
};

describe('DataGrid totals (БАГ-08 — взвешенное «Итого»)', () => {
  beforeEach(() => setTestLocale('ru'));
  afterEach(() => setTestLocale('ru'));

  it('averages rates visit-weighted when weightOf is given', () => {
    renderWithProviders(<DataGrid columns={cols(true)} rows={rows} fileName="t" />);
    const foot = totalsText();
    expect(foot).toContain('100'); // Σvisits
    expect(foot).toContain('28,00%');
    expect(foot).not.toContain('60,00%'); // the plain row mean
  });

  it('keeps the plain mean when no weightOf is given (backward compatible)', () => {
    renderWithProviders(<DataGrid columns={cols(false)} rows={rows} fileName="t" />);
    expect(totalsText()).toContain('60,00%');
  });

  it('falls back to the plain mean when all weights are 0', () => {
    const zero = rows.map((r) => ({ ...r, visits: 0 }));
    renderWithProviders(<DataGrid columns={cols(true)} rows={zero} fileName="t" />);
    expect(totalsText()).toContain('60,00%');
  });

  it('renders no totals row when no column declares a total', () => {
    render(
      <DataGrid
        columns={[{ id: 'page', header: 'Страница', accessor: (r) => r.page }]}
        rows={rows}
        fileName="t"
      />,
    );
    expect(screen.queryByText('Итого')).not.toBeInTheDocument();
    expect(document.querySelector('tfoot')).toBeNull();
  });
});
