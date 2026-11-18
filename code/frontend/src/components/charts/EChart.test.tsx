import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EChart, applyLabelStyle } from './EChart';
import { buildFunnel, funnelOption } from '../../lib/funnel';

// EChart грузит echarts за React.lazy (ANA-41): чарт появляется асинхронно, а реальная
// цепочка echarts-theme → echarts в jsdom импортируется дольше секунды — ждём с таймаутом.
describe('EChart', () => {
  it('renders the (mocked) chart with default and explicit height', async () => {
    render(<EChart option={{}} />);
    render(<EChart option={{ series: [] }} height={200} />);
    // findAllByTestId разрешился бы на первом же чарте — ждём ОБА (второй root может
    // догрузить lazy-модуль чуть позже первого).
    await waitFor(() => expect(screen.getAllByTestId('echart')).toHaveLength(2), {
      timeout: 15000,
    });
  });
});

// ANA-177 review round 2: the funnel builder's series-level label carries an explicit white
// (inside colored trapezoids), while narrow stages take OUTSIDE labels with no color of their
// own. ECharts deep-merges data-item labels over the series label, so unless applyLabelStyle
// paints the per-item nodes with the theme text color, the outside labels would inherit the
// series white onto the white card — the exact «обрезано» symptom being fixed. These tests
// confirm the merged style of the option that actually reaches ECharts.
describe('applyLabelStyle × funnelOption (ANA-177 outside labels)', () => {
  const spread = buildFunnel({
    visits: 2246,
    regOpen: 300,
    cartOpen: 80,
    regStep1: 27,
    payment: 20,
  });

  type Option = {
    series: Array<{
      label: { color: string };
      data: Array<{ label?: { color?: string } }>;
    }>;
  };

  it('light theme: outside labels carry the readable text color, never the series white', () => {
    const option = funnelOption(spread) as Option;
    applyLabelStyle(option, false);
    const series = option.series[0]!;
    // Inside labels stay white on the colored trapezoids — including the value-only label
    // of the mid stage (ANA-177 round 3: 47px trapezoid hosts just the integer)…
    expect(series.label.color).toBe('#ffffff');
    expect(series.data[1]?.label?.color).toBe('#ffffff');
    // …while every outside label is overridden with the light-theme text color.
    for (const i of [2, 3, 4]) {
      expect(series.data[i]?.label?.color).toBe('#3d3d37');
      expect(series.data[i]?.label?.color).not.toBe(series.label.color);
    }
  });

  it('dark theme: outside labels flip with the theme (and match the series white)', () => {
    const option = funnelOption(spread) as Option;
    applyLabelStyle(option, true);
    const series = option.series[0]!;
    for (const i of [2, 3, 4]) expect(series.data[i]?.label?.color).toBe('#ffffff');
  });

  it('leaves wide-stage items without a per-item label untouched', () => {
    const option = funnelOption(buildFunnel({ visits: 100, regOpen: 80 })) as Option;
    applyLabelStyle(option, false);
    const series = option.series[0]!;
    expect(series.data[0]?.label).toBeUndefined();
    expect(series.data[1]?.label).toBeUndefined();
  });
});
