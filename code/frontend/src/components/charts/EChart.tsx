import ReactECharts from 'echarts-for-react';
import '../../lib/echarts-theme'; // registers the «pca» / «pca-dark» themes (side-effect import)
import { usePrefs } from '../../store/prefs';

/** Цвет текста подписей: тёмная тема — мягкий светлый, светлая — тёмный (регресс 28.10). */
const LABEL_INK: Record<string, string> = { dark: '#d6d6d0', light: '#3d3d37' };

/**
 * Глубокий обход опции: подписям (label / emphasis.label) без явного цвета назначается цвет
 * чернил темы и убирается дефолтная тень/обводка — «жирный белый с тенью» на тёмном фоне
 * нечитаем (регресс 28.10). Явно заданные цвета (подписи внутри цветных стадий воронки)
 * не трогаются. Мутация идемпотентна: option пересобирается билдерами на каждый рендер.
 */
function applyLabelInk(node: unknown, ink: string): void {
  if (Array.isArray(node)) {
    node.forEach((item) => applyLabelInk(item, ink));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const label = obj.label;
  if (
    label &&
    typeof label === 'object' &&
    typeof (label as Record<string, unknown>).color !== 'string'
  ) {
    const l = label as Record<string, unknown>;
    l.color = ink;
    l.fontWeight = 400;
    l.textBorderColor = 'transparent';
    l.textShadowColor = 'transparent';
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') applyLabelInk(value, ink);
  }
}

/** Thin ECharts wrapper so option-building stays in pure, testable functions. Follows day/night theme. */
export function EChart({ option, height = 300 }: { option: object; height?: number }): JSX.Element {
  const theme = usePrefs((s) => s.theme);
  const ink = LABEL_INK[theme] ?? LABEL_INK.light!;
  applyLabelInk(option, ink);
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
