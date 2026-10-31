import { lazy, Suspense } from 'react';
import { usePrefs } from '../../store/prefs';

/**
 * Глубокий обход опции диаграммы (регресс 28.10 — «жирный белый с тенью» нечитаем):
 * - каждой серии гарантированно задаётся label: белый на тёмной теме, тёмный на светлой;
 * - у всех label / emphasis.label принудительно убираются тень и обводка текста
 *   (textBorder/textShadow/shadow — источник «непонятной» обводки);
 * - явно заданные билдером настройки (цвет, formatter, позиция) сохраняются.
 * Мутация идемпотентна: option пересобирается билдерами на каждый рендер.
 */
function applyLabelStyle(node: unknown, dark: boolean): void {
  if (Array.isArray(node)) {
    node.forEach((item) => applyLabelStyle(item, dark));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  if (Array.isArray(obj.series)) {
    for (const serie of obj.series) {
      if (!serie || typeof serie !== 'object') continue;
      const prev = (serie.label && typeof serie.label === 'object' ? serie.label : {}) as Record<
        string,
        unknown
      >;
      serie.label = {
        color: dark ? '#ffffff' : '#3d3d37',
        fontWeight: 400,
        ...prev,
        textBorderColor: 'transparent',
        textBorderWidth: 0,
        textShadowColor: 'transparent',
        textShadowBlur: 0,
        shadowColor: 'transparent',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      };
    }
  }

  const label = obj.label;
  if (label && typeof label === 'object') {
    const l = label as Record<string, unknown>;
    if (typeof l.color !== 'string') l.color = dark ? '#ffffff' : '#3d3d37';
    l.textBorderColor = 'transparent';
    l.textBorderWidth = 0;
    l.textShadowColor = 'transparent';
    l.textShadowBlur = 0;
    l.shadowColor = 'transparent';
    l.shadowBlur = 0;
    l.shadowOffsetX = 0;
    l.shadowOffsetY = 0;
    l.fontWeight = 400;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') applyLabelStyle(value, dark);
  }
}

/**
 * ECharts грузится по требованию (ANA-41): сама библиотека (~1.1MB, gzip ~385KB) живёт за
 * динамическим import() в EChartInner, поэтому routes без графиков её не тянут вовсе, а
 * страницы с графиками сначала рисуют каркас-скелетон нужной высоты (без скачка layout).
 * Экспорт и сигнатура прежние — ни один route менять не нужно.
 */
const EChartInner = lazy(() => import('./EChartInner'));

/** Thin ECharts wrapper so option-building stays in pure, testable functions. Follows day/night theme. */
export function EChart({ option, height = 300 }: { option: object; height?: number }): JSX.Element {
  const theme = usePrefs((s) => s.theme);
  const dark = theme === 'dark';
  applyLabelStyle(option, dark);
  return (
    <Suspense
      fallback={
        <div
          style={{ height }}
          aria-hidden="true"
          className="animate-pulse rounded-lg bg-black/5 dark:bg-white/10"
        />
      }
    >
      {/* key пересоздаёт график при смене темы — как раньше (notMerge через remount) */}
      <EChartInner key={theme} option={option} height={height} theme={dark ? 'pca-dark' : 'pca'} />
    </Suspense>
  );
}
