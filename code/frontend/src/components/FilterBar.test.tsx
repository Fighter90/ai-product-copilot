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
      };
    }
    throw new Error(`unexpected fetch in FilterBar tests: ${path}`);
  },
  api: { sync: async () => ({}) },
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

describe('FilterBar (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders dates, segment hints and the archived toggle without Cyrillic', () => {
    setTestLocale('en');
    const { container } = renderBar();
    expect(screen.getByText(/consumer channels only/)).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
