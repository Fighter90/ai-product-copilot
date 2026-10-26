import { describe, it, expect } from 'vitest';
import { PCA_DARK_THEME, PCA_THEME } from './echarts-theme';

describe('PCA_THEME', () => {
  it('defines a colour palette and transparent background', () => {
    expect(Array.isArray(PCA_THEME.color)).toBe(true);
    expect(PCA_THEME.color.length).toBeGreaterThanOrEqual(3);
    expect(PCA_THEME.color.every((c) => /^#[0-9A-F]{6}$/i.test(c))).toBe(true);
    expect(PCA_THEME.backgroundColor).toBe('transparent');
  });

  it.each([
    ['pca', PCA_THEME],
    ['pca-dark', PCA_DARK_THEME],
  ])('%s keeps the ECharts 5 layout under ECharts 6 (legend on top, v5 grid/pie)', (_, theme) => {
    expect(theme.legend).toMatchObject({ top: 0, bottom: null });
    expect(theme.legend.textStyle.color).toMatch(/^#/);
    expect(theme.grid).toEqual({ left: '10%', top: 60, bottom: 70 });
    expect(theme.pie.radius).toEqual([0, '75%']);
    expect(theme.categoryAxis.axisTick).toEqual({ show: true });
    expect(theme.categoryAxis.axisLabel.color).toMatch(/^#/);
  });
});
