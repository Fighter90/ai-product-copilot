import type { B2bDeal, B2cPayment } from '@pca/shared';

/**
 * ANA-72: historical data integrity — the customer's chat flagged «разрыв в 7 дней» in the B2B
 * leads and B2C payments (and KPI/forecasts going wrong without the pre-launch history). This
 * module scans the three manual/event series for holes and reports them so the UI can show what
 * still needs a backfill import.
 */

export type GapKind = 'b2b_added' | 'b2b_paid' | 'b2c_payments';

export interface DataGap {
  kind: GapKind;
  /** Last date with data before the hole. */
  from: string;
  /** First date with data after the hole. */
  to: string;
  /** Missing calendar days between `from` and `to` (exclusive). */
  missingDays: number;
}

export interface DataCoverage {
  /** The synced Metrika window (ANA-49 statsCoverage), if anything was synced at all. */
  metrika: { from: string; to: string; days: number } | null;
  b2b: { firstAdded: string | null; lastAdded: string | null; count: number };
  b2c: { first: string | null; last: string | null; count: number };
  /** Holes of ≥ MIN_GAP_DAYS missing days inside a series' own span. */
  gaps: DataGap[];
}

/** A hole must miss at least this many calendar days to be reported (the chat saw 7). */
export const MIN_GAP_DAYS = 3;

const DAY = 86_400_000;

/** Distinct sorted ISO dates of one series. */
function eventDates(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}

/** Holes of ≥ MIN_GAP_DAYS missing days between consecutive event dates. */
export function findGaps(kind: GapKind, dates: string[]): DataGap[] {
  const sorted = eventDates(dates.filter(Boolean));
  const gaps: DataGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    const missing = Math.round((new Date(next).getTime() - new Date(prev).getTime()) / DAY) - 1;
    if (missing >= MIN_GAP_DAYS) gaps.push({ kind, from: prev, to: next, missingDays: missing });
  }
  return gaps;
}

/**
 * Full coverage picture over already-loaded data. Pure — the route feeds it from the repos, so
 * it is trivially testable and has no DB dependency of its own.
 */
export function dataCoverage(
  metrika: { from: string; to: string; days: number } | null,
  b2b: B2bDeal[],
  b2c: B2cPayment[],
): DataCoverage {
  const added = b2b.map((d) => d.dateAdded).filter(Boolean);
  const paid = b2b.map((d) => d.datePaid ?? '').filter(Boolean);
  const b2cDays = b2c.map((p) => p.date);

  return {
    metrika,
    b2b: {
      firstAdded: added[0] ?? null,
      lastAdded: added.at(-1) ?? null,
      count: b2b.length,
    },
    b2c: {
      first: b2cDays[0] ?? null,
      last: b2cDays.at(-1) ?? null,
      count: b2c.length,
    },
    gaps: [
      ...findGaps('b2b_added', added),
      ...findGaps('b2b_paid', paid),
      ...findGaps('b2c_payments', b2cDays),
    ].sort((a, b) => a.from.localeCompare(b.from)),
  };
}
