import { describe, it, expect } from 'vitest';
import type { PageStat } from '@pca/shared';
import { pageRows, pageBarOption, crBarOption } from './behavior';

const page = (over: Partial<PageStat>): PageStat => ({
  date: '2025-01-01',
  page: '/lp',
  visits: 10,
  users: 9,
  bounceRate: 0.2,
  goalReaches: 1,
  conversionRate: 0.1,
  ...over,
});

describe('pageRows', () => {
  it('aggregates by page, visit-weights bounce rate, sorts by visits desc, guards zero visits', () => {
    const rows = pageRows([
      page({ page: '/lp', visits: 10, goalReaches: 1, bounceRate: 0.5 }),
      page({ page: '/lp', visits: 30, goalReaches: 2, bounceRate: 0.1 }),
      page({ page: '/pricing', visits: 5, goalReaches: 1, bounceRate: 0.4 }),
      page({ page: '/empty', visits: 0, goalReaches: 0, bounceRate: 0 }),
    ]);
    expect(rows[0]?.page).toBe('/lp');
    expect(rows[0]?.visits).toBe(40);
    // visit-weighted bounce: (0.5*10 + 0.1*30) / 40 = 0.2
    expect(rows[0]?.bounceRate).toBeCloseTo(0.2);
    expect(rows[0]?.conversionRate).toBeCloseTo(3 / 40);
    const empty = rows.find((r) => r.page === '/empty');
    expect(empty?.bounceRate).toBe(0);
    expect(empty?.conversionRate).toBe(0);
  });
});

describe('pageRows (ANA-178 — дубли URL не агрегированы)', () => {
  it('collapses scheme/host/query variants of one path into a single summed row', () => {
    const rows = pageRows([
      page({ page: 'https://productcamp.ru/', visits: 27820, bounceRate: 0.2, goalReaches: 100 }),
      page({ page: 'https://productcamp.ru', visits: 4, bounceRate: 1, goalReaches: 0 }),
      page({ page: 'http://productcamp.ru/', visits: 3, bounceRate: 1, goalReaches: 0 }),
      page({ page: 'https://www.productcamp.ru/', visits: 2, bounceRate: 1, goalReaches: 0 }),
      page({ page: '/?utm_source=tg', visits: 6, bounceRate: 1, goalReaches: 0 }),
      page({ page: '/', visits: 1, bounceRate: 1, goalReaches: 0 }),
      page({ page: 'https://productcamp.ru/about', visits: 5, bounceRate: 0.4, goalReaches: 1 }),
      page({ page: 'https://www.productcamp.ru/about/', visits: 3, bounceRate: 0, goalReaches: 0 }),
      page({ page: '/about', visits: 7, bounceRate: 0.2, goalReaches: 2 }),
    ]);
    // На проде «/» приезжала 6 отдельными строками (https/apex, https, http, www, query, path),
    // ломая топы и «Итого»; каждая группа дублей схлопывается в одну строку пути.
    expect(rows.filter((r) => r.page === '/')).toHaveLength(1);
    expect(rows.find((r) => r.page === '/')?.visits).toBe(27836);
    expect(rows.filter((r) => r.page === '/about')).toHaveLength(1);
    expect(rows.find((r) => r.page === '/about')?.visits).toBe(15);
    expect(rows.find((r) => r.page === '/about')?.goalReaches).toBe(3);
  });
});

describe('pageBarOption', () => {
  it('shortens full URLs to their path, maps host-only URLs to "/", builds visits + reaches bars', () => {
    const rows = pageRows([
      page({ page: 'https://productcamp.ru/reg-new', visits: 70, goalReaches: 30 }),
      page({ page: 'https://productcamp.ru', visits: 40, goalReaches: 2 }), // host only → '/'
      page({ page: '/program', visits: 10, goalReaches: 1 }), // already a path
    ]);
    const o = pageBarOption(rows, 'Входы', { visits: 'Визиты', reaches: 'Заявки' }) as {
      title: { text: string };
      yAxis: { data: string[] };
      series: { name: string; data: number[] }[];
    };
    expect(o.title.text).toBe('Входы');
    // reversed (largest at top): /program(10), '/'(40), /reg-new(70)
    expect(o.yAxis.data).toEqual(['/program', '/', '/reg-new']);
    expect(o.series[0]?.name).toBe('Визиты');
    expect(o.series[1]?.data).toEqual([1, 2, 30]);
  });
});

describe('crBarOption (ANA-75: readable CR axis ticks)', () => {
  const row = (page: string, conversionRate: number) => ({
    page,
    visits: 100,
    users: 0,
    bounceRate: 0,
    goalReaches: conversionRate * 100,
    conversionRate,
  });

  it('keeps sub-percent ticks distinct (minInterval + one-decimal formatter, no «0% 0% 0%»)', () => {
    const o = crBarOption(
      [row('/a', 0.003), row('/b', 0.01), row('/c', 0.015)],
      'Конверсия страниц входа',
    ) as {
      xAxis: { minInterval: number; axisLabel: { formatter: (v: number) => string } };
      yAxis: { data: string[] };
      series: { data: { value: number; itemStyle: { color: string } }[] }[];
    };
    expect(o.xAxis.minInterval).toBe(0.005);
    const f = o.xAxis.axisLabel.formatter;
    const ticks = [0, 0.005, 0.01, 0.015, 0.02].map(f);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(f(0)).toBe('0%');
    expect(f(0.005)).toBe('0.5%');
    expect(f(0.1)).toBe('10%');
    // top-8 rows with >20 visits, sorted by CR desc
    expect(o.yAxis.data).toEqual(['/c', '/b', '/a']);
    expect(o.series[0]?.data.map((d) => d.value)).toEqual([0.015, 0.01, 0.003]);
  });

  it('filters low-traffic pages and colors bars by CR thresholds', () => {
    const o = crBarOption(
      [
        { ...row('/low', 0.5), visits: 10 }, // below the 20-visit cut-off
        row('/hot', 0.05),
        row('/warm', 0.01),
      ],
      'CR',
    ) as { series: { data: { itemStyle: { color: string } }[] }[] };
    expect(o.series[0]?.data.map((d) => d.itemStyle.color)).toEqual(['#22c55e', '#f59e0b']);
  });
});
