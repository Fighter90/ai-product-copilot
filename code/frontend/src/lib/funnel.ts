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

/** Width (px) the full label block (name + value + «% от пред.») wraps at — ANA-124. */
export const LABEL_WIDTH = 128;

/**
 * Minimum trapezoid width (px) that reliably hosts a VALUE-only label inside: a formatted
 * integer is at most 5 glyphs (~38px at fontSize 12) plus a small padding.
 */
export const INSIDE_VALUE_MIN = 44;

/**
 * Chart width (px) assumed when the caller cannot measure the real container — the narrowest
 * realistic funnel card (mobile). ANA-177 review: the label-tier decision is pixel-based
 * (stage trapezoid width vs the label tiers), so callers should pass the measured canvas
 * width via `funnelOption(..., { chartWidthPx })` when available; this default keeps pure
 * call sites deterministic.
 */
export const DEFAULT_CHART_WIDTH = 366;

/**
 * Leader-line segments (px) for outside labels — set explicitly because ECharts leaves the
 * funnel `labelLine` defaults undocumented, and {@link OUTSIDE_LABEL_GUTTER} is computed
 * from them.
 */
const LEADER_LENGTH = 6;
const LEADER_LENGTH2 = 8;

/** Right margin (px) between the funnel body and the canvas edge when outside labels are on. */
const OUTSIDE_RIGHT_MARGIN = 8;

/**
 * Horizontal room (px) reserved to the LEFT of the funnel body when a stage takes an outside
 * VALUE label: the ≤38px value + both leader-line segments + a small breathing gap. ANA-177
 * round 3: outside labels are value-only (a formatted integer — one short token, nothing to
 * wrap), so the gutter is sized for a value, not for the 128px block.
 */
export const OUTSIDE_LABEL_GUTTER = INSIDE_VALUE_MIN + LEADER_LENGTH + LEADER_LENGTH2 + 4;

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
 * and `sort: 'none'` preserves the logical stage order.
 *
 * Label tiers (ANA-177 round 3 — the previous 128px wrap-block broke WORDS mid-word on narrow
 * stages and stacked 3–5 lines over the trapezoids on every real funnel, which is always a
 * 10–100× spread). The trapezoid width ESTIMATE — (3% + share × 97%) of the body, the exact
 * `minSize`-floor formula and a conservative LOWER bound of the real trapezoid — picks a tier:
 * - trapezoid ≥ {@link LABEL_WIDTH}: full block inside (name + value + «% от пред.»), wrapped
 *   at 128px — only wide stages get it, their words stay word-boundary breaks;
 * - trapezoid ≥ {@link INSIDE_VALUE_MIN}: VALUE-only inside (a formatted integer is one short
 *   token — nothing to wrap, white on the colored trapezoid);
 * - otherwise: VALUE-only outside left with a leader line (theme paints the color — white
 *   text would be white-on-white; pinned in EChart.test.tsx × applyLabelStyle).
 * Stage names and conversions stay available in the DOM stage list under the chart and the
 * tooltip, so the value-only canvas labels lose no information.
 *
 * When any stage goes outside, the series reserves {@link OUTSIDE_LABEL_GUTTER} on the left
 * (plus {@link OUTSIDE_RIGHT_MARGIN} on the right) and the body shrinks accordingly —
 * re-checked after shrinking, since narrower bodies can push mid stages under
 * {@link INSIDE_VALUE_MIN} too.
 */
// i18n: ignore — legacy default; every production call site passes t('an.fn.funnel.prevShort').
export function funnelOption(
  stages: FunnelStage[],
  prevLabel = 'от пред.',
  opts: { chartWidthPx?: number } = {},
): object {
  const max = Math.max(1, ...stages.map((s) => s.value));
  const canvasWidth = opts.chartWidthPx ?? DEFAULT_CHART_WIDTH;
  // Trapezoid-width estimate: with minSize:'3%' ECharts renders the trapezoid at
  // (3% + share × 97%) of the body — a conservative LOWER bound of the real width.
  const trapezoid = (share: number, body: number): number => (0.03 + share * 0.97) * body;
  // Pass 1 over the full canvas: does ANY stage need an outside (value) label? That decides
  // whether the body shrinks to make room for the left gutter.
  const hasOutsideLabel = stages.some(
    (s) => trapezoid(s.value / max, canvasWidth) < INSIDE_VALUE_MIN,
  );
  // Pass 2 on the (possibly shrunk) body: shrinking can push mid stages under the threshold.
  // The floor guards degenerate canvases narrower than the gutter itself.
  const bodyWidth = hasOutsideLabel
    ? Math.max(LABEL_WIDTH, canvasWidth - OUTSIDE_LABEL_GUTTER - OUTSIDE_RIGHT_MARGIN)
    : canvasWidth;
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
        ...(hasOutsideLabel
          ? {
              // Explicit px layout: outside labels + leader lines extend to the LEFT of each
              // trapezoid — reserve the gutter for them.
              left: OUTSIDE_LABEL_GUTTER,
              right: OUTSIDE_RIGHT_MARGIN,
            }
          : {}),
        label: {
          show: true,
          position: 'inside',
          // Full tier (wide stages only): name + value + share of the previous stage.
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
          // ANA-124: break long lines at `width` px instead of clipping them (overflow only
          // works with a width). Wide stages only; their words stay word-boundary breaks.
          overflow: 'break',
          width: LABEL_WIDTH,
        },
        data: stages.map((s, i) => {
          const tier = trapezoid(s.value / max, bodyWidth);
          // ANA-177 round 3: narrow stages carry a VALUE-only label — one short token,
          // impossible to wrap mid-word (the root cause of the round-1/2 regressions).
          const valueFormatter = (): string => formatInt(s.value);
          return {
            name: s.label,
            value: s.value,
            fromPrev: s.fromPrev,
            isFirst: i === 0,
            ...(tier < INSIDE_VALUE_MIN
              ? {
                  // Outside: no explicit color — applyLabelStyle paints the theme text
                  // color (white would be white-on-white; pinned in EChart.test.tsx).
                  label: { position: 'left', formatter: valueFormatter },
                  // Explicit segments — OUTSIDE_LABEL_GUTTER is computed from these exact
                  // values (ECharts leaves the funnel labelLine defaults undocumented).
                  labelLine: { show: true, length: LEADER_LENGTH, length2: LEADER_LENGTH2 },
                }
              : tier < LABEL_WIDTH
                ? {
                    // Inside, value-only: explicit white — the trapezoid behind is colored,
                    // and applyLabelStyle must not flip this label to the theme text color.
                    label: { formatter: valueFormatter, color: '#ffffff' },
                  }
                : {}),
          };
        }),
      },
    ],
  };
}
