import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChannelStat, UtmStat } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

vi.mock('../lib/api', () => ({ api: { channels: vi.fn(), utm: vi.fn() } }));
import { api } from '../lib/api';
import { TrafficView, Traffic } from './traffic';

const channels = api.channels as unknown as ReturnType<typeof vi.fn>;
const utm = api.utm as unknown as ReturnType<typeof vi.fn>;

function stat(over: Partial<ChannelStat>): ChannelStat {
  return {
    date: '2025-01-01',
    channel: 'podcast',
    utmSource: 'podcast',
    utmMedium: null,
    utmCampaign: null,
    visits: 10,
    users: 9,
    bounceRate: 0.2,
    avgDuration: 60,
    goalReaches: 1,
    conversionRate: 0.1,
    ...over,
  };
}

const utmStat = (over: Partial<UtmStat>): UtmStat => ({
  date: '2025-01-01',
  utmSource: 'vk',
  utmMedium: 'cpc',
  utmCampaign: 'spring',
  visits: 10,
  users: 9,
  goalReaches: 1,
  conversionRate: 0.1,
  ...over,
});

beforeEach(() => {
  channels.mockReset();
  utm.mockReset();
});

describe('TrafficView', () => {
  it('renders loading and error states', () => {
    const { rerender } = render(<TrafficView status="pending" stats={[]} utm={[]} />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
    rerender(<TrafficView status="error" stats={[]} utm={[]} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the low-UTM badge, channel table, and the UTM-breakdown table', () => {
    // 100 channel visits, only 10 UTM-tagged → 10% coverage (< 70% → low badge shown).
    render(
      <TrafficView
        status="success"
        stats={[stat({ utmSource: null, visits: 100 })]}
        utm={[utmStat({ visits: 10 })]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Низкое покрытие UTM/);
    expect(screen.getByText('Каналы — визиты')).toBeInTheDocument();
    expect(screen.getByText('podcast')).toBeInTheDocument();
    expect(screen.getByText('UTM-разбивка')).toBeInTheDocument();
    expect(screen.getByText('spring')).toBeInTheDocument();
  });

  it('keeps both tables inside horizontal-scroll containers so 390px never overflows the page (ANA-135)', () => {
    // ANA-135: at a 390px viewport the channel table (long Cyrillic channel names, the
    // «Пользователи» header) had a min-content width wider than its container and, being the
    // only table on the page without an overflow-x-auto wrapper, pushed
    // document.scrollWidth to 398 > 390 — a horizontal page scroll. jsdom cannot measure
    // layout, so the regression guard is structural: every table on the page must sit inside
    // a horizontal-scroll container, which makes page-level overflow impossible.
    render(<TrafficView status="success" stats={[stat({})]} utm={[utmStat({})]} />);
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table.closest('.overflow-x-auto')).not.toBeNull();
    }
  });

  it('shows an empty state when there is no traffic data', () => {
    render(<TrafficView status="success" stats={[]} utm={[]} />);
    expect(screen.getByText(/Нет данных за выбранный период/)).toBeInTheDocument();
  });

  it('hides the badge when UTM coverage is high', () => {
    // 100 channel visits, 80 UTM-tagged → 80% coverage (≥ 70% → no low badge).
    render(
      <TrafficView
        status="success"
        stats={[stat({ visits: 100 })]}
        utm={[utmStat({ utmSource: 'vk', visits: 80 })]}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('never praises a channel whose CR beats the average but stays under the CR target (ANA-118 / БАГ-09)', () => {
    // Overall CR = 0.6% is «низкий»; «Ad traffic» converts at 1.6% — 1.5× the average but
    // below the shared 2% CR target, so praising it here would contradict the Overview
    // verdict next to it (overview.tsx pattern). The low-CR channel renders a hypothesis
    // <Link>, hence the Router wrapper.
    renderWithProviders(
      <TrafficView
        status="success"
        stats={[
          stat({ channel: 'Ad traffic', visits: 250, goalReaches: 4 }),
          stat({ channel: 'podcast', visits: 750, goalReaches: 2 }),
        ]}
        utm={[]}
      />,
    );
    expect(screen.queryByText(/выше среднего/)).not.toBeInTheDocument();
  });

  it('praises a channel CR only past the unified MIN_CHANNEL_VISITS sample gate (ANA-118 / БАГ-09)', () => {
    // 40 visits at CR 30% beat 1.5× the overall 1.2% — but Overview judges channels from
    // 50 visits on, so Traffic must not praise this one either.
    renderWithProviders(
      <TrafficView
        status="success"
        stats={[
          stat({ channel: 'Ad traffic', visits: 40, goalReaches: 12 }),
          stat({ channel: 'podcast', visits: 960, goalReaches: 0 }),
        ]}
        utm={[]}
      />,
    );
    expect(screen.queryByText(/выше среднего/)).not.toBeInTheDocument();
  });

  it('shows the top-campaign badge only past the unified MIN_CHANNEL_VISITS gate (ANA-118 / БАГ-09)', () => {
    // CR 20% > 5% target but only 40 visits — the same sample gate as the channel insights.
    render(
      <TrafficView
        status="success"
        stats={[stat({ utmSource: null, visits: 100 })]}
        utm={[utmStat({ utmSource: 'vk', visits: 40, goalReaches: 8, conversionRate: 0.2 })]}
      />,
    );
    expect(screen.queryByText(/Лучшая кампания/)).not.toBeInTheDocument();
  });
});

describe('Traffic (data wrapper)', () => {
  it('renders both tables after the queries resolve', async () => {
    channels.mockResolvedValue([stat({})]);
    utm.mockResolvedValue([utmStat({})]);
    renderWithProviders(<Traffic />);
    expect(await screen.findByText('Каналы — визиты')).toBeInTheDocument();
    expect(screen.getByText('UTM-разбивка')).toBeInTheDocument();
  });
});

describe('TrafficView (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders headings, tables, insights and captions without Cyrillic', () => {
    setTestLocale('en');
    const { container } = renderWithProviders(
      <TrafficView
        status="success"
        stats={[
          stat({ channel: 'Direct traffic', visits: 400, goalReaches: 40 }),
          stat({ channel: 'Ad traffic', visits: 300, goalReaches: 1 }),
          stat({ channel: 'podcast', visits: 100, goalReaches: 1 }),
        ]}
        utm={[utmStat({ visits: 100, goalReaches: 10, conversionRate: 0.1 })]}
      />,
    );
    expect(screen.getByText('Channels — visits')).toBeInTheDocument();
    expect(screen.getByText('UTM breakdown')).toBeInTheDocument();
    // Channel names go through channelName(): «Ad traffic» → «Ads».
    expect(screen.getByRole('cell', { name: 'Ads' })).toBeInTheDocument();
    expect(screen.getAllByText(/Caution/).length).toBeGreaterThan(0);
    expect(screen.getByText(/below average with 300 visits/)).toBeInTheDocument();
    expectNoCyrillic(container);
  });

  it('keeps the error state in English', () => {
    setTestLocale('en');
    const { container } = render(<TrafficView status="error" stats={[]} utm={[]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load traffic.');
    expectNoCyrillic(container);
  });
});
