import { describe, expect, it } from 'vitest';
import { reportPeriodLabel } from './report-period-label';

/**
 * ANA-39 (report-gost-v2 §4): human-readable period label for the report title page.
 * Pure function of `snapshot.period` — no Date.now, no locale-dependent runtime formatting;
 * identical input always produces an identical label (determinism is pinned by the tests below).
 *
 * Format rule (from the change tasks):
 *  - month-aligned period (from = 1st day, to = last day of a month) → «Январь – июнь 2026»;
 *  - single month-aligned month → «Март 2026»;
 *  - month-aligned across years → «Ноябрь 2025 – Февраль 2026»;
 *  - anything else → «01.01.2026 – 04.06.2026» (dd.mm.yyyy);
 *  - unparseable dates degrade deterministically to the raw «from – to» strings.
 */
describe('reportPeriodLabel', () => {
  it('formats a month-aligned multi-month period as «Месяц – месяц ГГГГ»', () => {
    expect(reportPeriodLabel({ from: '2026-01-01', to: '2026-06-30' })).toBe('Январь – июнь 2026');
  });

  it('formats a single month-aligned month without the dash', () => {
    expect(reportPeriodLabel({ from: '2026-03-01', to: '2026-03-31' })).toBe('Март 2026');
  });

  it('names both years for a month-aligned period spanning a year boundary', () => {
    expect(reportPeriodLabel({ from: '2025-11-01', to: '2026-02-28' })).toBe(
      'Ноябрь 2025 – Февраль 2026',
    );
  });

  it('keeps the second month lowercase and the first capitalized', () => {
    const label = reportPeriodLabel({ from: '2026-02-01', to: '2026-05-31' });
    expect(label).toBe('Февраль – май 2026');
  });

  it('formats a mid-month (non-aligned) period as dd.mm.yyyy – dd.mm.yyyy', () => {
    expect(reportPeriodLabel({ from: '2026-01-01', to: '2026-06-04' })).toBe(
      '01.01.2026 – 04.06.2026',
    );
  });

  it('treats a non-day-one start as non-aligned even if the end is a month end', () => {
    expect(reportPeriodLabel({ from: '2026-01-05', to: '2026-06-30' })).toBe(
      '05.01.2026 – 30.06.2026',
    );
  });

  it('is deterministic — same input, same label (no Date.now in the path)', () => {
    const period = { from: '2026-01-01', to: '2026-06-30' };
    expect(reportPeriodLabel(period)).toBe(reportPeriodLabel({ ...period }));
  });

  it('is timezone-independent (UTC parsing, not local midnight)', () => {
    // '2026-01-01' parsed as local time in a negative UTC offset lands on 2025-12-31;
    // the label must still read January–June 2026 everywhere.
    expect(reportPeriodLabel({ from: '2026-01-01', to: '2026-06-30' })).toBe('Январь – июнь 2026');
  });

  it('handles a leap-day end (February of a leap year is month-aligned)', () => {
    expect(reportPeriodLabel({ from: '2024-02-01', to: '2024-02-29' })).toBe('Февраль 2024');
  });

  it('degrades deterministically on an impossible date (non-leap Feb 29)', () => {
    expect(reportPeriodLabel({ from: '2026-02-01', to: '2026-02-29' })).toBe(
      '2026-02-01 – 2026-02-29',
    );
  });

  it('degrades deterministically on an unparseable period', () => {
    expect(reportPeriodLabel({ from: 'TBD', to: '2026-06-30' })).toBe('TBD – 2026-06-30');
  });

  it('degrades deterministically on a calendar-impossible month (13th month passes the shape check)', () => {
    expect(reportPeriodLabel({ from: '2026-13-01', to: '2026-06-30' })).toBe(
      '2026-13-01 – 2026-06-30',
    );
  });

  // ---- EN locale (ANA-42): same deterministic rule, English month names, both capitalized ----
  it('formats a month-aligned range in English with both months capitalized', () => {
    expect(reportPeriodLabel({ from: '2026-01-01', to: '2026-06-30' }, 'en')).toBe(
      'January – June 2026',
    );
  });

  it('formats a single month in English', () => {
    expect(reportPeriodLabel({ from: '2026-03-01', to: '2026-03-31' }, 'en')).toBe('March 2026');
  });

  it('formats a cross-year range in English with both years', () => {
    expect(reportPeriodLabel({ from: '2025-11-01', to: '2026-02-28' }, 'en')).toBe(
      'November 2025 – February 2026',
    );
  });
});
