import type { ChannelStat, UtmStat } from '@pca/shared';
import { intTooltip, intBarLabel } from './echart-format';
import { channelColor } from './chart-colors';

/** Segments with UTM coverage below this ratio are flagged (mirrors backend LOW_UTM_COVERAGE_RATIO). */
export const LOW_UTM_COVERAGE_RATIO = 0.7;

export interface ChannelRow {
  readonly channel: string;
  readonly visits: number;
  readonly users: number;
  readonly goalReaches: number;
  readonly conversionRate: number;
}

export interface UtmCoverage {
  readonly withUtm: number;
  readonly withoutUtm: number;
  readonly ratio: number;
  readonly low: boolean;
}

/**
 * UTM coverage = visits with a real UTM source / total channel visits (visit-weighted).
 *
 * The numerator comes from `utm_stats` (which actually carries UTM dimensions), NOT from
 * `channel_stats.utmSource` — the channel query uses a single `lastTrafficSource` dimension, so
 * channel rows have no UTM and a row-count metric would always read ~0% (the M-004 defect).
 * `withUtm`/`withoutUtm` are visit counts; the «(none)»/empty source bucket is excluded.
 */
export function utmCoverage(channels: ChannelStat[], utm: UtmStat[] = []): UtmCoverage {
  const totalVisits = channels.reduce((a, c) => a + c.visits, 0);
  const taggedVisits = utm.reduce(
    (a, u) => (u.utmSource && u.utmSource !== '(none)' ? a + u.visits : a),
    0,
  );
  const withUtm = Math.min(taggedVisits, totalVisits);
  const ratio = totalVisits === 0 ? 0 : withUtm / totalVisits;
  return {
    withUtm,
    withoutUtm: Math.max(0, totalVisits - withUtm),
    ratio,
    low: ratio < LOW_UTM_COVERAGE_RATIO,
  };
}

/**
 * ANA-149: top channels behind the untagged («(none)») UTM traffic — the senior
 * referral/ambassador team reads the low-coverage banner and asks WHERE the untagged
 * visits come from. Channel mix is the honest approximation available: Metrika reports
 * the traffic source category even when no UTM tags were set.
 */
export function untaggedChannelHint(
  channels: ChannelStat[],
  limit = 3,
): Array<{ channel: string; visits: number }> {
  return channelRows(channels)
    .slice(0, limit)
    .map((r) => ({ channel: r.channel, visits: r.visits }));
}

/** Aggregate per channel, highest visits first; conversionRate = reaches / visits. */
export function channelRows(stats: ChannelStat[]): ChannelRow[] {
  const map = new Map<string, { visits: number; users: number; goalReaches: number }>();
  for (const s of stats) {
    const cur = map.get(s.channel) ?? { visits: 0, users: 0, goalReaches: 0 };
    map.set(s.channel, {
      visits: cur.visits + s.visits,
      users: cur.users + s.users,
      goalReaches: cur.goalReaches + s.goalReaches,
    });
  }
  return [...map.entries()]
    .map(([channel, v]) => ({
      channel,
      visits: v.visits,
      users: v.users,
      goalReaches: v.goalReaches,
      conversionRate: v.visits === 0 ? 0 : v.goalReaches / v.visits,
    }))
    .sort((a, b) => b.visits - a.visits);
}

export interface UtmRow {
  readonly source: string;
  readonly medium: string;
  readonly campaign: string;
  readonly visits: number;
  readonly users: number;
  readonly goalReaches: number;
  readonly conversionRate: number;
}

/**
 * Aggregate UTM stats (which arrive per-day) by the source/medium/campaign triple, highest visits
 * first; conversionRate = reaches / visits. Mirrors {@link channelRows} for the UTM table.
 */
export function utmRows(stats: UtmStat[]): UtmRow[] {
  const map = new Map<string, { visits: number; users: number; goalReaches: number }>();
  const keyParts = new Map<string, { source: string; medium: string; campaign: string }>();
  for (const s of stats) {
    const key = `${s.utmSource}\u0000${s.utmMedium}\u0000${s.utmCampaign}`;
    keyParts.set(key, { source: s.utmSource, medium: s.utmMedium, campaign: s.utmCampaign });
    const cur = map.get(key) ?? { visits: 0, users: 0, goalReaches: 0 };
    map.set(key, {
      visits: cur.visits + s.visits,
      users: cur.users + s.users,
      goalReaches: cur.goalReaches + s.goalReaches,
    });
  }
  return [...map.entries()]
    .map(([key, v]) => {
      const parts = keyParts.get(key) as { source: string; medium: string; campaign: string };
      return {
        source: parts.source,
        medium: parts.medium,
        campaign: parts.campaign,
        visits: v.visits,
        users: v.users,
        goalReaches: v.goalReaches,
        conversionRate: v.visits === 0 ? 0 : v.goalReaches / v.visits,
      };
    })
    .sort((a, b) => b.visits - a.visits);
}

/** Truncate a long channel label for the x-axis (full name stays in the tooltip).
 * ANA-75: the 12-char cut read «Прямые захо…»; 24 chars keeps real channel names intact. */
function truncateLabel(value: string): string {
  return value.length > 24 ? `${value.slice(0, 23)}…` : value;
}

/** ECharts bar option: visits by channel. All channels shown; rotated/truncated x labels. */
export function channelBarOption(rows: ChannelRow[]): object {
  return {
    tooltip: { trigger: 'axis', ...intTooltip },
    // ANA-75: containLabel reserves room for the rotated labels so they are not clipped.
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.channel),
      axisLabel: { rotate: 30, interval: 0, formatter: truncateLabel },
    },
    yAxis: { type: 'value', scale: true, splitNumber: 5 },
    series: [
      {
        type: 'bar',
        barMaxWidth: 60,
        data: rows.map((r) => ({ value: r.visits, itemStyle: { color: channelColor(r.channel) } })),
        label: intBarLabel('top'),
      },
    ],
  };
}

/**
 * ECharts grouped-bar option: visits vs goal reaches (applications) per channel, with a legend —
 * shows at a glance which traffic actually converts (the «which traffic brings applications»
 * question). Series labels come from the caller (dict-driven).
 */
export function channelVisitsVsReachesOption(
  rows: ChannelRow[],
  labels: { visits: string; reaches: string },
): object {
  return {
    tooltip: { trigger: 'axis', ...intTooltip },
    legend: { data: [labels.visits, labels.reaches] },
    xAxis: { type: 'category', data: rows.map((r) => r.channel) },
    yAxis: { type: 'value' },
    series: [
      { name: labels.visits, type: 'bar', data: rows.map((r) => r.visits) },
      { name: labels.reaches, type: 'bar', data: rows.map((r) => r.goalReaches) },
    ],
  };
}
