import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';
import { useFilters } from '../../store/filters';
import type { LiveFunnel, LiveGoal, LiveGoalDetail, LiveGoals, LiveTable } from '../../lib/api-v3';

vi.mock('../../lib/api-v3', () => ({
  v3: {
    liveSummary: vi.fn(),
    liveFunnel: vi.fn(),
    liveGoals: vi.fn(),
    goalRoles: vi.fn(),
    liveGoal: vi.fn(),
    liveTable: vi.fn(),
  },
}));
import { v3 } from '../../lib/api-v3';
import { Live } from './Live';
import { Goals } from './Goals';
import { GoalDetail } from './GoalDetail';
import { FunnelLive } from './FunnelLive';
import { Explore } from './Explore';

const NOW = new Date().toISOString();

const goal = (over: Partial<LiveGoal> & { archived?: boolean }): LiveGoal =>
  ({
    id: 1,
    name: 'Ticket purchase',
    type: 'action',
    event: 'reg_step1',
    reaches: 10,
    goalVisits: 9,
    conversionRate: 1.2,
    previousReaches: 5,
    delta: 1,
    reaches14: 10,
    reaches90: 40,
    status: 'live',
    duplicateOf: [],
    ...over,
  }) as LiveGoal;

const GOALS: LiveGoals = {
  from: '2026-10-01',
  to: '2026-10-14',
  previous: { from: '2026-09-17', to: '2026-09-30' },
  visits: 800,
  updatedAt: NOW,
  goals: [
    goal({ id: 1, name: 'Ticket purchase' }),
    goal({ id: 2, name: 'Old landing form', event: 'old_form', archived: true }),
    // БАГ-06: «sleeping» is an activity status, NOT the archive flag — such goals stay listed.
    goal({ id: 3, name: 'Sleeping form', event: null, status: 'sleeping', reaches90: 12 }),
  ],
};

const FUNNEL: LiveFunnel = {
  from: '2026-10-01',
  to: '2026-10-14',
  updatedAt: NOW,
  stages: [
    {
      key: 'visit',
      ru: 'Визит',
      en: 'Visit',
      value: 800,
      goalId: null,
      source: 'visits',
      fromPrevious: null,
      fromFirst: null,
    },
    {
      key: 'order',
      ru: 'Заказ',
      en: 'Order',
      value: 20,
      goalId: 1,
      source: 'goal',
      fromPrevious: 0.025,
      fromFirst: 0.025,
    },
  ],
  tickets: [{ type: 'standard', pick: 10, buy: 5, checkout: 2 }],
  roleFunnels: [
    {
      key: 'speaker',
      ru: 'Спикер',
      en: 'Speaker',
      steps: [
        { key: 'apply', ru: 'Заявка', en: 'Apply', value: 3, goalId: null, fromPrevious: null },
      ],
    },
  ],
  missing: [],
};

const DETAIL: LiveGoalDetail = {
  goal: { id: 2, name: 'Old landing form', type: 'action', event: 'old_form', conditions: [] },
  from: '2026-10-01',
  to: '2026-10-14',
  updatedAt: NOW,
  totals: { visits: 100, reaches: 5, conversionRate: 5 },
  series: [{ bucket: '2026-10-01', visits: 100, reaches: 5 }],
  bySource: [{ key: 'Ad traffic', visits: 100, reaches: 5, conversionRate: 5 }],
  byUtm: [],
  byPage: [],
  byDevice: [],
  byCountry: [],
};

const TABLE: LiveTable = {
  from: '2026-10-01',
  to: '2026-10-14',
  goalId: null,
  updatedAt: NOW,
  columns: ['ym:s:lastsignTrafficSource', 'ym:s:visits', 'ym:s:goal1reaches'],
  totals: [100, 5],
  rows: [{ dims: ['Search engine traffic'], values: [100, 5] }],
};

const initialFilters = useFilters.getState();

