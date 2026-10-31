import ReactECharts from 'echarts-for-react';
import '../../lib/echarts-theme'; // registers the «pca» / «pca-dark» themes (side-effect import)

/**
 * Реальный mount ECharts (ANA-41). Живёт за динамическим import() в EChart.tsx, поэтому
 * ~1.1MB библиотека (gzip ~385KB) грузится только когда график действительно рендерится:
 * routes без графиков не тянут её вовсе, а страницы с графиками рисуют каркас сразу.
 */
export default function EChartInner({
  option,
  height,
  theme,
}: {
  option: object;
  height: number;
  theme: 'pca' | 'pca-dark';
}): JSX.Element {
  return <ReactECharts option={option} style={{ height }} theme={theme} notMerge lazyUpdate />;
}
