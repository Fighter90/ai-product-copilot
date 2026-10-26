import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChannelStat, B2bDeal } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

vi.mock('../lib/api', () => ({
  api: {
    channels: vi.fn(),
    b2b: vi.fn(),
    geoDevice: vi.fn().mockResolvedValue([]),
    pages: vi.fn().mockResolvedValue([]),
  },
}));
import { api } from '../lib/api';
import { FunnelView, Funnel } from './funnel';

beforeAll(() => {
  window.innerWidth = 1280;
  window.dispatchEvent(new Event('resize'));
});
afterAll(() => {
  window.innerWidth = 1024;
  window.dispatchEvent(new Event('resize'));
});

const stats: ChannelStat[] = [
  {
    date: '2025-01-01',
    channel: 'podcast',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    visits: 1000,
    users: 900,
    bounceRate: 0.2,
    avgDuration: 60,
    goalReaches: 100,
    conversionRate: 0.1,
  },
];
const deals: B2bDeal[] = [
  { id: 1, company: 'Acme', tickets: 30, stage: 'paid', dateAdded: '2025-01-01' },
];

describe('FunnelView', () => {
  it('renders the loading state', () => {
    render(<FunnelView status="pending" stats={[]} deals={[]} geoDevice={[]} pages={[]} />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  it('renders the error state', () => {
    render(<FunnelView status="error" stats={[]} deals={[]} geoDevice={[]} pages={[]} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders empty state when no data is available', () => {
    render(<FunnelView status="success" stats={[]} deals={[]} geoDevice={[]} pages={[]} />);
    expect(screen.getByText(/Нет данных за выбранный период/)).toBeInTheDocument();
  });

  it('renders the funnel stages + chart on success', () => {
    render(<FunnelView status="success" stats={stats} deals={deals} geoDevice={[]} pages={[]} />);
    expect(screen.getByText('Визитов')).toBeInTheDocument();
    expect(screen.getByText('Оплачено B2B')).toBeInTheDocument();
    // Multiple charts now: funnel, channel CR, geo
    expect(screen.getAllByTestId('echart').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Funnel (wrapper)', () => {
  beforeEach(() => {
    vi.mocked(api.channels).mockResolvedValue(stats);
    vi.mocked(api.b2b).mockResolvedValue(deals);
  });

  it('loads channel + B2B data and renders the funnel', async () => {
    renderWithProviders(<Funnel />);
    expect(await screen.findByText('Воронка конверсии')).toBeInTheDocument();
    expect(screen.getByText('Визитов')).toBeInTheDocument();
  });

  it('shows the error state when a query fails', async () => {
    vi.mocked(api.b2b).mockRejectedValue(new Error('boom'));
    renderWithProviders(<Funnel />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('FunnelView (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  const allStages: B2bDeal[] = [
    { id: 1, company: 'Acme', tickets: 30, stage: 'paid', dateAdded: '2025-01-01' },
    { id: 2, company: 'Beta', tickets: 10, stage: 'lead', dateAdded: '2025-01-01' },
    { id: 3, company: 'Gamma', tickets: 5, stage: 'negotiation', dateAdded: '2025-01-01' },
    { id: 4, company: 'Delta', tickets: 5, stage: 'invoiced', dateAdded: '2025-01-01' },
  ];

  it('renders cards, insights, stages, problem pages and recommendations without Cyrillic', () => {
    setTestLocale('en');
    const { container } = render(
      <FunnelView
        status="success"
        stats={[{ ...stats[0]!, goalReaches: 5, conversionRate: 0.005 }]}
        deals={allStages}
        geoDevice={[
          {
            date: '2025-01-01',
            country: 'Germany',
            device: 'desktop',
            visits: 100,
            users: 90,
            goalReaches: 3,
            conversionRate: 0.03,
          },
        ]}
        pages={[
          {
            date: '2025-01-01',
            page: '/lp',
            visits: 200,
            users: 180,
            bounceRate: 0.6,
            goalReaches: 0,
            conversionRate: 0,
          },
        ]}
      />,
    );
    expect(screen.getByText('Conversion funnel')).toBeInTheDocument();
    expect(screen.getByText('B2B deals by stage')).toBeInTheDocument();
    expect(screen.getByText('Invoiced')).toBeInTheDocument();
    expect(screen.getByText(/Application\/visit CR 0.5% — low/)).toBeInTheDocument();
    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expectNoCyrillic(container);
  });

  it('renders the no-B2B branch in English', () => {
    setTestLocale('en');
    const { container } = render(
      <FunnelView status="success" stats={stats} deals={[]} geoDevice={[]} pages={[]} />,
    );
    expect(screen.getByText(/No B2B deals/)).toBeInTheDocument();
    expect(screen.getByText(/No pages with a critical bounce rate/)).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
