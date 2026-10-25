import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';

vi.mock('../lib/api', () => ({
  api: {
    listSnapshots: vi.fn(),
  },
}));
import { api } from '../lib/api';
import { HistoryView, History, formatSnapshotName, shortSnapshotId } from './history';

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
});

describe('History (data wrapper)', () => {
  afterEach(() => vi.resetAllMocks());

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