beforeEach(() => {
  useFilters.setState(initialFilters, true);
  vi.mocked(v3.liveSummary).mockResolvedValue({
    from: '2026-10-01',
    to: '2026-10-14',
    updatedAt: NOW,
    totals: { visits: 800, users: 600, pageviews: 2000, bounceRate: 20, avgDurationSec: 90 },
    series: [{ bucket: '2026-10-01', visits: 800, users: 600 }],
  } as Awaited<ReturnType<typeof v3.liveSummary>>);
  vi.mocked(v3.liveFunnel).mockResolvedValue(FUNNEL);
  vi.mocked(v3.liveGoals).mockResolvedValue(GOALS);
  vi.mocked(v3.goalRoles).mockResolvedValue({
    roles: [
      { code: 'G-03', event: 'reg_step1', ru: 'Регистрация', en: 'Registration', group: 'funnel' },
    ],
  });
  vi.mocked(v3.liveGoal).mockResolvedValue(DETAIL);
  vi.mocked(v3.liveTable).mockResolvedValue(TABLE);
});
afterEach(() => setTestLocale('ru'));

describe('Goals page — «Архивные цели» filter', () => {
  it('hides archived goals until the global checkbox is on', async () => {
    renderWithProviders(<Goals />);
    expect(await screen.findByText('Ticket purchase')).toBeInTheDocument();
    // ANA-34: the funnel-role column joins the pc-goals reference by the JS event.
    expect(screen.getByText('Регистрация')).toBeInTheDocument();
    // БАГ-06: only the archive flag hides a goal — «sleeping» stays in the list.
    expect(screen.getByText('Sleeping form')).toBeInTheDocument();
    expect(screen.queryByText('Old landing form')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Скрыто архивных целей: 1');

    act(() => useFilters.getState().toggleArchived());
    expect(await screen.findByText('Old landing form')).toBeInTheDocument();
    expect(screen.getByText('Архивная')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders without Cyrillic in English', async () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<Goals />);
    expect(await screen.findByText('Ticket purchase')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Archived goals hidden: 1');
    expectNoCyrillic(container);
  });
});

describe('Explore — goal selector honours the archived filter', () => {
  const options = () =>
    within(screen.getByRole('combobox', { name: /Цель для колонок|Goal for columns/ }))
      .getAllByRole('option')
      .map((o) => o.textContent);

  it('lists archived goals only when the checkbox is on', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/app/explore/:preset" element={<Explore />} />
      </Routes>,
      '/app/explore/sources',
    );
    await waitFor(() => expect(options()).toContain('Ticket purchase'));
    expect(options()).not.toContain('Old landing form');
    act(() => useFilters.getState().toggleArchived());
    await waitFor(() => expect(options()).toContain('Old landing form'));
  });

  it('renders without Cyrillic in English (headers + channel names localised)', async () => {
    setTestLocale('en');
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/app/explore/:preset" element={<Explore />} />
      </Routes>,
      '/app/explore/sources',
    );
    expect((await screen.findAllByText(/Goal: reaches/)).length).toBeGreaterThan(0);
    // «Search engine traffic» → channelName() → «Search engines» (tab + grid cell).
    expect(screen.getAllByText('Search engines').length).toBeGreaterThan(1);
    expectNoCyrillic(container);
  });
});

describe('Explore — unknown preset (REG-09)', () => {
  it('redirects a bogus preset to the default sources report instead of the 404 error screen', async () => {
    setTestLocale('ru');
    renderWithProviders(
      <Routes>
        <Route path="/app/explore/:preset" element={<Explore />} />
      </Routes>,
      '/app/explore/bogus',
    );
    // The sources report loads (after the redirect) and the doomed «bogus» request never fires.
    await waitFor(() => {
      expect(vi.mocked(v3.liveTable).mock.calls.some(([preset]) => preset === 'sources')).toBe(
        true,
      );
    });
    expect(vi.mocked(v3.liveTable).mock.calls.every(([preset]) => preset !== 'bogus')).toBe(true);
  });
});

