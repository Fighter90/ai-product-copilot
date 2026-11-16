import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ChannelStat, UtmStat } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { isoDaysAgo, useFilters } from '../store/filters';

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
    // ANA-149: the banner explains WHERE untagged traffic comes from + how to tag links.
    expect(screen.getByRole('status')).toHaveTextContent(
      /Немаркированный трафик в основном приходит через/,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/UTM-метки/);
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

describe('Traffic (data wrapper — ANA-139 data path)', () => {
  afterEach(() => {
    useFilters.setState({ segment: 'b2c_b2b', from: isoDaysAgo(13), to: isoDaysAgo(0) });
  });

  // Prod-shaped payload (ANA-139 report, 17.11): GET /api/metrics/utm?from=2026-11-10&to=
  // 2026-11-16 returned 201 per-day utm_stats rows with named campaigns while the
  // «UTM-разбивка» table rendered 0 rows / «покрытие 0.0%». The issue body does not record
  // the reporter's segment, so the NON-b2b path is pinned end to end here through the real
  // data wrapper: api.utm → applyTestTrafficFilter → filterUtmBySegment (passthrough outside
  // b2b) → utmRows → table. Named campaigns AND the «(none)» bucket must survive, per-day
  // rows must aggregate, and the coverage insight must show the computed share — never the
  // false «0.0%». (segment-filter.test.ts pins the filter unit; this pins the composed path.)
  const prodLikeUtm: UtmStat[] = [
    utmStat({
      date: '2026-11-10',
      utmSource: 'vk',
      utmMedium: 'cpc',
      utmCampaign: 'pcamp_nov',
      visits: 60,
      goalReaches: 6,
    }),
    utmStat({
      date: '2026-11-11',
      utmSource: 'vk',
      utmMedium: 'cpc',
      utmCampaign: 'pcamp_nov',
      visits: 55,
      goalReaches: 5,
    }),
    utmStat({
      date: '2026-11-10',
      utmSource: 'telegram',
      utmMedium: 'social',
      utmCampaign: 'ambassadors',
      visits: 40,
      goalReaches: 4,
    }),
    utmStat({
      date: '2026-11-10',
      utmSource: '(none)',
      utmMedium: '(none)',
      utmCampaign: '(none)',
      visits: 5,
      goalReaches: 0,
    }),
  ];

  it.each(['b2c_b2b', 'b2c'] as const)(
    'segment %s keeps every API UTM row and shows the computed coverage, not a false «0.0%»',
    async (segment) => {
      useFilters.setState({ segment, from: '2026-11-10', to: '2026-11-16' });
      // 200 channel visits vs 155 tagged → coverage 77.5% (≥ 70% → «хорошая атрибуция»).
      channels.mockResolvedValue([
        stat({ channel: 'Ad traffic', utmSource: null, visits: 100 }),
        stat({ channel: 'Direct traffic', utmSource: null, visits: 100 }),
      ]);
      utm.mockResolvedValue(prodLikeUtm);

      renderWithProviders(<Traffic />);
      expect(await screen.findByText('UTM-разбивка')).toBeInTheDocument();
      // The exact request from the issue body reaches the API untouched.
      expect(utm).toHaveBeenCalledWith({ from: '2026-11-10', to: '2026-11-16' });
      // Named campaigns are in the table…
      expect(screen.getByText('ambassadors')).toBeInTheDocument();
      // …and per-day rows aggregate into one triple: 60 + 55 visits, 6 + 5 applications.
      const vkRow = screen.getByRole('row', { name: /vk cpc pcamp_nov/ });
      expect(within(vkRow).getByText('115')).toBeInTheDocument();
      expect(within(vkRow).getByText('11')).toBeInTheDocument();
      // The «(none)» bucket the issue criterion asks for is on the period too.
      expect(screen.getAllByText('(none)').length).toBeGreaterThan(0);
      // Coverage is computed from the data — no «0.0%» false alarm from the prod report.
      expect(screen.getByText(/UTM покрытие 77\.5% — хорошая атрибуция/)).toBeInTheDocument();
    },
  );

  it('segment b2b empties the UTM set through the segment filter itself, while the API rows stay intact', async () => {
    // The only segment whose UTM set can be empty by design: Metrika never tags a visit as
    // B2B (segment-filter.filterUtmBySegment → []). Pinned through the REAL data wrapper:
    // the API returns the rows, the segment filter drops them, and the honest note replaces
    // the table — the mechanism behind the b2b arm, not lost data.
    useFilters.setState({ segment: 'b2b', from: '2026-11-10', to: '2026-11-16' });
    channels.mockResolvedValue([stat({ channel: 'b2b_manual', utmSource: null })]);
    utm.mockResolvedValue(prodLikeUtm);

    renderWithProviders(<Traffic />);
    expect(await screen.findByText(/UTM-разбивка доступна в сегментах/)).toBeInTheDocument();
    expect(screen.queryByText('Source')).toBeNull();
    expect(screen.queryByText(/UTM покрытие/)).toBeNull();
  });
});

describe('TrafficView (b2b segment — ANA-139)', () => {
  afterEach(() => {
    useFilters.setState({ segment: 'b2c_b2b' });
  });

  it('ANA-139: b2b shows no misleading «UTM покрытие 0.0%» warning or empty UTM table', () => {
    // Prod report (17.11, v3.4.57): the section rendered an empty table plus «UTM покрытие
    // 0.0% — часть трафика не атрибутирована» while GET /api/metrics/utm returned 201 rows.
    // The issue body does not record the reporter's segment; b2b is the ONLY segment whose
    // UTM set is empty BY DESIGN (Metrika never tags B2B visits — segment-filter
    // .filterUtmBySegment), and the data-wrapper tests below pin that every non-b2b segment
    // keeps all API rows. Here: no false zero-coverage alarm in that arm.
    useFilters.setState({ segment: 'b2b' });
    render(<TrafficView status="success" stats={[stat({ channel: 'Ручные сделки' })]} utm={[]} />);
    // No false «0.0% coverage» insight — the zero here is by construction, not a data problem.
    expect(screen.queryByText(/UTM покрытие 0\.0%/)).toBeNull();
    expect(screen.queryByText(/часть трафика не атрибутирована/)).toBeNull();
    // No empty UTM table (no «Source» column header) — an honest note instead.
    expect(screen.queryByText('Source')).toBeNull();
    expect(screen.getByText(/B2B-продажи учитываются вручную \(b2b_manual\)/)).toBeInTheDocument();
  });

  it('ANA-139: b2b replaces the empty source→campaign→applications flow chart with a note', () => {
    useFilters.setState({ segment: 'b2b' });
    render(<TrafficView status="success" stats={[stat({ channel: 'Ручные сделки' })]} utm={[]} />);
    // The flow block must not render a blank 460px ECharts canvas: honest note instead.
    expect(
      screen.getByText(/поток «источник → кампания → заявки» не строится/),
    ).toBeInTheDocument();
    // The fullscreen sankey button is pointless in b2b — hidden with the chart.
    expect(screen.queryByRole('button', { name: /Развернуть на весь экран/ })).toBeNull();
  });

  it('ANA-139: non-b2b segments keep the UTM table and the coverage insight', () => {
    useFilters.setState({ segment: 'b2c_b2b' });
    render(
      <TrafficView
        status="success"
        stats={[stat({ utmSource: null, visits: 100 })]}
        utm={[utmStat({ visits: 10 })]}
      />,
    );
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText(/UTM покрытие/)).toBeInTheDocument();
    expect(screen.queryByText(/B2B-продажи учитываются вручную/)).toBeNull();
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
