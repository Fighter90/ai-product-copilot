import { describe, it, expect } from 'vitest';
import { contiguousRanges, dayChunks, isIsoDay } from '../../src/utils/date-range';

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

// ANA-139: the sync-gaps refill groups the missing days of the derived stat tables into the
// fewest Metrika windows possible — scattered single-day holes merge into contiguous ranges.
describe('contiguousRanges (ANA-139)', () => {
  it('returns no ranges for an empty day list', () => {
    expect(contiguousRanges([])).toEqual([]);
  });

  it('keeps one day as a single-day range', () => {
    expect(contiguousRanges(['2025-01-05'])).toEqual([{ from: '2025-01-05', to: '2025-01-05' }]);
  });

  it('merges consecutive days into one range and splits a real hole', () => {
    expect(
      contiguousRanges(['2025-01-03', '2025-01-01', '2025-01-02', '2025-01-07', '2025-01-09']),
    ).toEqual([
      { from: '2025-01-01', to: '2025-01-03' },
      { from: '2025-01-07', to: '2025-01-07' },
      { from: '2025-01-09', to: '2025-01-09' },
    ]);
  });

  it('deduplicates a repeated day and tolerates an unsorted input', () => {
    expect(contiguousRanges(['2025-01-02', '2025-01-02', '2025-01-01'])).toEqual([
      { from: '2025-01-01', to: '2025-01-02' },
    ]);
  });

  it('keeps month boundaries as one contiguous range', () => {
    expect(contiguousRanges(['2025-01-31', '2025-02-01'])).toEqual([
      { from: '2025-01-31', to: '2025-02-01' },
    ]);
  });
});

// ANA-139 (round-3 review): a garbage date made statsCoverageGaps iterate zero days, so the gaps
// endpoints answered a clean-looking «всё покрыто» / refilled nothing with 200. The endpoints
// must validate the window BEFORE the repo sees it — hence a strict calendar-day check.
describe('isIsoDay (ANA-139 round-3 review)', () => {
  it('accepts a real YYYY-MM-DD calendar day', () => {
    expect(isIsoDay('2025-01-07')).toBe(true);
    expect(isIsoDay('2024-02-29')).toBe(true); // leap day
  });

  it('rejects garbage, wrong formats and impossible calendar days', () => {
    expect(isIsoDay('not-a-date')).toBe(false);
    expect(isIsoDay('')).toBe(false);
    expect(isIsoDay('07.01.2025')).toBe(false);
    expect(isIsoDay('2025/01/07')).toBe(false);
    expect(isIsoDay('2025-1-7')).toBe(false);
    expect(isIsoDay('2025-13-01')).toBe(false); // month 13
    expect(isIsoDay('2025-02-30')).toBe(false); // 30 February
  });
});
