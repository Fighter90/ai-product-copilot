import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { ChannelStat, B2bDeal, PageStat } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { fireObservedResize } from '../test/resize-observer';
import { OUTSIDE_LABEL_GUTTER } from '../lib/funnel';

vi.mock('../lib/api', () => ({
  api: {
    channels: vi.fn(),
    b2b: vi.fn(),
    geoDevice: vi.fn().mockResolvedValue([]),
    pages: vi.fn().mockResolvedValue([]),
  },
}));
// ANA-124: capture the chart options the route hands to EChart so option-level guards
// (grid.containLabel) are unit-testable without a canvas. The testid matches the real
// EChart markup so existing waitFor assertions keep working.
const { chartOptions, chartHeights } = vi.hoisted(() => ({
  chartOptions: [] as object[],
  chartHeights: [] as number[],
}));
vi.mock('../components/charts/EChart', () => ({
  EChart: ({ option, height }: { option: object; height?: number }) => {
    chartOptions.push(option);
    chartHeights.push(height ?? 300);
    return <div data-testid="echart" />;
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

  it('renders the funnel stages + chart on success', async () => {
    render(<FunnelView status="success" stats={stats} deals={deals} geoDevice={[]} pages={[]} />);
    expect(screen.getByText('Визитов')).toBeInTheDocument();
    // The label appears on the KPI card and in the funnel stage list below the chart.
    expect(screen.getAllByText('Оплачено B2B').length).toBeGreaterThanOrEqual(1);
    // Multiple charts now: funnel, channel CR, geo. EChart грузит EChartInner за React.lazy
    // (ANA-41) — ждём появления минимум двух графиков.
    await waitFor(() => expect(screen.getAllByTestId('echart').length).toBeGreaterThanOrEqual(2), {
      timeout: 15000,
    });
  });

  it('ANA-184: the «Заявок B2C» card explains why the funnel reg_step1 stage differs', () => {
    // Регресс 15.11: карточка «Заявок B2C» (достижения основной цели) ≠ ступень «Оставили
    // контакты (заказ)» (отдельная live-цель reg_step1) — подписи обязаны объяснять разницу.
    render(<FunnelView status="success" stats={stats} deals={deals} geoDevice={[]} pages={[]} />);
    // Both the card hint and the chart caveat stay in the DOM (sr-only until opened).
    const hints = screen.getAllByText(/reg_step1/);
    expect(hints.length).toBeGreaterThanOrEqual(2);
    for (const hint of hints) expect(hint.textContent).toContain('Оставили контакты');
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

  it('flags a critical-bounce page after aggregating per-day rows (ANA-75 / БАГ-09)', () => {
    // Each per-day row stays under the visit threshold (20/25 < 30), but the page aggregates to
    // 45 visits at 100% bounce — «Нет страниц с критическим bounce» must not contradict the
    // Behavior table showing it at 100%.
    render(
      <FunnelView
        status="success"
        stats={stats}
        deals={deals}
        geoDevice={[]}
        pages={[
          {
            date: '2025-01-01',
            page: '/PCxPS_special',
            visits: 20,
            users: 20,
            bounceRate: 1,
            goalReaches: 0,
            conversionRate: 0,
          },
          {
            date: '2025-01-02',
            page: '/PCxPS_special',
            visits: 25,
            users: 20,
            bounceRate: 1,
            goalReaches: 0,
            conversionRate: 0,
          },
        ]}
      />,
    );
    expect(screen.queryByText(/Нет страниц с критическим bounce/)).not.toBeInTheDocument();
    expect(screen.getByText(/\/PCxPS_special — 100\.0% при 45 визитах/)).toBeInTheDocument();
  });
});

describe('FunnelView — problem pages (БАГ-07)', () => {
  it('collapses raw-URL duplicates of one page into a single aggregated line', () => {
    const dup = (over: Partial<PageStat>): PageStat => ({
      date: '2025-01-01',
      page: 'https://productcamp.ru/',
      // ANA-118: above the unified BOUNCE_HIGH (0.5) so the page stays «критический» —
      // exactly 0.5 is no longer flagged anywhere (Behavior uses the same constant).
      visits: 100,
      users: 90,
      bounceRate: 0.6,
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
    // …and is listed once, with summed visits (300), under the normalized path key (ANA-178).
    expect(screen.getAllByText('/ — 60.0% при 300 визитах')).toHaveLength(1);
    expect(screen.queryByText(/при 100 визитах/)).not.toBeInTheDocument();
  });
});

describe('FunnelView — unified problem-page thresholds (ANA-118 / БАГ-09)', () => {
  it('judges problem-page bounce by the shared BOUNCE_HIGH, not an inline 0.4 (ANA-118 / БАГ-09)', () => {
    // 100 visits at 45% bounce: Behavior (BOUNCE_HIGH = 0.5) shows nothing for the same page,
    // so the funnel «Проблемные страницы» must not call it критический either.
    render(
      <FunnelView
        status="success"
        stats={stats}
        deals={deals}
        geoDevice={[]}
        pages={[
          {
            date: '2025-01-01',
            page: '/mid-bounce',
            visits: 100,
            users: 90,
            bounceRate: 0.45,
            goalReaches: 2,
            conversionRate: 0.02,
          },
        ]}
      />,
    );
    expect(screen.getByText(/Нет страниц с критическим bounce/)).toBeInTheDocument();
    expect(screen.queryByText(/mid-bounce/)).not.toBeInTheDocument();
  });
});

describe('FunnelView — per-issue pc-goals funnel (ANA-21)', () => {
  afterEach(() => setTestLocale('ru'));

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
        // ANA-75 БАГ-10: the funnel «Визиты» stage now reuses the channels factsource (the card
        // figure), so an all-zero live funnel is only empty when the channels have no visits too.
        // deals=[] keeps the B2B paid fallback at 0 so no stage carries data.
        stats={[]}
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

describe('FunnelView — ANA-75 БАГ-10 (aligned visits, split B2C/B2B losses)', () => {
  // Live pc-goals funnel reports 2 246 visits — a different source than the channels factsource.
  const liveDiffVisits = {
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

  it('shows the same visits figure in the card and the funnel (live source is overridden)', () => {
    render(
      <FunnelView
        status="success"
        stats={stats}
        deals={deals}
        geoDevice={[]}
        pages={[]}
        live={liveDiffVisits}
      />,
    );
    // The live pc-goals figure (2 246) must not leak into the page anywhere.
    // NB: plain-space literals — RTL getByText does not match Intl nbsp strings.
    expect(screen.queryByText('2 246')).not.toBeInTheDocument();
    // Card + funnel stage list both render the channels factsource visits (1 000).
    expect(screen.getAllByText('1 000').length).toBeGreaterThanOrEqual(2);
  });

  it('splits losses: B2C branch for visits→applications, B2B pipeline only from B2B deals', () => {
    render(<FunnelView status="success" stats={stats} deals={deals} geoDevice={[]} pages={[]} />);
    // stats: 1 000 visits, 100 goal reaches → 900 (90.0%) lost on the B2C branch.
    expect(screen.getByText('B2C-ветка: потеряно от визита до заявки:')).toBeInTheDocument();
    expect(screen.getByText('900 визитов (90.0%)')).toBeInTheDocument();
    // deals: 30 tickets, all paid → 0 B2B pipeline losses; the 900 B2C visits are not counted here.
    expect(screen.getByText('B2B-пайплайн: сделки, не дошедшие до оплаты:')).toBeInTheDocument();
    expect(screen.getByText('0 сделок (0.0%)')).toBeInTheDocument();
  });
});

describe('FunnelView — chart option guards (ANA-124)', () => {
  it('channel CR chart reserves room for long channel names: grid.containLabel', async () => {
    // Fixed left: 120 clipped long RU channel names («Рекомендации», e-mail campaigns…);
    // containLabel sizes the y-axis gutter from the actual labels (lib/traffic.ts pattern).
    chartOptions.length = 0;
    render(<FunnelView status="success" stats={stats} deals={deals} geoDevice={[]} pages={[]} />);
    // funnel + channel CR + funnel-by-channel charts all mount on this data.
    await waitFor(() => expect(chartOptions.length).toBeGreaterThanOrEqual(3));
    const crChart = chartOptions.find(
      (o) =>
        Array.isArray((o as { series?: unknown[] }).series) &&
        (o as { series: Array<{ name?: string }> }).series[0]?.name === 'CR',
    ) as { grid: { containLabel?: boolean } } | undefined;
    expect(crChart).toBeDefined();
    expect(crChart?.grid.containLabel).toBe(true);
  });

  it('funnel chart reserves vertical room for wrapped stage labels: height ≥ 360 (ANA-177)', () => {
    // ANA-177: a wrapped 4-line label (~64px) does not fit a 300px chart's stage band
    // (~56px) — it bleeds into the neighbouring stage's label («наложено»).
    chartOptions.length = 0;
    chartHeights.length = 0;
    render(<FunnelView status="success" stats={stats} deals={deals} geoDevice={[]} pages={[]} />);
    return waitFor(() => expect(chartOptions.length).toBeGreaterThanOrEqual(3)).then(() => {
      const funnelIdx = chartOptions.findIndex(
        (o) => (o as { series?: Array<{ type?: string }> }).series?.[0]?.type === 'funnel',
      );
      expect(funnelIdx).toBeGreaterThanOrEqual(0);
      expect(chartHeights[funnelIdx]).toBeGreaterThanOrEqual(360);
    });
  });
});

// ANA-177 review round 3: the jsdom ResizeObserver stub used to be fully inert, so the
// measured-width hook (`useMeasuredWidth`) never fired in any test — the feature's core
// mechanism (measured canvas width driving the pixel-based label threshold) had zero
// coverage in the component path. The capturing stub (test/resize-observer.ts) lets tests
// fire it with a real width and watch the funnel option rebuild.
describe('FunnelView — measured canvas width drives the label decision (ANA-177 round 3)', () => {
  // Stages 100 → 20 → 33 → 15: every stage ≥ 128px at a 900px canvas (min share 15% × 900
  // = 135px), but the 15% stage is only 54.9px at the unmeasured 366px default — so the
  // measured vs default width must flip this stage's label placement.
  const wideStats: ChannelStat[] = [
    { ...stats[0]!, visits: 100, goalReaches: 20, conversionRate: 0.2 },
  ];
  const wideDeals: B2bDeal[] = [
    { id: 1, company: 'Acme', tickets: 18, stage: 'lead', dateAdded: '2025-01-01' },
    { id: 2, company: 'Beta', tickets: 15, stage: 'paid', dateAdded: '2025-01-01' },
  ];

  type FunnelSeries = {
    type?: string;
    left?: number;
    right?: number;
    data: Array<{ label?: { position?: string } }>;
  };
  const lastFunnelSeries = (): FunnelSeries => {
    const funnelOptions = chartOptions.filter(
      (o) => (o as { series?: FunnelSeries[] }).series?.[0]?.type === 'funnel',
    );
    const option = funnelOptions[funnelOptions.length - 1] as { series: FunnelSeries[] };
    return option.series[0]!;
  };

  it('the measured width overrides the default: a stage outside at 366px fits inside at 900px', async () => {
    chartOptions.length = 0;
    render(
      <FunnelView status="success" stats={wideStats} deals={wideDeals} geoDevice={[]} pages={[]} />,
    );
    await waitFor(() => expect(chartOptions.length).toBeGreaterThanOrEqual(3));
    // jsdom reports nothing yet → the builder falls back to its documented 366px default:
    // the 15%-share stage is under 128px → outside label + reserved left gutter.
    expect(lastFunnelSeries().left).toBe(OUTSIDE_LABEL_GUTTER);
    // The ResizeObserver delivers the real container width (900px desktop card)…
    act(() => fireObservedResize(900));
    // …and the funnel re-renders with a rebuilt option driven by that measurement.
    await waitFor(() => expect(chartOptions.length).toBeGreaterThanOrEqual(4));
    const measured = lastFunnelSeries();
    // Every stage ≥ 128px at 900px → all labels fit inside, no gutter is reserved…
    expect(measured.left).toBeUndefined();
    expect(measured.right).toBeUndefined();
    // …and no per-item outside label survives the rebuild.
    for (const d of measured.data) expect(d.label?.position).toBeUndefined();
  });

  it('measurements without a usable width are ignored (no rerender, default stays)', async () => {
    chartOptions.length = 0;
    render(
      <FunnelView status="success" stats={wideStats} deals={wideDeals} geoDevice={[]} pages={[]} />,
    );
    await waitFor(() => expect(chartOptions.length).toBeGreaterThanOrEqual(3));
    const before = chartOptions.length;
    // An empty entry list (contentRect absent) and a 0-width measurement — neither may move
    // the option off its documented default (width > 0 is the only accepted measurement).
    act(() => fireObservedResize());
    act(() => fireObservedResize(0));
    expect(chartOptions.length).toBe(before);
    expect(lastFunnelSeries().left).toBe(OUTSIDE_LABEL_GUTTER);
  });
});
