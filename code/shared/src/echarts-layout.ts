/**
 * ECharts 6 ships a new default theme that also moves/resizes components (legend at the bottom,
 * wider grid margins, smaller pie, bigger line symbols). These are the ECharts 5 layout defaults
 * (taken from `echarts/theme/v5.js`, geometry only — no colours) so charts keep their v5 look.
 * Spread into every registered theme (frontend «pca»/«pca-dark», backend report renderer).
 */
export const ECHARTS_V5_LAYOUT = {
  grid: { left: '10%', top: 60, bottom: 70 },
  legend: { top: 0, bottom: null, itemGap: 10 },
  title: { left: 0, top: 0 },
  line: { symbolSize: 4 },
  bar: { defaultBarGap: '20%' },
  pie: { radius: [0, '75%'], labelLine: { length2: 15 } },
  funnel: { bottom: 60 },
  categoryAxis: { axisTick: { show: true } },
};
