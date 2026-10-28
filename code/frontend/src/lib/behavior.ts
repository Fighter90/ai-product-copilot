import type { PageStat } from '@pca/shared';
import { intTooltip, intBarLabel } from './echart-format';
import { formatPercent } from './format';

export interface PageRow {
  readonly page: string;
  readonly visits: number;
  readonly users: number;
  readonly bounceRate: number;
  readonly goalReaches: number;
  readonly conversionRate: number;
}

/**
 * Aggregate entry-page stats (per-day) by page, highest visits first. bounceRate is visit-weighted
 * across days; conversionRate = reaches / visits. Pure so it is fully unit-testable.
 */
export function pageRows(stats: PageStat[]): PageRow[] {
  const map = new Map<
    string,
    { visits: number; users: number; goalReaches: number; bounceVisits: number }
  >();
  for (const s of stats) {
    const cur = map.get(s.page) ?? { visits: 0, users: 0, goalReaches: 0, bounceVisits: 0 };
    map.set(s.page, {
      visits: cur.visits + s.visits,
      users: cur.users + s.users,
      goalReaches: cur.goalReaches + s.goalReaches,
      bounceVisits: cur.bounceVisits + s.bounceRate * s.visits,
    });
  }
  return [...map.entries()]
    .map(([page, v]) => ({
      page,
      visits: v.visits,
      users: v.users,
      goalReaches: v.goalReaches,
      bounceRate: v.visits === 0 ? 0 : v.bounceVisits / v.visits,
      conversionRate: v.visits === 0 ? 0 : v.goalReaches / v.visits,
    }))
    .sort((a, b) => b.visits - a.visits);
}

/** Shorten a URL to its path for chart labels (drops scheme + host). */
function shortLabel(page: string): string {
  const path = page.replace(/^https?:\/\/[^/]+/, '');
  return path === '' ? '/' : path;
}

/** ECharts horizontal bar: visits per page (top 8), with visits + reaches series (labels from the caller). */
export function pageBarOption(
  rows: PageRow[],
  title: string,
  labels: { visits: string; reaches: string },
): object {
  const top = rows.slice(0, 8).reverse();
  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 13 } },
    tooltip: { trigger: 'axis', ...intTooltip },
    legend: { data: [labels.visits, labels.reaches], bottom: 0 },
    grid: { left: 140, right: 16, top: 32, bottom: 28 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: top.map((r) => shortLabel(r.page)) },
    series: [
      {
        name: labels.visits,
        type: 'bar',
        data: top.map((r) => r.visits),
        label: intBarLabel('right'),
      },
      {
        name: labels.reaches,
        type: 'bar',
        data: top.map((r) => r.goalReaches),
        label: intBarLabel('right'),
      },
    ],
  };
}

/** Percent label for CR axis ticks: one decimal below 5% so small steps stay distinct (ANA-75). */
function pctTick(v: number): string {
  const p = v * 100;
  return `${p.toFixed(p !== 0 && p < 5 ? 1 : 0)}%`;
}

/**
 * ECharts conversion rate bar chart (horizontal) — «Конверсия страниц входа».
 * ANA-75: auto ticks on a sub-percent CR axis rounded to «0% 0% 0% 0% 1% 1%»;
 * minInterval (0.5%) + one-decimal labels keep every tick readable and distinct.
 */
export function crBarOption(rows: PageRow[], title: string): object {
  const top = rows
    .slice(0, 8)
    .filter((r) => r.visits > 20)
    .sort((a, b) => a.conversionRate - b.conversionRate)
    .reverse();
  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 13 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        const p = params[0] as { name: string; value: number };
        return `${p.name}<br/>CR: ${formatPercent(p.value)}`;
      },
    },
    grid: { left: 140, right: 16, top: 32, bottom: 28 },
    xAxis: {
      type: 'value',
      minInterval: 0.005,
      axisLabel: { formatter: pctTick },
    },
    yAxis: { type: 'category', data: top.map((r) => shortLabel(r.page)) },
    series: [
      {
        name: 'CR',
        type: 'bar',
        data: top.map((r) => ({
          value: r.conversionRate,
          itemStyle: {
            color:
              r.conversionRate > 0.02
                ? '#22c55e'
                : r.conversionRate > 0.005
                  ? '#f59e0b'
                  : '#ef4444',
          },
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (v: { value: number }) => formatPercent(v.value),
        },
      },
    ],
  };
}
