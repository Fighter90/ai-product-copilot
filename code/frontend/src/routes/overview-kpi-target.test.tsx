import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { ChannelStat } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

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
    paymentsSummary: vi.fn(),
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
