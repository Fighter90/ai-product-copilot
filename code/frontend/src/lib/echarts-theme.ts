import * as echarts from 'echarts';
import { METRIC_COLORS } from './chart-colors';

/**
 * ECharts themes «pca» (day) and «pca-dark» (night, productcamp.ru) so every chart shares fonts,
 * axis styling and a default palette. Per-series channel colours are still set explicitly
 * (see chart-colors); this palette is the fallback for series without an explicit colour.
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
  color: PALETTE,
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: '#3d3d37' },
  title: { textStyle: { color: '#1a1a1a' } },
  legend: { textStyle: { color: '#3d3d37' } },
  tooltip: { backgroundColor: '#ffffff', borderColor: '#e4e4e0', textStyle: { color: '#1a1a1a' } },
  axisPointer: { lineStyle: { color: '#a3a39d' } },
  categoryAxis: {
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
  color: PALETTE,
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: '#c8c8c8' },
  title: { textStyle: { color: '#ffffff' } },
  legend: { textStyle: { color: '#c8c8c8' } },
  tooltip: { backgroundColor: '#252525', borderColor: '#3b3b3b', textStyle: { color: '#ffffff' } },
  axisPointer: { lineStyle: { color: '#5a5a5a' } },
  categoryAxis: {
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
