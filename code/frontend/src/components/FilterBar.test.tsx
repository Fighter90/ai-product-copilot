import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FilterBar } from './FilterBar';
import { useFilters } from '../store/filters';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

// The bar reads the session role for the «Догрузить N дней» action (ANA-49); the harness
// renders FilterBar without the real AuthProvider, so the hook is mocked here. The mutable
// `mocks` object lets individual REG-04 tests flip the role without re-mocking the module.
const mocks = vi.hoisted(() => ({
  isAdmin: true,
  coverageFrom: new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10),
  // ANA-139: per-table coverage from GET /metrics/coverage (undefined = old backend response).
  coverageTables: undefined as Record<string, { from: string; to: string } | null> | undefined,
  // ANA-153: days zero-protection defended (undefined = old backend response → no badge).
  protectedDays: undefined as number | undefined,
  sync: vi.fn(),
  // ANA-139 round 2: the «допарсить» action refills exactly the missing days (POST /sync/gaps).
  syncGaps: vi.fn(),
  // ANA-139 round 2: GET /metrics/gaps answer for the selected period (undefined = probe fails).
  gapsTables: undefined as Record<string, Array<{ from: string; to: string }>> | undefined,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    unavailable: false,
    isAdmin: mocks.isAdmin,
    login: async () => {
      throw new Error('not used in FilterBar tests');
    },
    logout: async () => {},
    refresh: () => {},
  }),
}));

// Coverage probe (ANA-49): answer deterministically with a range that fully covers any test
// period (starts before the default 14-day window) so the backfill prompt stays hidden here.
// REG-04 tests override `mocks.coverageFrom` to point inside the selected period.
vi.mock('../lib/api', () => ({
  http: async (path: string) => {
    if (path === '/metrics/coverage') {
      return {
        from: mocks.coverageFrom,
        to: new Date(Date.now()).toISOString().slice(0, 10),
        days: 15,
        ...(mocks.coverageTables ? { tables: mocks.coverageTables } : {}),
        ...(mocks.protectedDays !== undefined ? { protectedDays: mocks.protectedDays } : {}),
      };
    }
    if (path.startsWith('/metrics/gaps')) {
      if (mocks.gapsTables === undefined) throw new Error('gaps probe failed (advisory)');
      return { from: '', to: '', tables: mocks.gapsTables };
    }
    throw new Error(`unexpected fetch in FilterBar tests: ${path}`);
  },
  api: { sync: mocks.sync, syncGaps: mocks.syncGaps },
}));

const initial = useFilters.getState();
beforeEach(() => useFilters.setState(initial, true));

// UTC-базированные ISO-даты — тот же расчёт, что в store/filters (isoDaysAgo),
// чтобы ассерты не зависели от текущей даты и таймзоны CI.
const isoOffset = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const today = isoOffset(0);

// WCAG 2.5.3 Label in Name: accessible names now start with the visible label
// («7д — Показать …»), so the helpers match by regex.
const datesToggle = () =>
  screen.getByRole('button', { name: /Выбрать произвольный период \(макс\. 365 дней\)/ });
const presetBtn = (days: number) =>
  screen.getByRole('button', {
    name:
      days === 365
        ? /Показать данные за последний год/
        : new RegExp(`Показать данные за последние ${days} дней`),
  });
const applyBtn = () => screen.getByRole('button', { name: 'Применить' });

/** Open the custom picker and return its controls. */
function openPicker() {
  fireEvent.click(datesToggle());
  return {
    from: screen.getByLabelText('Дата начала периода'),
    to: screen.getByLabelText('Дата окончания периода'),
    apply: applyBtn(),
  };
}

/** Render inside a router at /app/goals (БАГ-06: the bar reads the route for page-aware toggles). */
const renderBar = (initialEntries: string[] = ['/app/goals']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <FilterBar />
    </MemoryRouter>,
  );

