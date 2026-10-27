import type { ChannelStat, ReportSnapshot } from '@pca/shared';

/**
 * ANA-39: сравнение двух снапшотов — дельты KPI и каналов между двумя снимками отчёта.
 * Pure arithmetic over immutable snapshots: `a` — старый срез (from), `b` — новый (to).
 * No formatting/localisation here — the History page labels the rows.
 */

/** One comparable value: old → new and the signed delta (to − from). */
export interface DiffValue {
  readonly from: number;
  readonly to: number;
  readonly delta: number;
}

export type KpiDiffKey = 'visits' | 'b2cApplications' | 'b2bPaidTickets' | 'gap';

/** KPI deltas (hist.diff.* labels). `visits` comes from the funnel block (top-of-funnel fact). */
export type KpiDiffRow = { readonly key: KpiDiffKey } & DiffValue;

/** Channel deltas keyed by utmSource|utmMedium; the union of both snapshots' channel rows. */
export interface ChannelDiffRow {
  readonly key: string;
  readonly source: string;
  readonly medium: string;
  readonly visits: DiffValue;
  readonly reaches: DiffValue;
}

export interface SnapshotDiff {
  readonly kpi: ReadonlyArray<KpiDiffRow>;
  /** Sorted by |visits delta| desc, then by key — the movers first. */
  readonly channels: ReadonlyArray<ChannelDiffRow>;
}

const cell = (from: number, to: number): DiffValue => ({ from, to, delta: to - from });

/** Sum a snapshot's per-day channel rows into per-utmSource|utmMedium totals. */
function channelTotals(
  channels: ReadonlyArray<ChannelStat>,
): Map<string, { source: string; medium: string; visits: number; reaches: number }> {
  const map = new Map<
    string,
    { source: string; medium: string; visits: number; reaches: number }
  >();
  for (const c of channels) {
    const source = c.utmSource ?? '(none)';
    const medium = c.utmMedium ?? '(none)';
    const key = `${source}|${medium}`;
    const prev = map.get(key);
    map.set(key, {
      source,
      medium,
      visits: (prev?.visits ?? 0) + c.visits,
      reaches: (prev?.reaches ?? 0) + c.goalReaches,
    });
  }
  return map;
}

export function snapshotDiff(a: ReportSnapshot, b: ReportSnapshot): SnapshotDiff {
  const kpi: ReadonlyArray<KpiDiffRow> = [
    { key: 'visits', ...cell(a.funnel.visits, b.funnel.visits) },
    { key: 'b2cApplications', ...cell(a.kpi.b2cApplications, b.kpi.b2cApplications) },
    { key: 'b2bPaidTickets', ...cell(a.kpi.b2bPaidTickets, b.kpi.b2bPaidTickets) },
    { key: 'gap', ...cell(a.kpi.gap, b.kpi.gap) },
  ];

  // A channel missing from one snapshot compares against 0 (new channel grew from nothing,
  // a dropped one fell to it).
  const ta = channelTotals(a.channels);
  const tb = channelTotals(b.channels);
  const keys = [...new Set([...ta.keys(), ...tb.keys()])];
  const channels = keys
    .map((key) => {
      const va = ta.get(key);
      const vb = tb.get(key);
      return {
        key,
        source: va?.source ?? vb!.source,
        medium: va?.medium ?? vb!.medium,
        visits: cell(va?.visits ?? 0, vb?.visits ?? 0),
        reaches: cell(va?.reaches ?? 0, vb?.reaches ?? 0),
      };
    })
    .sort(
      (x, y) => Math.abs(y.visits.delta) - Math.abs(x.visits.delta) || x.key.localeCompare(y.key),
    );

  return { kpi, channels };
}
