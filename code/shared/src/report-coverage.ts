/**
 * REG-04 (ANA-93): partial data-coverage helpers. The cached DB may start later than the
 * selected period (17 synced days vs a 30д/90д/1г filter) — every surface must say so
 * instead of silently building numbers on incomplete data. Shared by the report sections
 * (DOCX/PDF/screen) and the dashboard (FilterBar / report preview / goals forecast).
 */

/** Cached-data coverage window as returned by the backend `metrics.statsCoverage()`. */
export interface SnapshotCoverage {
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

/** True when the cached data starts inside the selected period (its head has no data). */
export function isPartialCoverage(
  period: { readonly from: string; readonly to: string },
  coverage: SnapshotCoverage,
): boolean {
  return period.from < coverage.from;
}

/** Inclusive day count of a [from, to] ISO-date range (YYYY-MM-DD). */
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

/**
 * Days of the period actually covered by the cache (inclusive intersection, ≥ 1 when partial).
 * The cache may also extend past the period end — only the overlap counts.
 */
export function coveredDaysInPeriod(
  period: { readonly from: string; readonly to: string },
  coverage: SnapshotCoverage,
): number {
  const from = period.from > coverage.from ? period.from : coverage.from;
  const to = period.to < coverage.to ? period.to : coverage.to;
  if (from > to) return 0;
  return periodDays(from, to);
}

/** Last day of the period that has cached data (the coverage window clipped to the period). */
export function coveredToInPeriod(
  period: { readonly from: string; readonly to: string },
  coverage: SnapshotCoverage,
): string {
  return period.to < coverage.to ? period.to : coverage.to;
}

/** «13.10» — short DD.MM date for the coverage line (the year is implied by the period header). */
export function shortDmy(iso: string): string {
  const parts = iso.split('-');
  const m = parts[1];
  const d = parts[2];
  return m && d ? `${d}.${m}` : iso;
}
