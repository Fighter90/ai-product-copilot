import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PageStat } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

vi.mock('../lib/api', () => ({ api: { pages: vi.fn(), exitPages: vi.fn() } }));
import { api } from '../lib/api';
import { BehaviorView, Behavior } from './behavior';

const pages = api.pages as unknown as ReturnType<typeof vi.fn>;
const exitPages = api.exitPages as unknown as ReturnType<typeof vi.fn>;

const page = (over: Partial<PageStat>): PageStat => ({
  date: '2025-01-01',
  page: '/lp',
  visits: 10,
  users: 9,
  bounceRate: 0.2,
  goalReaches: 1,
  conversionRate: 0.1,
  ...over,
});

beforeEach(() => {
  pages.mockReset();
  exitPages.mockReset();
});

describe('BehaviorView', () => {
  it('renders loading and error states', () => {
    const { rerender } = render(<BehaviorView status="pending" entry={[]} exit={[]} />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
    rerender(<BehaviorView status="error" entry={[]} exit={[]} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an empty state when there are no pages', () => {
    render(<BehaviorView status="success" entry={[]} exit={[]} />);
    expect(screen.getByText(/Нет данных за выбранный период/)).toBeInTheDocument();
  });

  it('renders the entry + exit page tables on success', () => {
    render(
      <BehaviorView
        status="success"
        entry={[page({ page: '/lp' })]}
        exit={[page({ page: '/checkout' })]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Страницы входа' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Страницы выхода' })).toBeInTheDocument();
    expect(screen.getByText('/lp')).toBeInTheDocument();
    expect(screen.getByText('/checkout')).toBeInTheDocument();
    // 3 charts: CR bar, bounce bar, exit bounce bar
    expect(screen.getAllByTestId('echart')).toHaveLength(3);
  });

  it('БАГ-08: «Средние» and the exit summary bounce are visit-weighted, not a plain row mean', () => {
    const rows = [
      page({ page: '/big', visits: 900, users: 800, bounceRate: 0.2, goalReaches: 30 }),
      page({ page: '/tiny', visits: 90, users: 80, bounceRate: 1, goalReaches: 0 }),
    ];
    render(<BehaviorView status="success" entry={rows} exit={rows} />);
    // Weighted bounce = (900×0.2 + 90×1)/990 ≈ 27.3%; the plain row mean would be 60%.
    // CR = Σreaches/Σvisits = 30/990 ≈ 3.0%; the plain row mean would be 1.7%.
    const averages = screen.getAllByText(
      'Средние: отказы 27.3% · CR 3.0% · Страницы отсортированы по визитам',
    );
    expect(averages.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/60\.0%/)).not.toBeInTheDocument();
    // «средний отказ» in the exit-pages summary card is the same weighted figure.
    expect(
      screen.getByText('2 страниц выхода · 990 визитов · средний отказ 27.3%'),
    ).toBeInTheDocument();
  });
});

describe('Behavior (data wrapper)', () => {
  it('renders both tables after the queries resolve', async () => {
    pages.mockResolvedValue([page({ page: '/lp' })]);
    exitPages.mockResolvedValue([page({ page: '/checkout' })]);
    renderWithProviders(<Behavior />);
    expect(await screen.findByRole('heading', { name: 'Страницы входа' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Страницы выхода' })).toBeInTheDocument();
  });
});

describe('BehaviorView (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders cards, insights, tables and recommendations without Cyrillic', () => {
    setTestLocale('en');
    const { container } = render(
      <BehaviorView
        status="success"
        entry={[
          page({
            page: '/lp',
            visits: 400,
            bounceRate: 0.6,
            goalReaches: 1,
            conversionRate: 0.0025,
          }),
          page({
            page: '/tickets',
            visits: 200,
            bounceRate: 0.1,
            goalReaches: 20,
            conversionRate: 0.1,
          }),
        ]}
        exit={[page({ page: '/checkout', visits: 50, bounceRate: 0.5 })]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Entry pages' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exit pages' })).toBeInTheDocument();
    expect(screen.getByText(/High bounce 60.0% on \/lp/)).toBeInTheDocument();
    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expectNoCyrillic(container);
  });

  it('keeps loading/error/empty states in English', () => {
    setTestLocale('en');
    const { container, rerender } = render(<BehaviorView status="pending" entry={[]} exit={[]} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    rerender(<BehaviorView status="error" entry={[]} exit={[]} />);
    expectNoCyrillic(container);
    rerender(<BehaviorView status="success" entry={[]} exit={[]} />);
    expect(screen.getByText(/No data for the selected period/)).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
