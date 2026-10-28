import * as echarts from 'echarts';
import { ECHARTS_V5_LAYOUT } from '@pca/shared';
import { METRIC_COLORS } from './chart-colors';

/**
 * ECharts themes «pca» (day) and «pca-dark» (night, productcamp.ru) so every chart shares fonts,
 * axis styling and a default palette. Per-series channel colours are still set explicitly
 * (see chart-colors); this palette is the fallback for series without an explicit colour.
 * ECHARTS_V5_LAYOUT keeps the ECharts 5 component geometry under ECharts 6.
 */
const PALETTE = [
  '#FF4D14',
  METRIC_COLORS.applications,
  METRIC_COLORS.payments,
  METRIC_COLORS.visits,
  METRIC_COLORS.b2bPipeline,
  METRIC_COLORS.gap,
  '#8C8C8C',
];

export const PCA_THEME = {
  ...ECHARTS_V5_LAYOUT,
  color: PALETTE,
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: '#3d3d37' },
  title: { textStyle: { color: '#1a1a1a' } },
  legend: { ...ECHARTS_V5_LAYOUT.legend, textStyle: { color: '#3d3d37' } },
  tooltip: { backgroundColor: '#ffffff', borderColor: '#e4e4e0', textStyle: { color: '#1a1a1a' } },
  axisPointer: { lineStyle: { color: '#a3a39d' } },
  categoryAxis: {
    ...ECHARTS_V5_LAYOUT.categoryAxis,
    axisLine: { lineStyle: { color: '#cfcfca' } },
    axisLabel: { color: '#57574f' },
    splitLine: { lineStyle: { color: '#efefec' } },
  },
  valueAxis: {
    axisLabel: { color: '#57574f' },
    splitLine: { lineStyle: { color: '#e4e4e0' } },
  },
} as const;

export const PCA_DARK_THEME = {
  ...ECHARTS_V5_LAYOUT,
  color: PALETTE,
  backgroundColor: 'transparent',
  // Регресс 28.10: без «жирного белого» — обычное начертание и мягкий оттенок.
  textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: '#d6d6d0', fontWeight: 400 },
  title: { textStyle: { color: '#e8e8e4', fontWeight: 600 } },
  legend: { ...ECHARTS_V5_LAYOUT.legend, textStyle: { color: '#cfcfc9', fontWeight: 400 } },
  tooltip: {
    backgroundColor: '#252525',
    borderColor: '#3b3b3b',
    textStyle: { color: '#e8e8e4', fontWeight: 400 },
  },
  axisPointer: { lineStyle: { color: '#5a5a5a' } },
  categoryAxis: {
    ...ECHARTS_V5_LAYOUT.categoryAxis,
    axisLine: { lineStyle: { color: '#3b3b3b' } },
    axisLabel: { color: '#a8a8a8' },
    splitLine: { lineStyle: { color: '#1d1d1d' } },
  },
  valueAxis: {
    axisLabel: { color: '#a8a8a8' },
    splitLine: { lineStyle: { color: '#2b2b2b' } },
  },
} as const;

echarts.registerTheme('pca', PCA_THEME);
echarts.registerTheme('pca-dark', PCA_DARK_THEME);
