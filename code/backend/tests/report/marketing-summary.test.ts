import { describe, it, expect } from 'vitest';
import type { MarketingCell } from '@pca/shared';
import { MARKETING_METRICS } from '../../src/marketing/definitions';
import { buildMarketingSummary } from '../../src/report/marketing-summary';

const cell = (
  weekStart: string,
  metricKey: string,
  value: number,
  extra: Partial<MarketingCell> = {},
): MarketingCell => ({
  weekStart,
  metricKey,
  value,
  source: 'manual',
  updatedAt: 'T',
  ...extra,
});

const RANGE = { from: '2026-08-01', to: '2026-08-20' };

describe('buildMarketingSummary', () => {
  it('returns undefined with no cells at all', () => {
    expect(buildMarketingSummary([], RANGE)).toBeUndefined();
  });

  it('returns undefined when no cell intersects the report period', () => {
    const cells = [cell('2026-08-01', 'tg_clicks', 120), cell('2026-10-05', 'ambassadors', 3)];
    expect(buildMarketingSummary(cells, { from: '2025-01-01', to: '2025-01-07' })).toBeUndefined();
  });

  it('sums per metric over the weeks intersecting the period and counts contributing weeks', () => {
    const cells = [
      cell('2026-08-01', 'tg_clicks', 120), // week 1–7 → inside
      cell('2026-08-08', 'tg_clicks', 80), // week 8–14 → inside
      cell('2026-08-15', 'tg_clicks', 10), // week 15–23 → partial overlap
      cell('2026-08-24', 'tg_clicks', 999), // week 24–30 → outside
    ];
    const summary = buildMarketingSummary(cells, RANGE);
    expect(summary).toBeDefined();
    expect(summary?.weeks.map((w) => w.key)).toEqual(['2026-08-01', '2026-08-08', '2026-08-15']);
    const tg = summary?.byMetric.find((m) => m.metricKey === 'tg_clicks');
    expect(tg).toMatchObject({
      metricKey: 'tg_clicks',
      total: 210,
      weeks: 3,
      section: 'content',
    });
    // Catalog labels ride along for the report/AI rendering.
    expect(tg?.labelRu).toBe(MARKETING_METRICS.find((m) => m.key === 'tg_clicks')?.ru);
  });

  it('excludes demo cells — a real report never mixes seed data into the totals', () => {
    const cells = [
      cell('2026-08-01', 'ambassadors', 99, { isDemo: true }),
      cell('2026-08-01', 'ambassadors', 2),
    ];
    const summary = buildMarketingSummary(cells, RANGE);
    const amb = summary?.byMetric.find((m) => m.metricKey === 'ambassadors');
    expect(amb).toMatchObject({ total: 2, weeks: 1 });
  });

  it('treats an unknown weekStart as a single-day week and includes it only when in the period', () => {
    const cells = [cell('2026-08-05', 'referrals_clicks', 7)];
    const inside = buildMarketingSummary(cells, RANGE);
    expect(inside?.weeks).toEqual([{ key: '2026-08-05', start: '2026-08-05', end: '2026-08-05' }]);
    expect(inside?.byMetric).toHaveLength(1);
    const outside = buildMarketingSummary([cell('2026-09-10', 'referrals_clicks', 7)], RANGE);
    expect(outside).toBeUndefined();
  });

  it('keeps catalog metric order and appends unknown metric keys sorted, bucketed as «other»', () => {
    const cells = [
      cell('2026-08-01', 'zz_custom', 1),
      cell('2026-08-01', 'aa_custom', 2),
      cell('2026-08-01', 'payments', 5),
      cell('2026-08-01', 'landings_visits', 400),
    ];
    const summary = buildMarketingSummary(cells, RANGE);
    expect(summary?.byMetric.map((m) => m.metricKey)).toEqual([
      'landings_visits',
      'payments',
      'aa_custom',
      'zz_custom',
    ]);
    expect(summary?.byMetric[0]?.section).toBe('content');
    expect(summary?.byMetric[2]?.section).toBe('other');
  });

  it('keeps a metric whose only contributing value is 0 (a real «0 posts» fact)', () => {
    const summary = buildMarketingSummary([cell('2026-08-01', 'posts_total', 0)], RANGE);
    expect(summary?.byMetric).toEqual([
      {
        metricKey: 'posts_total',
        labelRu: 'сколько вышло общих постов',
        labelEn: 'Posts published (total)',
        section: 'content',
        total: 0,
        weeks: 1,
      },
    ]);
  });

  it('is deterministic — same cells yield an identical summary', () => {
    const cells = [cell('2026-08-01', 'tg_clicks', 120), cell('2026-08-08', 'partner_posts', 3)];
    expect(JSON.stringify(buildMarketingSummary(cells, RANGE))).toBe(
      JSON.stringify(buildMarketingSummary(cells, RANGE)),
    );
  });
});
