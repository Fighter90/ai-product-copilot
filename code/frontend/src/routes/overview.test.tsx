import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ChannelStat, GeoDeviceStat, PageStat, UtmStat } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { usePrefs } from '../store/prefs';

vi.mock('../lib/api', () => ({
  api: {
    channels: vi.fn(),
    primaryGoal: vi.fn(),
    geoDevice: vi.fn(),
    utm: vi.fn(),
    pages: vi.fn(),
    exitPages: vi.fn(),
  },
}));
import { api } from '../lib/api';
import { OverviewView, Overview } from './overview';

const sample: ChannelStat = {
  date: '2025-01-01',
  channel: 'podcast',
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  visits: 100,
  users: 90,
  bounceRate: 0.2,
  avgDuration: 60,
  goalReaches: 5,
  conversionRate: 0.05,
};

const geoSample: GeoDeviceStat = {
  date: '2025-01-01',
  country: 'Россия',
  device: 'desktop',
  visits: 100,
  users: 90,
  goalReaches: 5,
  conversionRate: 0.05,
};

describe('OverviewView', () => {
  it('renders the loading state', () => {
    render(<OverviewView status="pending" stats={[]} />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  it('renders the error state', () => {
    render(<OverviewView status="error" stats={[]} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the KPI strip and charts on success (no weak spots for a single channel)', () => {
    render(<OverviewView status="success" stats={[sample]} />);
    expect(screen.getByText('Цель (платных билетов)')).toBeInTheDocument();
    expect(screen.getByText(/Заявок/)).toBeInTheDocument();
    expect(screen.getByText('Визиты и заявки по дням')).toBeInTheDocument();
    expect(screen.getAllByTestId('echart')).toHaveLength(2);
    expect(screen.getByText(/Нет слабых мест/)).toBeInTheDocument();
    expect(screen.queryByText(/KPI-цель определена автоматически/)).not.toBeInTheDocument();
  });

  it('shows the auto-detected KPI goal badge when a primary goal is provided', () => {
    render(<OverviewView status="success" stats={[sample]} primaryGoalName="Ecommerce: покупка" />);
    expect(screen.getByText(/KPI-цель определена автоматически/)).toBeInTheDocument();
    expect(screen.getByText('Ecommerce: покупка')).toBeInTheDocument();
  });

  it('renders empty state when no stats are available', () => {
    render(<OverviewView status="success" stats={[]} />);
    expect(screen.getByText(/Нет данных за выбранный период/)).toBeInTheDocument();
  });

  it('renders geo/device charts when geoDevice data is provided', () => {
    render(<OverviewView status="success" stats={[sample]} geoDevice={[geoSample]} />);
    expect(screen.getByText('Топ стран по визитам')).toBeInTheDocument();
    expect(screen.getByText('Доля устройств (визиты)')).toBeInTheDocument();
    // 2 base charts (visits+applications, channel mix) + 2 geo/device charts = 4
    expect(screen.getAllByTestId('echart')).toHaveLength(4);
  });

  it('lists weak spots when a channel converts below the overall rate', () => {
    renderWithProviders(
      <OverviewView
        status="success"
        stats={[
          { ...sample, channel: 'podcast', visits: 100, goalReaches: 1 },
          { ...sample, channel: 'vip', visits: 10, goalReaches: 9 },
        ]}
      />,
    );
    // 'podcast' shows in both the weekly digest and the weak-spots list; the CR detail line is
    // unique to the weak-spots item.
    expect(screen.getAllByText('podcast').length).toBeGreaterThan(0);
    expect(screen.getByText(/100 визитов · CR/)).toBeInTheDocument();
    expect(screen.queryByText(/Нет слабых мест/)).not.toBeInTheDocument();
    // Deep-link to a prefilled hypothesis from the weak spot (targets the v3 report page).
    expect(screen.getByRole('link', { name: /гипотеза/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/app/report?'),
    );
  });
});

describe('OverviewView — first screen structure (ANA-48)', () => {
  afterEach(() => {
    cleanup();
    usePrefs.setState({ locale: 'ru' });
  });

  const utmLow: UtmStat = {
    date: '2025-01-01',
    utmSource: 'vk',
    utmMedium: 'cpc',
    utmCampaign: 'x',
    visits: 1,
    users: 1,
    goalReaches: 0,
    conversionRate: 0,
  };

  it('renders the KPI strip as the very first block, data-quality notices collapsed below it', () => {
    const { container } = renderWithProviders(
      <OverviewView
        status="success"
        stats={[sample]}
        primaryGoalName="Ecommerce: покупка"
        utm={[utmLow]}
        afterKpi={<p>onboarding-slot</p>}
      />,
    );
    const section = container.querySelector('section');
    const strip = screen.getByTestId('kpi-strip');
    expect(section?.firstElementChild).toBe(strip);

    const quality = screen.getByTestId('data-quality');
    expect(quality.tagName).toBe('DETAILS');
    expect(quality).not.toHaveAttribute('open');
    expect(screen.getByText('Качество данных (2)')).toBeVisible();
    // Notices are inside the collapsed block (not visible until expanded).
    expect(screen.getByText(/KPI-цель определена автоматически/)).not.toBeVisible();
    expect(screen.getByText(/Низкое покрытие UTM/)).not.toBeVisible();
    // Order: KPI strip → data quality → onboarding slot.
    expect(strip.compareDocumentPosition(quality) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const slot = screen.getByText('onboarding-slot');
    expect(quality.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No env-variable / DB-table jargon in the UI.
    expect(container.textContent).not.toMatch(/GOAL_ID|channel_stats|geo_device_stats/);
  });

  it('hides the data-quality block when there is nothing to report', () => {
    render(<OverviewView status="success" stats={[sample]} />);
    expect(screen.queryByTestId('data-quality')).not.toBeInTheDocument();
  });

  it('answers «успеваем к 300?»: progress ring, status, forecast and the main weak spot', () => {
    renderWithProviders(
      <OverviewView
        status="success"
        to="2025-01-02"
        stats={[
          {
            ...sample,
            date: '2025-01-01',
            channel: 'Direct traffic',
            visits: 1000,
            goalReaches: 5,
          },
          { ...sample, date: '2025-01-02', channel: 'vip', visits: 10, goalReaches: 9 },
        ]}
        b2bDeals={[{ id: 1, company: 'A', tickets: 30, stage: 'paid', dateAdded: '2025-01-01' }]}
      />,
    );
    const strip = within(screen.getByTestId('kpi-strip'));
    expect(strip.getByText('Успеваем к 300?')).toBeInTheDocument();
    expect(strip.getByRole('img', { name: 'Прогресс к цели: 30 из 300' })).toBeInTheDocument();
    // 14 reaches over 2 days → 7/day; 270 left → 39 days, deadline = to + 4 days → behind.
    expect(strip.getByTestId('pace-status')).toHaveTextContent('Не успеваем: +35 дн.');
    expect(strip.getByText(/Прогноз:/)).toBeInTheDocument();
    // Weak spot is the localised channel name.
    expect(strip.getByRole('link', { name: 'Прямые заходы' })).toHaveAttribute(
      'href',
      '#weak-spots',
    );
    expect(strip.getByText('Оплачено B2B')).toBeInTheDocument();
    expect(strip.getByText('Осталось до цели')).toBeInTheDocument();
    expect(screen.queryByText('Direct traffic')).not.toBeInTheDocument();
  });

  it('shows entry/exit pages as paths with the full URL in the title', () => {
    const page: PageStat = {
      date: '2025-01-01',
      page: 'https://productcamp.ru/tickets?x=1',
      visits: 10,
      users: 9,
      bounceRate: 0.1,
      goalReaches: 1,
      conversionRate: 0.1,
    };
    render(<OverviewView status="success" stats={[sample]} entryPages={[page]} />);
    const cell = screen.getByRole('cell', { name: '/tickets?x=1' });
    expect(cell).toHaveAttribute('title', 'https://productcamp.ru/tickets?x=1');
    expect(screen.queryByText('https://productcamp.ru/tickets?x=1')).not.toBeInTheDocument();
  });

  it('translates the KPI labels in English', () => {
    usePrefs.setState({ locale: 'en' });
    render(<OverviewView status="success" stats={[sample]} />);
    expect(screen.getByText('On track for 300?')).toBeInTheDocument();
    expect(screen.getByText('B2B paid')).toBeInTheDocument();
    expect(screen.getByText('Gap to goal')).toBeInTheDocument();
    expect(screen.getByText('B2C applications')).toBeInTheDocument();
  });
});

describe('Overview (data wrapper)', () => {
  afterEach(() => vi.resetAllMocks());

  beforeEach(() => {
    vi.mocked(api.utm).mockResolvedValue([]);
    vi.mocked(api.pages).mockResolvedValue([]);
    vi.mocked(api.exitPages).mockResolvedValue([]);
  });

  it('shows the auto-detected goal badge when /primary-goal resolves', async () => {
    vi.mocked(api.channels).mockResolvedValue([sample]);
    vi.mocked(api.primaryGoal).mockResolvedValue({
      id: 8,
      name: 'Ecommerce: покупка',
      type: 'action',
      isB2b: false,
      isArchived: false,
      syncedAt: 'x',
    });
    vi.mocked(api.geoDevice).mockResolvedValue([]);
    renderWithProviders(<Overview />);
    expect(await screen.findByText(/KPI-цель определена автоматически/)).toBeInTheDocument();
    expect(screen.getByText('Ecommerce: покупка')).toBeInTheDocument();
  });

  it('hides the badge when no primary goal is detected (404)', async () => {
    vi.mocked(api.channels).mockResolvedValue([sample]);
    vi.mocked(api.primaryGoal).mockRejectedValue(new Error('404'));
    vi.mocked(api.geoDevice).mockResolvedValue([]);
    renderWithProviders(<Overview />);
    expect(await screen.findByText('Цель (платных билетов)')).toBeInTheDocument();
    expect(screen.queryByText(/KPI-цель определена автоматически/)).not.toBeInTheDocument();
  });
});
