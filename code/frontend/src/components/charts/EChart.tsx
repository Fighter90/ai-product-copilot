import ReactECharts from 'echarts-for-react';
import '../../lib/echarts-theme'; // registers the «pca» / «pca-dark» themes (side-effect import)
import { usePrefs } from '../../store/prefs';

/** Thin ECharts wrapper so option-building stays in pure, testable functions. Follows day/night theme. */
export function EChart({ option, height = 300 }: { option: object; height?: number }): JSX.Element {
  const theme = usePrefs((s) => s.theme);
  return (
    <ReactECharts
      key={theme}
      option={option}
      style={{ height }}
      theme={theme === 'dark' ? 'pca-dark' : 'pca'}
      notMerge
      lazyUpdate
    />
  );
}
