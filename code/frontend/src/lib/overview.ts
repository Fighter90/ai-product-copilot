import type { ChannelStat, B2bDeal, PageStat, UtmStat } from '@pca/shared';
import {
  KPI_TARGET_PAID_TICKETS,
  aggregatePeriod,
  normUtm,
  pageKey,
  periodTotals,
  utmKey,
} from '@pca/shared';
import { intTooltip } from './echart-format';
import { channelColor } from './chart-colors';

export interface OverviewKpi {
  readonly target: number;
  readonly applications: number;
  readonly b2bPaid: number;
  /** ANA-19: manually entered / CSV-imported paid B2C tickets for the period. */
  readonly b2cPaid: number;
  /** Total confirmed payments toward the target: B2C paid + B2B paid. */
  readonly paid: number;
  readonly gap: number;
}

/**
 * KPI strip: target (admin «Цель по оплатам», default 300), B2C applications/orders, B2B paid,
 * B2C paid, total paid, gap.
 *
 * ANA-19 «заявка ≠ оплата»: Metrika goals only ever see applications/orders, so «Оплачено»
 * counts CONFIRMED money only — B2C payments entered manually / imported from CSV plus B2B
 * deals in the «paid» stage (`paid = b2cPaid + b2bPaid`). Goal reaches are never payments,
 * whatever goal type the primary goal is. Gap = target − paid (clamped at 0). The payments
 * summary comes from GET /api/payments/summary (the same figure the report shows).
 */
export function summarizeChannels(
  stats: ChannelStat[],
  deals: B2bDeal[] = [],
  goalIsPaid = false,
  target: number = KPI_TARGET_PAID_TICKETS,
  b2cPaid = 0,
): OverviewKpi {
  // applications comes from the single factsource (periodTotals) so the KPI strip, Funnel and Goals
  // headline "Заявки B2C" numbers are guaranteed identical.
  const { applications } = periodTotals(stats);
  const b2bPaid = deals.filter((d) => d.stage === 'paid').reduce((acc, d) => acc + d.tickets, 0);
  const paid = b2cPaid + b2bPaid;
  void goalIsPaid;
  // kept for call compatibility; goal type no longer changes «Оплачено» (ANA-19)
  return {
    target,
    applications,
    b2bPaid,
    b2cPaid,
    paid,
    gap: Math.max(0, target - paid),
  };
}

export interface WeakSpot {
  readonly channel: string;
  readonly visits: number;
  readonly conversionRate: number;
}

/**
 * Weak spots: channels that pull real traffic but convert below the dataset's overall rate — the
 * biggest "leaks" to fix first. Aggregates per channel, keeps those with visits > 0 and a
 * conversion rate below the overall (total reaches / total visits), sorted by visits desc (top 5).
 * Pure and deterministic.
 */
export function weakSpots(stats: ChannelStat[]): WeakSpot[] {
  const map = new Map<string, { visits: number; reaches: number }>();
  let totalVisits = 0;
  let totalReaches = 0;
  for (const s of stats) {
    const cur = map.get(s.channel) ?? { visits: 0, reaches: 0 };
    map.set(s.channel, { visits: cur.visits + s.visits, reaches: cur.reaches + s.goalReaches });
    totalVisits += s.visits;
    totalReaches += s.goalReaches;
  }
  const overallCr = totalVisits === 0 ? 0 : totalReaches / totalVisits;
  return [...map.entries()]
    .map(([channel, v]) => ({
      channel,
      visits: v.visits,
      conversionRate: v.visits === 0 ? 0 : v.reaches / v.visits,
    }))
    .filter((c) => c.visits > 0 && c.conversionRate < overallCr)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 5);
}

/** ECharts pie option: visits by channel. */
export function channelMixOption(stats: ChannelStat[]): object {
  const byChannel = new Map<string, number>();
  for (const s of stats) byChannel.set(s.channel, (byChannel.get(s.channel) ?? 0) + s.visits);
  return {
    tooltip: { trigger: 'item', ...intTooltip },
    legend: { data: [...byChannel.keys()], bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        data: [...byChannel].map(([name, value]) => ({
          name,
          value,
          itemStyle: { color: channelColor(name) },
        })),
      },
    ],
  };
}

/** ECharts line option: daily goal reaches over the period. */
export function dailyReachesOption(stats: ChannelStat[]): object {
  const byDate = new Map<string, number>();
  for (const s of stats) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.goalReaches);
  // Default lexicographic sort on ISO dates (no comparator branch); keys are Map keys, so the
  // lookup is always defined.
  const keys = [...byDate.keys()].sort();
  return {
    tooltip: { trigger: 'axis', ...intTooltip },
    xAxis: { type: 'category', data: keys },
    yAxis: { type: 'value' },
    series: [{ type: 'line', smooth: true, data: keys.map((k) => byDate.get(k) as number) }],
  };
}

/**
 * БАГ-07: top entry/exit pages aggregated by the normalized page key (path without query, one
 * trailing-slash form) before the top-N cut. Metrika page rows arrive per day and per raw URL,
 * so a plain sort+slice shows «/» five times with split numbers instead of one summed row.
 * Visits/users/reaches are summed, bounce is visit-weighted, CR is recomputed by the shared
 * aggregator; the displayed page is the normalized key.
 */
export function topPages(pages: PageStat[], n = 5): PageStat[] {
  return aggregatePeriod(pages, (r) => pageKey(r.page))
    .slice(0, n)
    .map((r) => ({ ...r, page: pageKey(r.page) }));
}

/**
 * БАГ-07: UTM-разбивка aggregated by the normalized key (trim + lowercase per dimension) before
 * the top-N cut, so «tg/post/general» and «TG / Post / General» are one row with summed numbers.
 */
export function topUtmRows(rows: UtmStat[], n = 10): UtmStat[] {
  return aggregatePeriod(rows, (r) => utmKey(r.utmSource, r.utmMedium, r.utmCampaign))
    .slice(0, n)
    .map((r) => ({
      ...r,
      utmSource: normUtm(r.utmSource),
      utmMedium: normUtm(r.utmMedium),
      utmCampaign: normUtm(r.utmCampaign),
    }));
}
