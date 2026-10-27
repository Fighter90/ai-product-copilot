import { describe, it, expect } from 'vitest';
import type { ChannelStat, ReportSnapshot } from '@pca/shared';
import { snapshotDiff } from './snapshot-diff';

/** Minimal channel-row fixture (per-day ChannelStat row). */
function ch(
  source: string | null,
  medium: string | null,
  visits: number,
  reaches: number,
): ChannelStat {
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
    goalReaches: reaches,
    conversionRate: 0,
  };
}

/** Minimal snapshot fixture: only the fields the diff reads. */
function snap(
  kpi: { b2cApplications: number; b2bPaidTickets: number; gap: number },
  visits: number,
  channels: ChannelStat[],
): ReportSnapshot {
  return {
    id: 'x',
    generatedAt: '2026-01-01T00:00:00Z',
    period: { from: '2026-01-01', to: '2026-01-07' },
    kpi: { target: 300, ...kpi },
    channels,
    hypotheses: { problems: [], solutions: [] },
    decisions: [],
    b2bSummary: { totalTickets: 0, paidTickets: 0, dealsCount: 0, deals: [], byStage: [] },
    funnel: { visits, b2cApplications: 0, b2bPipelineTickets: 0, b2bPaidTickets: 0 },
    breakdowns: { utm: [], geoDevice: [], entryPages: [], exitPages: [] },
  } as unknown as ReportSnapshot;
}

describe('snapshotDiff (ANA-39: сравнение двух снапшотов)', () => {
  it('computes signed deltas for the KPI rows (old → new)', () => {
    const a = snap({ b2cApplications: 100, b2bPaidTickets: 20, gap: 280 }, 5000, []);
    const b = snap({ b2cApplications: 120, b2bPaidTickets: 35, gap: 265 }, 6000, []);
    const d = snapshotDiff(a, b);
    expect(d.kpi.map((r) => r.key)).toEqual(['visits', 'b2cApplications', 'b2bPaidTickets', 'gap']);
    expect(d.kpi[0]).toMatchObject({ from: 5000, to: 6000, delta: 1000 });
    expect(d.kpi[2]).toMatchObject({ from: 20, to: 35, delta: 15 });
    expect(d.kpi[3]!.delta).toBe(-15); // the gap shrank
  });

  it('aggregates per-day rows per utmSource|utmMedium before diffing', () => {
    const a = snap({ b2cApplications: 0, b2bPaidTickets: 0, gap: 0 }, 0, [
      ch('ya', 'cpc', 60, 3),
      ch('ya', 'cpc', 40, 2),
      ch('tg', 'post', 40, 2),
    ]);
    const b = snap({ b2cApplications: 0, b2bPaidTickets: 0, gap: 0 }, 0, [
      ch('ya', 'cpc', 150, 8),
      ch('vk', 'ads', 60, 1),
    ]);
    const d = snapshotDiff(a, b);
    // Sorted by |visits delta| desc: +50, +60, −40 → vk, ya, tg.
    expect(d.channels.map((c) => c.key)).toEqual(['vk|ads', 'ya|cpc', 'tg|post']);
    const ya = d.channels.find((c) => c.key === 'ya|cpc')!;
    expect(ya.visits).toEqual({ from: 100, to: 150, delta: 50 }); // 60+40 aggregated
    expect(ya.reaches).toEqual({ from: 5, to: 8, delta: 3 });
    // vk appeared after the old snapshot; tg disappeared — both compare against 0.
    expect(d.channels.find((c) => c.key === 'vk|ads')!.visits).toEqual({
      from: 0,
      to: 60,
      delta: 60,
    });
    expect(d.channels.find((c) => c.key === 'tg|post')!.visits).toEqual({
      from: 40,
      to: 0,
      delta: -40,
    });
  });

  it('sorts channels by absolute visits delta desc (movers first)', () => {
    const a = snap({ b2cApplications: 0, b2bPaidTickets: 0, gap: 0 }, 0, [
      ch('small', 'm', 10, 0),
      ch('big', 'm', 10, 0),
    ]);
    const b = snap({ b2cApplications: 0, b2bPaidTickets: 0, gap: 0 }, 0, [
      ch('small', 'm', 15, 0),
      ch('big', 'm', 210, 0),
    ]);
    const d = snapshotDiff(a, b);
    expect(d.channels[0]!.key).toBe('big|m');
  });

  it('treats null UTM as an "(none)" channel bucket', () => {
    const d = snapshotDiff(
      snap({ b2cApplications: 0, b2bPaidTickets: 0, gap: 0 }, 0, [ch(null, null, 10, 1)]),
      snap({ b2cApplications: 0, b2bPaidTickets: 0, gap: 0 }, 0, [ch(null, null, 25, 3)]),
    );
    expect(d.channels).toHaveLength(1);
    expect(d.channels[0]).toMatchObject({ key: '(none)|(none)', source: '(none)' });
    expect(d.channels[0]!.visits.delta).toBe(15);
  });

  it('returns empty channels when neither snapshot has any', () => {
    const d = snapshotDiff(
      snap({ b2cApplications: 1, b2bPaidTickets: 0, gap: 0 }, 1, []),
      snap({ b2cApplications: 2, b2bPaidTickets: 0, gap: 0 }, 2, []),
    );
    expect(d.channels).toEqual([]);
    expect(d.kpi[0]!.delta).toBe(1);
  });
});
