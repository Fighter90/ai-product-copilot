import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// ANA-177 review: correctness of the funnel under resize depends on options being REPLACED
// wholesale on every rebuild — echarts-for-react otherwise deep-merges by key, and a stale
// 152px `left` gutter (or stale position:'left' labels) would survive a resize crossing the
// pixel threshold. EChartInner pins `notMerge`, and echarts-for-react's core.js passes it
// straight into `chart.setOption(option, { notMerge })` on every update (componentDidUpdate →
// updateEChartsOption) — this contract test pins that prop so a future refactor cannot
// silently drop it.
const { captured } = vi.hoisted(() => ({
  captured: [] as Array<Record<string, unknown>>,
}));
vi.mock('echarts-for-react', () => ({
  default: (props: Record<string, unknown>) => {
    captured.push(props);
    return React.createElement('div', { 'data-testid': 'echart-inner' });
  },
}));
import EChartInner from './EChartInner';

describe('EChartInner (ANA-177: wholesale option replacement)', () => {
  it('passes notMerge (+ lazyUpdate) to echarts-for-react so rebuilt options never merge', () => {
    render(<EChartInner option={{ series: [] }} height={360} theme="pca" />);
    const props = captured[captured.length - 1];
    expect(props?.notMerge).toBe(true);
    expect(props?.lazyUpdate).toBe(true);
    expect(props?.style).toEqual({ height: 360 });
    expect(props?.theme).toBe('pca');
  });

  it('hands every rebuild straight to echarts-for-react with notMerge on the update path too', () => {
    captured.length = 0;
    const { rerender } = render(
      <EChartInner option={{ series: [{ type: 'funnel' }] }} height={360} theme="pca-dark" />,
    );
    const first = captured[0];
    rerender(<EChartInner option={{ series: [{ type: 'bar' }] }} height={360} theme="pca-dark" />);
    const second = captured[captured.length - 1];
    // A fresh option object reaches the chart on every rebuild…
    expect(second).not.toBe(first);
    expect((second?.option as { series: Array<{ type: string }> }).series[0]).toEqual({
      type: 'bar',
    });
    // …and the update path keeps notMerge=true — removed keys (e.g. a stale series `left`
    // gutter) cannot survive a resize across the narrow-stage threshold.
    expect(second?.notMerge).toBe(true);
  });
});
