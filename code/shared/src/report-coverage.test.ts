import { describe, it, expect } from 'vitest';
import {
  coveredDaysInPeriod,
  coveredToInPeriod,
  isPartialCoverage,
  periodDays,
  shortDmy,
  type SnapshotCoverage,
} from './report-coverage';

const period = { from: '2025-10-01', to: '2025-10-30' };

// REG-04 (ANA-93): 17 synced days (13.10–29.10) inside a 30-day period.
const partial: SnapshotCoverage = { from: '2025-10-13', to: '2025-10-29', days: 17 };

describe('report-coverage (REG-04/ANA-93)', () => {
  it('isPartialCoverage — true only when the cache starts inside the period', () => {
    expect(isPartialCoverage(period, partial)).toBe(true);
    expect(isPartialCoverage(period, { from: '2025-09-01', to: '2025-10-29', days: 59 })).toBe(
      false,
    );
    // Coverage starting exactly on the period's first day is complete, not partial.
    expect(isPartialCoverage(period, { from: '2025-10-01', to: '2025-10-29', days: 29 })).toBe(
      false,
    );
  });

  it('coveredDaysInPeriod — the inclusive intersection of the period and the cache', () => {
    expect(coveredDaysInPeriod(period, partial)).toBe(17);
    // The cache extends past the period end — only the overlap counts.
    expect(coveredDaysInPeriod(period, { from: '2025-10-13', to: '2025-11-15', days: 34 })).toBe(
      18,
    );
    // Disjoint windows have zero covered days.
    expect(coveredDaysInPeriod(period, { from: '2025-11-01', to: '2025-11-20', days: 20 })).toBe(0);
    // Fully covered period counts every day.
    expect(coveredDaysInPeriod(period, { from: '2025-09-15', to: '2025-11-01', days: 48 })).toBe(
      30,
    );
  });

  it('periodDays — inclusive day count', () => {
    expect(periodDays('2025-10-01', '2025-10-30')).toBe(30);
    expect(periodDays('2025-10-13', '2025-10-29')).toBe(17);
    expect(periodDays('2025-10-13', '2025-10-13')).toBe(1);
  });

  it('coveredToInPeriod — the last covered day clipped to the period', () => {
    expect(coveredToInPeriod(period, partial)).toBe('2025-10-29');
    expect(coveredToInPeriod(period, { from: '2025-10-13', to: '2025-11-15', days: 34 })).toBe(
      '2025-10-30',
    );
  });

  it('shortDmy — «13.10» for the coverage line', () => {
    expect(shortDmy('2025-10-13')).toBe('13.10');
    expect(shortDmy('2025-01-07')).toBe('07.01');
  });
});
