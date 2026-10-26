interface Axis {
  data?: unknown[];
  [k: string]: unknown;
}
interface ChartOption {
  legend?: { data?: unknown[]; [k: string]: unknown };
  xAxis?: Axis;
  series?: Array<{ name?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

/**
 * Localise a prebuilt ECharts option without touching its builder: rename the series (and the
 * legend that lists them, index-aligned) and map the x-axis category labels — e.g. raw Metrika
 * channel names → `channelName()`. Returns a new object; the input is not mutated.
 */
export function localizeChart(
  option: object,
  opts: { series?: readonly string[]; category?: (value: string) => string },
): object {
  const o = option as ChartOption;
  const out: ChartOption = { ...o };
  const { series: names, category } = opts;
  if (names && o.series) {
    out.series = o.series.map((s, i) => (names[i] ? { ...s, name: names[i] } : s));
    if (o.legend?.data) out.legend = { ...o.legend, data: names.slice(0, o.legend.data.length) };
  }
  if (category && o.xAxis?.data) {
    out.xAxis = { ...o.xAxis, data: o.xAxis.data.map((v) => category(String(v))) };
  }
  return out;
}