describe('Live pages in English', () => {
  it('Live renders without Cyrillic', async () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<Live />);
    expect(await screen.findByText('Order')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expectNoCyrillic(container);
  });

  it('FunnelLive renders without Cyrillic', async () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<FunnelLive />);
    expect(await screen.findByText('Speaker')).toBeInTheDocument();
    expectNoCyrillic(container);
  });

  it('GoalDetail renders without Cyrillic and marks an archived goal', async () => {
    vi.mocked(v3.liveGoal).mockResolvedValue({
      ...DETAIL,
      goal: { ...DETAIL.goal, archived: true } as LiveGoalDetail['goal'],
    });
    setTestLocale('en');
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/app/goals/:id" element={<GoalDetail />} />
      </Routes>,
      '/app/goals/2',
    );
    expect(await screen.findByText('Archived')).toBeInTheDocument();
    expect(screen.getAllByText('Ads').length).toBeGreaterThan(0);
    // БАГ-13: every conversion number on the card is goal visits / all visits — the breakdown
    // table headers must carry the same honest label as the KPI tile (reaches/visits ≠ conversion).
    expect(
      screen.getAllByText('Conversion (per visits with the goal)').length,
    ).toBeGreaterThanOrEqual(2);
    expectNoCyrillic(container);
  });

  it('Goals: status filter still works next to the archived filter', async () => {
    setTestLocale('en');
    renderWithProviders(<Goals />);
    await screen.findByText('Ticket purchase');
    fireEvent.change(screen.getByRole('combobox', { name: /status/i }), {
      target: { value: 'dead' },
    });
    expect(screen.queryByText('Ticket purchase')).not.toBeInTheDocument();
  });
});

describe('Explore — weighted totals (БАГ-08)', () => {
  const PAGES_TABLE: LiveTable = {
    from: '2026-10-01',
    to: '2026-10-14',
    goalId: null,
    updatedAt: NOW,
    columns: [
      'ym:s:startURLPath',
      'ym:s:visits',
      'ym:s:bounceRate',
      'ym:s:pageDepth',
      'ym:s:avgVisitDurationSeconds',
    ],
    totals: [100, 28, 2.8, 57],
    rows: [
      { dims: ['/'], values: [90, 20, 3, 60] },
      { dims: ['/lp'], values: [10, 100, 1, 30] },
    ],
  };

  beforeEach(() => {
    vi.mocked(v3.liveTable).mockResolvedValue(PAGES_TABLE);
  });

  it('«Итого» for rates/durations is visit-weighted, not a plain row mean', async () => {
    setTestLocale('ru');
    renderWithProviders(
      <Routes>
        <Route path="/app/explore/:preset" element={<Explore />} />
      </Routes>,
      '/app/explore/pages',
    );
    // Both rows are in the grid…
    expect(await screen.findByText('/lp')).toBeInTheDocument();
    // …and the totals row weighs by visits: bounce (90×20 + 10×100)/100 = 28% (plain mean 60%),
    // depth 2.8 (plain 2), duration 0:57 (plain 0:45).
    await waitFor(() => {
      const foot = document.querySelector('tfoot');
      expect(foot).not.toBeNull();
      const text = foot!.textContent ?? '';
      expect(text).toContain('Итого');
      expect(text).toContain('28,00%');
      expect(text).toContain('2,80');
      expect(text).toContain('0:57');
      expect(text).not.toContain('60,00%');
      expect(text).not.toContain('0:45');
    });
  });
});

// REG-06 (ANA-95): «Заявки по ролям» — a role step whose goal is missing from the counter shows a
// warning instead of a silent 0, a >100 % step ratio is never rendered, and the chain keeps the
// values of the steps that do have goals.
describe('FunnelLive — role steps without a counter goal (REG-06)', () => {
  it('marks goal-less steps, hides >100% conversions, keeps the chain', async () => {
    vi.mocked(v3.liveFunnel).mockResolvedValue({
      ...FUNNEL,
      roleFunnels: [
        {
          key: 'clevel',
          ru: 'C-level',
          en: 'C-level',
          steps: [
            {
              key: 'view',
              ru: 'Открыл анкету',
              en: 'Opened the form',
              value: 7,
              goalId: null,
              fromPrevious: null,
            },
            {
              key: 'apply',
              ru: 'Отправил заявку',
              en: 'Submitted',
              value: 24,
              goalId: 9,
              fromPrevious: 24 / 7,
            },
          ],
        },
      ],
    });
    setTestLocale('ru');
    renderWithProviders(<FunnelLive />);
    // The goal-less step is flagged…
    expect(await screen.findByText('нет цели в счётчике')).toBeInTheDocument();
    // …the «Отправил заявку» value survives the gap (chain is not zeroed)…
    expect(screen.getByText('24')).toBeInTheDocument();
    // …and the 342,9 % ratio (24/7) is not shown.
    expect(screen.queryByText(/342,9/)).not.toBeInTheDocument();
  });
});
