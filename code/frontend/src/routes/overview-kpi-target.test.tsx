import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { ChannelStat } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { useFilters } from '../store/filters';

const auth = vi.hoisted(() => ({ isAdmin: false }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ isAdmin: auth.isAdmin }),
}));

vi.mock('../lib/api', () => ({
  api: {
    channels: vi.fn(),
    primaryGoal: vi.fn(),
    geoDevice: vi.fn(),
    utm: vi.fn(),
    pages: vi.fn(),
    exitPages: vi.fn(),
    b2b: vi.fn(),
    kpiTarget: vi.fn(),
    b2cPayments: vi.fn(),
    paymentsSummary: vi.fn(),
  },
}));
// REG-12: Overview reads the public settings slice (EVENT_DATE), not GET /api/settings.
vi.mock('../lib/api-v3', () => ({
  v3: {
    settingsPublic: vi.fn(async () => ({ KPI_TARGET: { value: '' }, EVENT_DATE: { value: '' } })),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Overview KPI target («Цель по оплатам»)', () => {
  it('OverviewView shows the passed target instead of the hardcoded 300', () => {
    renderWithProviders(<OverviewView status="success" stats={[sample]} kpiTarget={120} />);
    const strip = screen.getByTestId('kpi-strip');
    expect(strip.textContent).toContain('120');
    expect(strip.textContent).not.toContain('300');
  });

  it('defaults to 300 without a target', () => {
    renderWithProviders(<OverviewView status="success" stats={[sample]} />);
    expect(screen.getByTestId('kpi-strip').textContent).toContain('300');
  });

  it('Overview loads the admin target from GET /metrics/kpi-target', async () => {
    vi.mocked(api.channels).mockResolvedValue([sample]);
    vi.mocked(api.primaryGoal).mockRejectedValue(new Error('404'));
    vi.mocked(api.geoDevice).mockResolvedValue([]);
    vi.mocked(api.utm).mockResolvedValue([]);
    vi.mocked(api.pages).mockResolvedValue([]);
    vi.mocked(api.exitPages).mockResolvedValue([]);
    vi.mocked(api.b2b).mockResolvedValue([]);
    vi.mocked(api.b2cPayments).mockResolvedValue([]);
    vi.mocked(api.kpiTarget).mockResolvedValue({ target: 450 });
    renderWithProviders(<Overview />);
    await waitFor(() => expect(screen.getByTestId('kpi-strip').textContent).toContain('450'));
    expect(api.kpiTarget).toHaveBeenCalled();
  });
});

describe('Overview KPI target (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders the KPI strip with an admin target in English', () => {
    setTestLocale('en');
    const { container } = renderWithProviders(
      <OverviewView status="success" stats={[sample]} kpiTarget={120} />,
    );
    const strip = screen.getByTestId('kpi-strip');
    expect(strip.textContent).toContain('120');
    expectNoCyrillic(container);
  });
});

describe('Overview B2B segment (БАГ-11 → ANA-176)', () => {
  const paidDeal = {
    id: 1,
    company: 'A',
    tickets: 30,
    stage: 'paid' as const,
    dateAdded: '2025-01-01',
    datePaid: '2025-01-02',
  };

  afterEach(() => {
    useFilters.setState({ segment: 'b2c_b2b' });
    auth.isAdmin = false;
  });

  it('B2B (analyst): KPI goal strip hidden with the explanation even with paid CRM deals', () => {
    useFilters.setState({ segment: 'b2b' });
    renderWithProviders(<OverviewView status="success" stats={[]} b2bDeals={[paidDeal]} />);
    // ANA-176: the goal-300 block belongs to the overall flow — hidden, never shown with zeros.
    expect(screen.queryByTestId('kpi-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('b2b-goal-hidden').textContent).toBe(
      'Цель 300 относится к общему потоку; в сегменте B2B целей Метрики нет',
    );
    expect(
      screen.getByText('B2B-данные вносятся вручную на странице B2B-сделки.'),
    ).toBeInTheDocument();
    // Neither the default empty-state nor the sync action for the analyst.
    expect(screen.queryByText(/Нет данных за выбранный период/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Запустите sync/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Перейти к B2B-сделкам' })).not.toBeInTheDocument();
  });

  it('B2B (admin): empty-state offers a transition to the B2B deals page, strip stays hidden', () => {
    useFilters.setState({ segment: 'b2b' });
    auth.isAdmin = true;
    renderWithProviders(<OverviewView status="success" stats={[]} b2bDeals={[paidDeal]} />);
    expect(screen.queryByTestId('kpi-strip')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перейти к B2B-сделкам' })).toHaveAttribute(
      'href',
      '/app/b2b',
    );
    expect(screen.queryByText(/Запустите sync/)).not.toBeInTheDocument();
  });

  it('B2C+B2B (default): empty screen unchanged — no KPI strip, standard empty-state', () => {
    renderWithProviders(<OverviewView status="success" stats={[]} />);
    expect(screen.queryByTestId('kpi-strip')).not.toBeInTheDocument();
    expect(screen.getByText(/Нет данных за выбранный период/)).toBeInTheDocument();
    // ANA-176: the B2B explanation is b2b-only — absent in other segments.
    expect(screen.queryByTestId('b2b-goal-hidden')).not.toBeInTheDocument();
  });

  it('B2C: empty screen unchanged — no KPI strip, standard empty-state', () => {
    useFilters.setState({ segment: 'b2c' });
    renderWithProviders(<OverviewView status="success" stats={[]} />);
    expect(screen.queryByTestId('kpi-strip')).not.toBeInTheDocument();
    expect(screen.getByText(/Нет данных за выбранный период/)).toBeInTheDocument();
    expect(screen.queryByTestId('b2b-goal-hidden')).not.toBeInTheDocument();
  });

  it('Overview wrapper: B2B segment hides the goal strip and explains, naming the real admin target', async () => {
    useFilters.setState({ segment: 'b2b' });
    vi.mocked(api.channels).mockResolvedValue([]);
    vi.mocked(api.primaryGoal).mockRejectedValue(new Error('404'));
    vi.mocked(api.geoDevice).mockResolvedValue([]);
    vi.mocked(api.utm).mockResolvedValue([]);
    vi.mocked(api.pages).mockResolvedValue([]);
    vi.mocked(api.exitPages).mockResolvedValue([]);
    vi.mocked(api.b2b).mockResolvedValue([paidDeal]);
    vi.mocked(api.kpiTarget).mockResolvedValue({ target: 450 });
    vi.mocked(api.paymentsSummary).mockResolvedValue({
      b2cPaid: 12,
      b2bPaid: 30,
      paid: 42,
      days: 0,
    });
    renderWithProviders(<Overview />);
    await waitFor(() => expect(screen.getByTestId('b2b-goal-hidden')).toBeInTheDocument());
    expect(screen.queryByTestId('kpi-strip')).not.toBeInTheDocument();
    // The explanation quotes the real admin target (450), not the hardcoded 300.
    expect(screen.getByTestId('b2b-goal-hidden').textContent).toContain('450');
    // The B2C payments figure (12) is not mixed into the hidden-strip explanation.
    expect(screen.getByTestId('b2b-goal-hidden').textContent).not.toContain('12');
    expect(screen.getByText(/B2B-данные вносятся вручную/)).toBeInTheDocument();
  });
});
