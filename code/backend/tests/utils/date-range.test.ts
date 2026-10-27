import { describe, it, expect } from 'vitest';
import { dayChunks } from '../../src/utils/date-range';

describe('dayChunks', () => {
  it('splits any multi-day range into per-day chunks (short windows too)', () => {
    // Per-day is required for correctness: single-dimension breakdowns have no ym:s:date in the
    // response, so a whole-window request would stamp every row with the window's first date and
    // collapse 7 days of data onto day 1 (reconciliation ANA-65 finding №7).
    expect(dayChunks('2025-01-01', '2025-01-07')).toHaveLength(7);
    expect(dayChunks('2025-01-01', '2025-01-07')[0]).toEqual({
      from: '2025-01-01',
      to: '2025-01-01',
    });
    expect(dayChunks('2025-01-01', '2025-01-07')[6]).toEqual({
      from: '2025-01-07',
      to: '2025-01-07',
    });
  });

  it('splits a >7-day range into per-day chunks', () => {
    const chunks = dayChunks('2025-01-01', '2025-01-15');
    expect(chunks).toHaveLength(15);
    expect(chunks[0]).toEqual({ from: '2025-01-01', to: '2025-01-01' });
    expect(chunks[14]).toEqual({ from: '2025-01-15', to: '2025-01-15' });
  });

  it('keeps a single day as one chunk', () => {
    expect(dayChunks('2025-01-01', '2025-01-01')).toEqual([
      { from: '2025-01-01', to: '2025-01-01' },
    ]);
  });
});
