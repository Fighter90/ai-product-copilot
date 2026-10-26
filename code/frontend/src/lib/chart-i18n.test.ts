import { describe, it, expect } from 'vitest';
import { localizeChart } from './chart-i18n';

describe('localizeChart', () => {
  const option = {
    legend: { data: ['Визиты', 'Заявки'] },
    xAxis: { type: 'category', data: ['Direct traffic', 'podcast'] },
    series: [
      { name: 'Визиты', data: [1] },
      { name: 'Заявки', data: [2] },
    ],
  };

  it('renames series + legend and maps x-axis categories without mutating the input', () => {
    const out = localizeChart(option, {
      series: ['Visits', 'Applications'],
      category: (v) => v.toUpperCase(),
    }) as typeof option;
    expect(out.series.map((s) => s.name)).toEqual(['Visits', 'Applications']);
    expect(out.legend.data).toEqual(['Visits', 'Applications']);
    expect(out.xAxis.data).toEqual(['DIRECT TRAFFIC', 'PODCAST']);
    expect(option.series[0]!.name).toBe('Визиты');
  });

  it('keeps names beyond the provided list and options without legend/axis data', () => {
    const out = localizeChart(
      { series: [{ name: 'a' }, { name: 'b' }] },
      { series: ['A'], category: (v) => v },
    ) as { series: Array<{ name: string }>; legend?: unknown; xAxis?: unknown };
    expect(out.series.map((s) => s.name)).toEqual(['A', 'b']);
    expect(out.legend).toBeUndefined();
    expect(out.xAxis).toBeUndefined();
    expect(localizeChart({ xAxis: { type: 'value' } }, {})).toEqual({ xAxis: { type: 'value' } });
  });
});