describe('FilterBar', () => {
  it('applies preset, segment and archived toggle', () => {
    renderBar();

    fireEvent.click(presetBtn(7));
    expect(useFilters.getState().from <= useFilters.getState().to).toBe(true);

    fireEvent.change(screen.getByLabelText('Сегмент'), { target: { value: 'b2b' } });
    expect(useFilters.getState().segment).toBe('b2b');

    fireEvent.click(screen.getByLabelText(/архивные/i));
    expect(useFilters.getState().showArchived).toBe(true);
  });

  it('БАГ-06: hides the archived-goals toggle on Обзор (/app) where no goals list exists', () => {
    renderBar(['/app']);
    expect(screen.queryByLabelText(/архивные/i)).not.toBeInTheDocument();
  });

  it('БАГ-06: keeps the archived-goals toggle on the goals page (/app/goals)', () => {
    renderBar(['/app/goals']);
    expect(screen.getByLabelText(/архивные/i)).toBeInTheDocument();
  });

  it('shows the 1г (1 year) preset button', () => {
    renderBar();
    expect(presetBtn(365)).toBeInTheDocument();
  });

  it('marks the active preset with aria-pressed (ANA-49)', () => {
    renderBar();
    const p7 = presetBtn(7);
    const p14 = presetBtn(14);
    const p30 = presetBtn(30);

    // Default range (14 days) does not press 7д/30д.
    expect(p7).toHaveAttribute('aria-pressed', 'false');
    expect(p30).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(p7);
    expect(p7).toHaveAttribute('aria-pressed', 'true');
    expect(p14).toHaveAttribute('aria-pressed', 'false');
    expect(p30).toHaveAttribute('aria-pressed', 'false');
    // Store range matches the preset: last 7 days ending today.
    expect(useFilters.getState().from).toBe(isoOffset(-6));
    expect(useFilters.getState().to).toBe(today);
  });

  it('toggles custom date picker visibility with aria-expanded', () => {
    renderBar();
    const toggle = datesToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Custom date picker is hidden initially
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Дата начала периода')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();
  });

  it('applies custom date range when valid', () => {
    renderBar();
    const { from, to } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(-29) } });
    fireEvent.change(to, { target: { value: today } });
    fireEvent.click(applyBtn());
    expect(useFilters.getState().from).toBe(isoOffset(-29));
    expect(useFilters.getState().to).toBe(today);
    // The picker closes after applying
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();
  });

  it('treats a single-day range (from == to) as valid', () => {
    renderBar();
    const { from, to, apply } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(-5) } });
    fireEvent.change(to, { target: { value: isoOffset(-5) } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(useFilters.getState().from).toBe(isoOffset(-5));
    expect(useFilters.getState().to).toBe(isoOffset(-5));
  });

  it('disables «Применить» when from > to and shows a hint (ANA-49)', () => {
    renderBar();
    const { from, to, apply } = openPicker();
    fireEvent.change(from, { target: { value: '2025-06-15' } });
    fireEvent.change(to, { target: { value: '2025-06-10' } });

    expect(apply).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Дата окончания не может быть раньше даты начала.',
    );
    // Invalid range never reaches the store
    expect(useFilters.getState().from).not.toBe('2025-06-15');
  });

  it('disables «Применить» when from is in the future (ANA-49)', () => {
    renderBar();
    const { from, to, apply } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(10) } });
    fireEvent.change(to, { target: { value: isoOffset(20) } });

    expect(apply).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Дата начала не может быть в будущем');
  });

  it('disables «Применить» when the range exceeds 365 days (ANA-49)', () => {
    renderBar();
    const { from, apply } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(-400) } });

    expect(apply).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Максимальный период — 365 дней (1 год).');
  });

  it('disables «Применить» when a date is missing (ANA-49)', () => {
    renderBar();
    const { from, apply } = openPicker();
    fireEvent.change(from, { target: { value: '' } });

    expect(apply).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите обе даты.');
  });

  it('updates the hint live when an invalid range is fixed (ANA-49)', () => {
    renderBar();
    const { from, to, apply } = openPicker();
    fireEvent.change(from, { target: { value: isoOffset(-1) } });
    fireEvent.change(to, { target: { value: isoOffset(-5) } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(apply).toBeDisabled();

    // Fix the range — the error hint is replaced by the regular one
    fireEvent.change(to, { target: { value: isoOffset(-1) } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(apply).toBeEnabled();
    expect(screen.getByText('Макс. период: 365 дней (1 год)')).toBeInTheDocument();
  });

  it('closes the picker on Escape and returns focus to the toggle (ANA-49)', () => {
    renderBar();
    const toggle = datesToggle();
    fireEvent.click(toggle);
    const from = screen.getByLabelText('Дата начала периода');
    fireEvent.keyDown(from, { key: 'Escape' });

    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('resets custom fields when a preset is chosen (ANA-49)', () => {
    renderBar();
    const { from } = openPicker();
    fireEvent.change(from, { target: { value: '2020-01-01' } });

    // Preset wins over the (invalid) custom fields and closes the picker
    fireEvent.click(presetBtn(30));
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();

    // Reopening shows the applied preset range, not the stale custom input
    fireEvent.click(datesToggle());
    expect(screen.getByLabelText('Дата начала периода')).toHaveValue(useFilters.getState().from);
    expect(screen.getByLabelText('Дата окончания периода')).toHaveValue(useFilters.getState().to);
  });

  it('closes custom date picker on ✕ button click', () => {
    renderBar();
    openPicker();
    expect(screen.getByLabelText('Дата начала периода')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByLabelText('Дата начала периода')).not.toBeInTheDocument();
  });

  it('opens the mobile filter sheet and closes it via «Готово»', () => {
    renderBar();
    // ANA-49: the collapsed trigger carries the current period, hence the regex.
    const trigger = screen.getByRole('button', { name: /Фильтры/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'filter-controls');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByText('Готово'));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the mobile filter sheet via the backdrop', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Фильтры/ }));
    fireEvent.click(screen.getByLabelText('Закрыть фильтры'));
    expect(screen.getByRole('button', { name: /Фильтры/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('FilterBar — partial data coverage (REG-04/ANA-93)', () => {
  afterEach(() => {
    mocks.isAdmin = true;
    mocks.coverageFrom = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10);
    mocks.coverageTables = undefined;
    mocks.sync.mockClear();
    setTestLocale('ru');
  });

  it('warns non-admins that the selected period is partially covered (REG-04)', async () => {
    mocks.isAdmin = false;
    // The cache starts 5 days ago — inside the default 14-day window → partial coverage.
    mocks.coverageFrom = isoOffset(-5);
    renderBar();

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/Данные есть с/);
    expect(banner).toHaveTextContent(/период покрыт частично/);
    // The «Догрузить» action stays admin-only; non-admins get the warning only.
    expect(screen.queryByRole('button', { name: /Догрузить/ })).not.toBeInTheDocument();
  });

  it('admins still get the «Догрузить» action next to the same warning', async () => {
    mocks.isAdmin = true;
    mocks.coverageFrom = isoOffset(-5);
    renderBar();

    expect(await screen.findByRole('status')).toHaveTextContent(/период покрыт частично/);
    expect(screen.getByRole('button', { name: /Догрузить/ })).toBeEnabled();
  });

  it('hides the warning once the cache covers the whole period', async () => {
    renderBar(); // coverage starts 15 days ago — before the default 14-day window
    await act(async () => {}); // let the coverage probe resolve
    // No status banner and no backfill action when the period is fully covered.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Догрузить/ })).not.toBeInTheDocument();
  });

  it('renders the warning without Cyrillic in en', async () => {
    setTestLocale('en');
    mocks.isAdmin = false;
    mocks.coverageFrom = isoOffset(-5);
    const { container } = renderBar();

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/only partially covered/);
    expectNoCyrillic(container);
  });
});

// ANA-153: the Metrika counter was RESET, the real history lives only in SQLite (restored from
// raw_responses). The sync's zero-protection defends those days — the FilterBar says so honestly
// («N дней защищены от перезаписи») using GET /metrics/coverage protectedDays.
describe('FilterBar — zero-protection badge (ANA-153)', () => {
  afterEach(() => {
    mocks.coverageFrom = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10);
    mocks.coverageTables = undefined;
    mocks.protectedDays = undefined;
    setTestLocale('ru');
  });

  it('shows the badge when the backend reports protected days', async () => {
    mocks.protectedDays = 12;
    renderBar();
    await act(async () => {}); // let the coverage probe resolve

    expect(screen.getByText('12 дн. защищены от перезаписи')).toBeInTheDocument();
  });

  it('explains the protection in the tooltip', async () => {
    mocks.protectedDays = 12;
    renderBar();
    await act(async () => {});

    expect(screen.getByText(/защищены от перезаписи/)).toHaveAttribute(
      'title',
      expect.stringContaining('Счётчик Метрики сброшен'),
    );
  });

  it('hides the badge while no days are protected (old backend response or 0)', async () => {
    renderBar(); // protectedDays stays undefined
    await act(async () => {});

    expect(screen.queryByText(/защищены от перезаписи/)).not.toBeInTheDocument();
  });

  it('localises the badge in en', async () => {
    setTestLocale('en');
    mocks.protectedDays = 12;
    const { container } = renderBar();
    await act(async () => {});

    expect(screen.getByText('12 days protected from overwrite')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});

// ANA-139: per-table coverage — utm_stats/geo/pages can stop INSIDE the selected period while
// channel_stats is complete (optional sync steps skipped for days). The FilterBar must say so
// and offer a re-sync of the selected period («допарсить»), otherwise the UTM breakdown looks
// empty while Metrika has the data and nothing in the UI can repair the gap.
describe('FilterBar — stale derived tables (ANA-139)', () => {
  const fullTables = (): Record<string, { from: string; to: string } | null> => ({
    channels: { from: isoOffset(-15), to: today },
    utm: { from: isoOffset(-15), to: today },
    geoDevice: { from: isoOffset(-15), to: today },
    pages: { from: isoOffset(-15), to: today },
    exitPages: { from: isoOffset(-15), to: today },
  });

  afterEach(() => {
    mocks.isAdmin = true;
    mocks.coverageFrom = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10);
    mocks.coverageTables = undefined;
    mocks.sync.mockClear();
    mocks.syncGaps.mockClear();
    mocks.gapsTables = undefined;
    setTestLocale('ru');
  });

  it('warns when utm_stats stops inside the selected period while channels are complete', async () => {
    mocks.coverageTables = {
      ...fullTables(),
      utm: { from: isoOffset(-15), to: isoOffset(-4) },
    };
    renderBar();

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/UTM/);
    expect(banner).toHaveTextContent(/обрываются/);
    expect(screen.getByRole('button', { name: /Догрузить период/ })).toBeEnabled();
  });

  it('the stale-period action refills exactly the gaps, not the whole period', async () => {
    mocks.coverageTables = {
      ...fullTables(),
      utm: { from: isoOffset(-15), to: isoOffset(-4) },
    };
    renderBar();

    fireEvent.click(await screen.findByRole('button', { name: /Догрузить период/ }));
    await act(async () => {});
    // ANA-139 round 2: «допарсить» targets ONLY the missing days (POST /sync/gaps) — the good
    // history inside the period is never re-fetched or rewritten (idempotent refill).
    expect(mocks.syncGaps).toHaveBeenCalledWith({ from: isoOffset(-13), to: today });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('shows the warning without the action for non-admins (REG-04 parity)', async () => {
    mocks.isAdmin = false;
    mocks.coverageTables = {
      ...fullTables(),
      utm: { from: isoOffset(-15), to: isoOffset(-4) },
    };
    renderBar();

    expect(await screen.findByRole('status')).toHaveTextContent(/обрываются/);
    expect(screen.queryByRole('button', { name: /Догрузить период/ })).not.toBeInTheDocument();
  });

  it('renders the warning without Cyrillic in en', async () => {
    setTestLocale('en');
    mocks.isAdmin = false;
    mocks.coverageTables = {
      ...fullTables(),
      utm: { from: isoOffset(-15), to: isoOffset(-4) },
    };
    const { container } = renderBar();

    expect(await screen.findByRole('status')).toHaveTextContent(/stops/);
    expectNoCyrillic(container);
  });

  it('shows no staleness banner while every derived table reaches the selected end', async () => {
    mocks.coverageTables = fullTables();
    renderBar();

    await act(async () => {});
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Догрузить период/ })).not.toBeInTheDocument();
  });

  it('ignores an empty (null) derived table — only a lagging one is stale', async () => {
    mocks.coverageTables = { ...fullTables(), utm: null };
    renderBar();

    await act(async () => {});
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Догрузить период/ })).not.toBeInTheDocument();
  });

  it('surfaces a failed stale-period re-sync next to the banner', async () => {
    mocks.syncGaps.mockRejectedValueOnce(new Error('quota'));
    mocks.coverageTables = {
      ...fullTables(),
      utm: { from: isoOffset(-15), to: isoOffset(-4) },
    };
    renderBar();

    fireEvent.click(await screen.findByRole('button', { name: /Догрузить период/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Не удалось догрузить/);
  });

  // ANA-139 round 2: interior holes — every table reaches the selected end (per-table min/max
  // sees nothing stale) while days INSIDE the period are missing. The gaps probe must surface
  // it, otherwise a failed sync step on an offline day leaves an unrepairable-from-UI hole.
  it('warns about interior holes even when every table reaches the selected end', async () => {
    mocks.coverageTables = fullTables();
    mocks.gapsTables = { utm: [{ from: isoOffset(-8), to: isoOffset(-6) }] };
    renderBar();

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/UTM/);
    expect(banner).toHaveTextContent(/пропуски/);
    expect(screen.getByRole('button', { name: /Догрузить период/ })).toBeEnabled();
  });

  it('the holes action refills exactly the missing days of the period', async () => {
    mocks.coverageTables = fullTables();
    mocks.gapsTables = { utm: [{ from: isoOffset(-8), to: isoOffset(-6) }] };
    renderBar();

    fireEvent.click(await screen.findByRole('button', { name: /Догрузить период/ }));
    await act(async () => {});
    expect(mocks.syncGaps).toHaveBeenCalledWith({ from: isoOffset(-13), to: today });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('localises the holes banner in en', async () => {
    setTestLocale('en');
    mocks.coverageTables = fullTables();
    mocks.gapsTables = { utm: [{ from: isoOffset(-8), to: isoOffset(-6) }] };
    const { container } = renderBar();

    expect(await screen.findByRole('status')).toHaveTextContent(/missing days/);
    expectNoCyrillic(container);
  });

  // ANA-139 round 2 review: a coverage entry present but without a usable `to` (empty string
  // from a half-written backend response) used to fall into the holes branch with an EMPTY
  // table list — «У  есть пропуски внутри выбранного периода» with a double space. The banner
  // is advisory: say nothing rather than an empty claim.
  it('stays silent when a stale table has no usable date and the gaps probe found no holes', async () => {
    mocks.coverageTables = { ...fullTables(), utm: { from: isoOffset(-15), to: '' } };
    mocks.gapsTables = {};
    renderBar();

    await act(async () => {});
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/пропуски/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Догрузить период/ })).not.toBeInTheDocument();
  });

  it('shows no staleness banner when the response carries no tables (older backend)', async () => {
    renderBar();

    await act(async () => {});
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Догрузить период/ })).not.toBeInTheDocument();
  });
});

describe('FilterBar (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders dates, segment hints and the archived toggle without Cyrillic', () => {
    setTestLocale('en');
    const { container } = renderBar();
    expect(screen.getByText(/consumer channels only/)).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
