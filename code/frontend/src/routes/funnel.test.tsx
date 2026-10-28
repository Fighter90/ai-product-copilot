import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChannelStat, B2bDeal, PageStat } from '@pca/shared';
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
import type { LiveFunnel } from '../lib/api-v3';
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
    // The label appears on the KPI card and in the funnel stage list below the chart.
    expect(screen.getAllByText('Оплачено B2B').length).toBeGreaterThanOrEqual(1);
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

describe('FunnelView — problem pages (БАГ-07)', () => {
  it('collapses raw-URL duplicates of one page into a single aggregated line', () => {
    const dup = (over: Partial<PageStat>): PageStat => ({
      date: '2025-01-01',
      page: 'https://productcamp.ru/',
      visits: 100,
      users: 90,
      bounceRate: 0.5,
      goalReaches: 5,
      conversionRate: 0.05,
      ...over,
    });
    render(
      <FunnelView
        status="success"
        stats={stats}
        deals={deals}
        geoDevice={[]}
        pages={[
          // The same home page arrives 3× per day / raw URL with split numbers…
          dup({ date: '2025-01-01' }),
          dup({ date: '2025-01-02', page: 'https://productcamp.ru/?utm_source=tg' }),
          dup({ date: '2025-01-03', page: 'https://productcamp.ru/#top' }),
        ]}
      />,
    );
    // …and is listed once, with summed visits (300), under the normalized key.
    expect(screen.getAllByText('https://productcamp.ru — 50.0% при 300 визитах')).toHaveLength(1);
    expect(screen.queryByText(/при 100 визитах/)).not.toBeInTheDocument();
  });
});

describe('FunnelView — per-issue pc-goals funnel (ANA-21)', () => {
  const live = {
    from: '2025-01-01',
    to: '2025-01-14',
    updatedAt: '2025-01-15T00:00:00.000Z',
    stages: [
      { key: 'visits', ru: 'Визит', en: 'Visit', value: 2246, goalId: null, source: 'visits' },
      {
        key: 'reg_open',
        ru: 'Открыл регистрацию',
        en: 'Opened registration',
        value: 300,
        goalId: 1,
        source: 'goal',
      },
      {
        key: 'cart_open',
        ru: 'Открыл корзину',
        en: 'Opened cart',
        value: 80,
        goalId: 2,
        source: 'goal',
      },
      {
        key: 'reg_step1',
        ru: 'Оставил контакты',
        en: 'Left contacts',
        value: 27,
        goalId: 3,
        source: 'goal',
      },
      { key: 'payment', ru: 'Оплата', en: 'Payment', value: 0, goalId: null, source: 'none' },
    ],
    tickets: [],
    roles: [],
  } as unknown as LiveFunnel;

  it('renders every per-issue stage with absolute and % of the previous one', () => {
    render(
      <FunnelView
        status="success"
        stats={stats}
        deals={deals}
        geoDevice={[]}
        pages={[]}
        live={live}
      />,
    );
    const list = screen.getByRole('list', { name: 'Ступени воронки' });
    expect(list).toBeInTheDocument();
    expect(screen.getByText('Открыли регистрацию')).toBeInTheDocument();
    expect(screen.getByText('Открыли корзину')).toBeInTheDocument();
    // «Оплата» falls back to the manually paid B2B deals (30 tickets in `deals`)
    expect(screen.getByText('Оплата')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getAllByText('30').length).toBeGreaterThan(0);
  });

  it('shows the empty state inside the block when no funnel stage carries data', () => {
    const emptyLive = {
      ...live,
      stages: live.stages.map((s: { value: number }) => ({ ...s, value: 0 })),
    } as never;
    render(
      <FunnelView
        status="success"
        stats={stats}
        deals={[]}
        geoDevice={[]}
        pages={[]}
        live={emptyLive}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Ступени воронки' })).not.toBeInTheDocument();
    expect(screen.getByText(/Нет данных за выбранный период/)).toBeInTheDocument();
  });

  it('renders stages in English when the locale is en', () => {
    setTestLocale('en');
    const { container } = render(
      <FunnelView
        status="success"
        stats={stats}
        deals={deals}
        geoDevice={[]}
        pages={[]}
        live={live}
      />,
    );
    expect(screen.getByRole('list', { name: 'Funnel stages' })).toBeInTheDocument();
    expect(screen.getByText('Opened registration')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
