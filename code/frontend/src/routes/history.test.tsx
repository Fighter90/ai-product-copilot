import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { ChannelStat, ReportSnapshot } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

// REG-10: History reads the role from AuthContext — keep it controllable per test.
const session = vi.hoisted(() => ({ isAdmin: false }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ isAdmin: session.isAdmin }),
}));

vi.mock('../lib/api', () => ({
  api: {
    listSnapshots: vi.fn(),
    getSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
  },
}));
import { api } from '../lib/api';
import {
  HistoryView,
  History,
  formatSnapshotName,
  shortSnapshotId,
  periodOverlaps,
  periodDays,
  channelPart,
  authorMatches,
  type SnapshotRow,
} from './history';

describe('formatSnapshotName / shortSnapshotId', () => {
  it('formats same-year period as «Отчёт dd.MM–dd.MM.yyyy»', () => {
    expect(formatSnapshotName('2026-10-12', '2026-10-25')).toBe('Отчёт 12.10–25.10.2026');
  });

  it('formats cross-year period with year on both dates', () => {
    expect(formatSnapshotName('2025-12-25', '2026-01-10')).toBe('Отчёт 25.12.2025–10.01.2026');
  });

  it('falls back to raw input when the date is malformed', () => {
    expect(formatSnapshotName('oops', '2026-10-25')).toBe('Отчёт oops–25.10.2026');
  });

  it('shortens the id with an ellipsis', () => {
    expect(shortSnapshotId('a1b2c3d4e5f6')).toBe('a1b2c3d4…');
  });
});

describe('periodOverlaps (ANA-39: фильтр истории по периоду)', () => {
  const s = { id: 'x', generatedAt: '', dateFrom: '2026-10-01', dateTo: '2026-10-15' };

  it('keeps a snapshot whose period intersects the window', () => {
    expect(periodOverlaps(s, '2026-10-10', '2026-10-20')).toBe(true);
    expect(periodOverlaps(s, '2026-09-01', '2026-10-02')).toBe(true);
    expect(periodOverlaps(s, '2026-10-01', '2026-10-15')).toBe(true); // exact
  });

  it('drops a snapshot entirely before or after the window', () => {
    expect(periodOverlaps(s, '2026-10-16', '2026-10-31')).toBe(false);
    expect(periodOverlaps(s, '2026-09-01', '2026-09-30')).toBe(false);
  });

  it('treats an empty bound as unfiltered on that side', () => {
    expect(periodOverlaps(s, '', '2026-10-10')).toBe(true);
    expect(periodOverlaps(s, '2026-10-10', '')).toBe(true);
    expect(periodOverlaps(s, '', '')).toBe(true);
  });
});

