import { intTooltip } from './echart-format';
import { formatInt, formatPercent } from './format';

export interface FunnelStage {
  /** Localized display label (build* helpers accept `labels`; otherwise the step key). */
  readonly label: string;
  /** Stable step key — mirrors the backend PC_FUNNEL keys (`live/live.ts`). */
  readonly key: string;
  readonly value: number;
  /** Conversion from the previous stage, 0–1. The first stage is always 1 (100%). */
  readonly fromPrev: number;
}

/**
 * Participant funnel steps (ANA-21): Визиты → Открыли регистрацию (`reg_open`) → Корзина
 * (`cart_open`) → Заказ (`reg_step1`) → Оплата. Keys and event names mirror the backend
 * `PC_FUNNEL` (backend `live/live.ts`) so both ends describe the same path.
 */
export type FunnelStepKey = 'visits' | 'reg_open' | 'cart_open' | 'reg_step1' | 'payment';

export const FUNNEL_STEP_KEYS: readonly FunnelStepKey[] = [
  'visits',
  'reg_open',
  'cart_open',
  'reg_step1',
  'payment',
];

/** Per-event values of the participant funnel (pc-goals JS events + the payment stage). */
export interface FunnelValues {
  readonly visits?: number;
  readonly regOpen?: number;
  readonly cartOpen?: number;
  readonly regStep1?: number;
  readonly payment?: number;
}

/** Minimal shape of a stage row produced by GET /api/live/funnel (`LiveFunnel['stages']`). */
export interface FunnelSourceStage {
  readonly key: string;
  readonly value: number;
  /** `'none'` = the stage has no data source in this counter (goal missing, no manual input). */
  readonly source?: string;
}

/** Funnel step labels, localized by the caller. */
export type FunnelLabels = Record<FunnelStepKey, string>;

/**
 * Pick the funnel values out of the live-funnel stages, mapping backend keys to the step keys.
 * Stages with `source: 'none'` are treated as absent so the «Оплата» fallback (B2B deals paid in
 * the period) can kick in.
 */
export function valuesFromStages(stages: readonly FunnelSourceStage[]): FunnelValues {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const val = (key: FunnelStepKey): number | undefined => {
    const s = byKey.get(key);
    if (!s || s.source === 'none') return undefined;
    return s.value;
  };
  return {
    visits: val('visits'),
    regOpen: val('reg_open'),
    cartOpen: val('cart_open'),
    regStep1: val('reg_step1'),
    payment: val('payment'),
  };
}

const fromPrev = (value: number, prev: number): number => (prev > 0 ? value / prev : 0);

/**
 * The per-issue participant funnel (ANA-21): Визиты → reg_open → cart_open → reg_step1 → Оплата.
 * Pure and total: missing values become 0 stages and an empty previous stage yields `fromPrev: 0`
 * (no divide-by-zero), so the chart renders under any data — including zeros and a 100× spread.
 * `paymentFallback` is the B2B part of the issue: when the counter has no payment goal, «Оплата»
 * counts the manually entered B2B deals paid in the period.
 */
export function buildFunnel(
  values: FunnelValues,
  opts: { paymentFallback?: number; labels?: FunnelLabels } = {},
): FunnelStage[] {
  const raw: Array<{ key: FunnelStepKey; value: number }> = [
    { key: 'visits', value: values.visits ?? 0 },
    { key: 'reg_open', value: values.regOpen ?? 0 },
    { key: 'cart_open', value: values.cartOpen ?? 0 },
    { key: 'reg_step1', value: values.regStep1 ?? 0 },
    {
      key: 'payment',
      value: values.payment ?? opts.paymentFallback ?? 0,
    },
  ];
  return raw.map((step, i) => ({
    label: opts.labels?.[step.key] ?? step.key,
    key: step.key,
    value: step.value,
    fromPrev: i === 0 ? 1 : fromPrev(step.value, raw[i - 1]!.value),
  }));
}

/**
 * Fallback for the «Воронка конверсии» chart when the live pc-goals funnel is unavailable
 * (no Metrika token): the cached SQLite totals — visits, B2C goal reaches (заявки), B2B tickets
 * in the pipeline, B2B paid. Same rendering contract as {@link buildFunnel}.
 */
export function buildSummaryFunnel(
  values: { visits: number; applications: number; b2bTickets: number; b2bPaid: number },
  labels: { visits: string; applications: string; b2bPipeline: string; b2bPaid: string },
): FunnelStage[] {
  const raw = [
    { key: 'visits', label: labels.visits, value: values.visits },
    { key: 'applications', label: labels.applications, value: values.applications },
    { key: 'b2b_pipeline', label: labels.b2bPipeline, value: values.b2bTickets },
    { key: 'b2b_paid', label: labels.b2bPaid, value: values.b2bPaid },
  ];
  return raw.map((step, i) => ({
    ...step,
    fromPrev: i === 0 ? 1 : fromPrev(step.value, raw[i - 1]!.value),
  }));
}

/** True when at least one stage carries data — otherwise the block shows the empty state. */
export function hasFunnelData(stages: readonly FunnelStage[]): boolean {
  return stages.some((s) => s.value > 0);
}

/**
 * ECharts funnel option from the computed stages. Robust under any data (ANA-21): the series max
 * is guarded to ≥1 (an all-zero funnel would otherwise produce NaN sizes — the «empty white
 * block»), `minSize` keeps stages that are 100× smaller visible instead of collapsing them to 0,
 * and `sort: 'none'` preserves the logical stage order. Each label carries the absolute value and
 * the share of the previous stage.
 */
// i18n: ignore — legacy default; every production call site passes t('an.fn.funnel.prevShort').
export function funnelOption(stages: FunnelStage[], prevLabel = 'от пред.'): object {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return {
    tooltip: { trigger: 'item', ...intTooltip },
    series: [
      {
        type: 'funnel',
        sort: 'none',
        min: 0,
        max,
        minSize: '3%',
        maxSize: '100%',
        gap: 4,
        label: {
          show: true,
          position: 'inside',
          formatter: (p: {
            name: string;
            value: number;
            data: { fromPrev: number; isFirst: boolean };
          }) =>
            `${p.name}\n${formatInt(p.value)}${
              p.data.isFirst ? '' : ` · ${formatPercent(p.data.fromPrev)} ${prevLabel}`
            }`,
          fontSize: 12,
          fontWeight: 500,
          color: '#ffffff',
          textBorderColor: 'transparent',
          lineHeight: 16,
        },
        data: stages.map((s, i) => ({
          name: s.label,
          value: s.value,
          fromPrev: s.fromPrev,
          isFirst: i === 0,
        })),
      },
    ],
  };
}