describe('HistoryView', () => {
  it('renders loading state', () => {
    render(<HistoryView status="pending" snapshots={[]} />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<HistoryView status="error" snapshots={[]} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders empty state when no snapshots exist', () => {
    render(<HistoryView status="success" snapshots={[]} />);
    expect(screen.getByText(/Отчётов пока нет/)).toBeInTheDocument();
  });

  it('renders a table of snapshots on success', () => {
    const snapshots = [
      {
        id: 'snap-1',
        generatedAt: '2025-01-01T00:00:00Z',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-07',
      },
    ];
    // Use renderWithProviders since HistoryView now uses Link from react-router-dom
    renderWithProviders(<HistoryView status="success" snapshots={snapshots} />);
    expect(screen.getByText('История отчётов')).toBeInTheDocument();
    // Human-readable identifier instead of the raw UUID.
    expect(screen.getByText('Отчёт 01.01–07.01.2025')).toBeInTheDocument();
    // Truncated id stays visible as secondary traceability text.
    expect(screen.getByText('snap-1…')).toBeInTheDocument();
    // Clicking the name leads to the same snapshot as the action button.
    expect(screen.getByRole('link', { name: 'Отчёт 01.01–07.01.2025' })).toHaveAttribute(
      'href',
      '/app/report?snapshot=snap-1',
    );
    expect(screen.getByText('Всего отчётов: 1')).toBeInTheDocument();
  });

  it('ANA-180: marks the freshest snapshot with the «текущий» badge', () => {
    // Backend lists snapshots by generated_at DESC — the first one is the freshest («current»).
    const snapshots = [
      {
        id: 'snap-new',
        generatedAt: '2025-01-15T00:00:00Z',
        dateFrom: '2025-01-08',
        dateTo: '2025-01-14',
      },
      {
        id: 'snap-old',
        generatedAt: '2025-01-01T00:00:00Z',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-07',
      },
    ];
    renderWithProviders(<HistoryView status="success" snapshots={snapshots} />);
    // Exactly one badge, and it sits in the freshest (first) row.
    const badges = screen.getAllByText('текущий');
    expect(badges).toHaveLength(1);
    const freshestRow = badges[0]?.closest('tr');
    expect(within(freshestRow!).getByText('Отчёт 08.01–14.01.2025')).toBeInTheDocument();
    // The older row carries no badge. Links only — the compare selects repeat the same names.
    const olderRow = screen
      .getAllByRole('link', { name: 'Отчёт 01.01–07.01.2025' })
      .at(0)!
      .closest('tr');
    expect(within(olderRow!).queryByText('текущий')).not.toBeInTheDocument();
  });

  it('ANA-193: shows the plan→fact pinned in each snapshot (Цель / Оплачено)', () => {
    const snapshots = [
      {
        id: 'snap-plan',
        generatedAt: '2026-11-16T00:00:00Z',
        dateFrom: '2026-11-06',
        dateTo: '2026-11-15',
        kpiTarget: 300,
        kpiPaid: 95,
      },
      {
        // Снапшот до миграции 025 — скалярных мет-колонок нет, показываем «—», не нули.
        id: 'snap-legacy',
        generatedAt: '2026-11-01T00:00:00Z',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
        kpiTarget: null,
        kpiPaid: null,
      },
    ];
    renderWithProviders(<HistoryView status="success" snapshots={snapshots} />);
    // Column headers exist (plan fixation and its tracking live right in the history table).
    expect(screen.getByText('Цель')).toBeInTheDocument();
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
    // The fixed plan (300) and the credited paid fact with the share of the target.
    const planRow = screen.getByText('snap-pla…').closest('tr');
    expect(within(planRow!).getByText('300')).toBeInTheDocument();
    expect(within(planRow!).getByText('95')).toBeInTheDocument();
    expect(within(planRow!).getByText('31.7% от цели')).toBeInTheDocument();
    // A pre-ANA-193 snapshot has no meta — «—», never an invented number.
    const legacyRow = screen.getByText('snap-leg…').closest('tr');
    expect(within(legacyRow!).getAllByText('—')).toHaveLength(2);
  });
});

describe('authorMatches (ANA-39: фильтр истории по автору)', () => {
  const s: Pick<SnapshotRow, 'author'> = { author: 'a@x.ru' };

  it('keeps snapshots by the exact author email', () => {
    expect(authorMatches(s, 'a@x.ru')).toBe(true);
    expect(authorMatches(s, 'b@x.ru')).toBe(false);
  });

  it('empty filter keeps everything, including authorless (legacy) snapshots', () => {
    expect(authorMatches(s, '')).toBe(true);
    expect(authorMatches({}, 'a@x.ru')).toBe(false);
    expect(authorMatches({}, '')).toBe(true);
  });
});

describe('HistoryView — author filter (ANA-39)', () => {
  const snapshots = [
    {
      id: 'snap-1',
      generatedAt: '2025-01-01T00:00:00Z',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-07',
      author: 'a@x.ru',
    },
    {
      id: 'snap-2',
      generatedAt: '2025-01-08T00:00:00Z',
      dateFrom: '2025-01-08',
      dateTo: '2025-01-14',
      author: 'b@x.ru',
    },
  ];

  it('shows the author select once any snapshot has an author, and filters by it', () => {
    renderWithProviders(<HistoryView status="success" snapshots={snapshots} />);
    const select = screen.getByRole('combobox', { name: 'Автор' });
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Всего отчётов: 2')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'a@x.ru' } });
    expect(screen.getByText('показано 1 из 2')).toBeInTheDocument();
    // Scope to the table region — the compare panel lists both snapshots by design.
    const table = within(screen.getByRole('region', { name: 'История отчётов' }));
    expect(table.getByText('Отчёт 01.01–07.01.2025')).toBeInTheDocument();
    expect(table.queryByText('Отчёт 08.01–14.01.2025')).not.toBeInTheDocument();
  });

  it('hides the author select when no snapshot has an author (legacy mode)', () => {
    renderWithProviders(
      <HistoryView
        status="success"
        snapshots={[
          {
            id: 'snap-1',
            generatedAt: '2025-01-01T00:00:00Z',
            dateFrom: '2025-01-01',
            dateTo: '2025-01-07',
          },
        ]}
      />,
    );
    expect(screen.queryByRole('combobox', { name: 'Автор' })).not.toBeInTheDocument();
    // Authorless (legacy) rows show «неизвестно» instead of an anonymous dash (БАГ-12).
    expect(screen.getByText('неизвестно')).toBeInTheDocument();
  });
});

describe('periodDays / channelPart (БАГ-12)', () => {
  it('counts the inclusive period length in days', () => {
    expect(periodDays('2026-01-01', '2026-01-07')).toBe(7);
    expect(periodDays('2026-01-01', '2026-01-14')).toBe(14);
    expect(periodDays('2026-01-01', '2026-01-01')).toBe(1);
    expect(periodDays('oops', '2026-01-07')).toBe(0); // malformed dates → 0
  });

  it('maps the internal «(none)» UTM sentinel to an em dash', () => {
    expect(channelPart('(none)')).toBe('—');
    expect(channelPart('ya')).toBe('ya');
  });
});

describe('SnapshotCompare (БАГ-12: сравнение снапшотов)', () => {
  /** Minimal full-snapshot fixture — only the fields snapshotDiff reads. */
  function cmpSnap(id: string, visits: number, channels: ChannelStat[] = []): ReportSnapshot {
    return {
      id,
      generatedAt: '2026-01-01T00:00:00Z',
      period: { from: '2026-01-01', to: '2026-01-07' },
      kpi: { target: 300, b2cApplications: 1, b2bPaidTickets: 0, gap: 300 },
      channels,
      hypotheses: { problems: [], solutions: [] },
      decisions: [],
      b2bSummary: { totalTickets: 0, paidTickets: 0, dealsCount: 0, deals: [], byStage: [] },
      funnel: { visits, b2cApplications: 1, b2bPipelineTickets: 0, b2bPaidTickets: 0 },
      breakdowns: { utm: [], geoDevice: [], entryPages: [], exitPages: [] },
    } as unknown as ReportSnapshot;
  }

  function ch(source: string | null, medium: string | null, visits: number): ChannelStat {
    return {
      date: '2026-01-01',
      channel: `${source}/${medium}`,
      utmSource: source,
      utmMedium: medium,
      utmCampaign: null,
      visits,
      users: visits,
      bounceRate: 0,
      avgDuration: 0,
      goalReaches: 0,
      conversionRate: 0,
    };
  }

  // Backend list order: newest first (generated_at DESC). 14-дневный старый против 7-дневного нового.
  const snapshots: SnapshotRow[] = [
    {
      id: 'snap-new',
      generatedAt: '2026-01-22T00:00:00Z',
      dateFrom: '2026-01-15',
      dateTo: '2026-01-21',
    },
    {
      id: 'snap-old',
      generatedAt: '2026-01-15T00:00:00Z',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-14',
    },
  ];

  afterEach(() => vi.resetAllMocks());

  it('defaults «Старый» to the earlier snapshot and «Новый» to the latest', () => {
    vi.mocked(api.getSnapshot).mockResolvedValue(cmpSnap('x', 0));
    renderWithProviders(<HistoryView status="success" snapshots={snapshots} />);
    expect(screen.getByRole('combobox', { name: 'Старый:' })).toHaveValue('snap-old');
    expect(screen.getByRole('combobox', { name: 'Новый:' })).toHaveValue('snap-new');
  });

  it('warns when the compared periods have different lengths (14 дн. против 7 дн.)', () => {
    vi.mocked(api.getSnapshot).mockResolvedValue(cmpSnap('x', 0));
    renderWithProviders(<HistoryView status="success" snapshots={snapshots} />);
    expect(screen.getByRole('note')).toHaveTextContent('Периоды разной длины: 14 дн. против 7 дн.');
  });

  it('shows no length warning when both periods are equal', () => {
    vi.mocked(api.getSnapshot).mockResolvedValue(cmpSnap('x', 0));
    renderWithProviders(
      <HistoryView
        status="success"
        snapshots={[
          {
            id: 'snap-new',
            generatedAt: '2026-01-15T00:00:00Z',
            dateFrom: '2026-01-08',
            dateTo: '2026-01-14',
          },
          {
            id: 'snap-old',
            generatedAt: '2026-01-08T00:00:00Z',
            dateFrom: '2026-01-01',
            dateTo: '2026-01-07',
          },
        ]}
      />,
    );
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders «—» for channels without UTM data instead of «(none)»', async () => {
    vi.mocked(api.getSnapshot).mockImplementation(async (id) =>
      cmpSnap(id, id === 'snap-new' ? 30 : 10, [ch(null, null, 5)]),
    );
    renderWithProviders(<HistoryView status="success" snapshots={snapshots} />);
    // Канал есть в обоих снапшотах, но без UTM — подпись «— / —», не «(none) / (none)».
    expect(await screen.findByText('— / —')).toBeInTheDocument();
    expect(screen.queryByText('(none) / (none)')).not.toBeInTheDocument();
  });
});

describe('History (data wrapper)', () => {
  afterEach(() => {
    vi.resetAllMocks();
    session.isAdmin = false;
  });

  it('loads and renders snapshots', async () => {
    vi.mocked(api.listSnapshots).mockResolvedValue([
      {
        id: 'snap-1',
        generatedAt: '2025-01-01T00:00:00Z',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-07',
      },
    ]);
    renderWithProviders(<History />);
    expect(await screen.findByText('История отчётов')).toBeInTheDocument();
  });
});

describe('HistoryView — удаление снапшота (REG-10)', () => {
  const snapshots = [
    {
      id: 'snap-1',
      generatedAt: '2025-01-01T00:00:00Z',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-07',
    },
  ];

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    session.isAdmin = false;
  });

  it('hides the delete button for non-admins', () => {
    renderWithProviders(<HistoryView status="success" snapshots={snapshots} />);
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  });

  it('admin: confirm accepted → onDelete fires with the snapshot id', () => {
    session.isAdmin = true;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDelete = vi.fn();
    renderWithProviders(
      <HistoryView status="success" snapshots={snapshots} isAdmin onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(window.confirm).toHaveBeenCalledWith(
      'Удалить Отчёт 01.01–07.01.2025? Действие необратимо.',
    );
    expect(onDelete).toHaveBeenCalledWith('snap-1');
  });

  it('History wrapper: admin deletion calls the API and refreshes the list', async () => {
    session.isAdmin = true;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.listSnapshots).mockResolvedValue(snapshots);
    vi.mocked(api.deleteSnapshot).mockResolvedValue({ ok: true });
    renderWithProviders(<History />);
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.deleteSnapshot).toHaveBeenCalledWith('snap-1'));
    // Инвалидирование ['snapshots'] → список перезагружен после удаления.
    await waitFor(() => expect(api.listSnapshots).toHaveBeenCalledTimes(2));
  });

  it('admin: confirm declined → no deletion', () => {
    session.isAdmin = true;
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDelete = vi.fn();
    renderWithProviders(
      <HistoryView status="success" snapshots={snapshots} isAdmin onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows the error alert when the deletion failed', () => {
    renderWithProviders(
      <HistoryView status="success" snapshots={snapshots} isAdmin onDelete={vi.fn()} deleteError />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось удалить отчёт.');
  });
});

describe('History (EN locale)', () => {
  beforeEach(() => setTestLocale('en'));
  afterEach(() => setTestLocale('ru'));

  it('formats the snapshot name for EN', () => {
    expect(formatSnapshotName('2026-10-12', '2026-10-25', 'en')).toBe('Report 12/10–25/10/2026');
  });

  it('renders every state without Cyrillic', () => {
    const snapshots = [
      {
        id: 'snap-1',
        generatedAt: '2025-01-01T00:00:00Z',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-07',
      },
    ];
    const { container, rerender } = renderWithProviders(
      <HistoryView status="success" snapshots={snapshots} />,
    );
    expect(screen.getByText('Report history')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Report 01/01–07/01/2025' })).toBeInTheDocument();
    expect(screen.getByText('Total reports: 1')).toBeInTheDocument();
    expect(screen.getByText('1 Jan 2025 — 7 Jan 2025')).toBeInTheDocument();
    expectNoCyrillic(container);

    for (const status of ['pending', 'error'] as const) {
      rerender(<HistoryView status={status} snapshots={[]} />);
      expectNoCyrillic(container);
    }
    rerender(<HistoryView status="success" snapshots={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('No reports yet');
    expectNoCyrillic(container);
  });
});
