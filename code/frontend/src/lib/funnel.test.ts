import { describe, it, expect } from 'vitest';
import {
  buildFunnel,
  buildSummaryFunnel,
  funnelOption,
  hasFunnelData,
  valuesFromStages,
  DEFAULT_CHART_WIDTH,
  LABEL_WIDTH,
  OUTSIDE_LABEL_GUTTER,
  type FunnelStage,
} from './funnel';

describe('buildFunnel (ANA-21: per-issue stages)', () => {
  it('builds Визиты → reg_open → cart_open → reg_step1 → Оплата with % of previous', () => {
    const stages = buildFunnel({
      visits: 1000,
      regOpen: 200,
      cartOpen: 50,
      regStep1: 20,
      payment: 5,
    });
    expect(stages.map((s) => [s.key, s.value])).toEqual([
      ['visits', 1000],
      ['reg_open', 200],
      ['cart_open', 50],
      ['reg_step1', 20],
      ['payment', 5],
    ]);
    expect(stages.map((s) => s.fromPrev)).toEqual([1, 0.2, 0.25, 0.4, 0.25]);
  });

  it('uses localized labels when provided, step keys otherwise', () => {
    const labeled = buildFunnel(
      { visits: 10 },
      {
        labels: {
          visits: 'Визиты',
          reg_open: 'Открыли регистрацию',
          cart_open: 'Корзина',
          reg_step1: 'Заказ',
          payment: 'Оплата',
        },
      },
    );
    expect(labeled[0]?.label).toBe('Визиты');
    expect(labeled[1]?.label).toBe('Открыли регистрацию');
    expect(buildFunnel({ visits: 10 })[2]?.label).toBe('cart_open');
  });

  it('falls back to B2B deals paid in the period when the counter has no payment goal', () => {
    // source: 'none' on the payment stage → valuesFromStages drops it → fallback kicks in
    const values = valuesFromStages([
      { key: 'visits', value: 2246 },
      { key: 'reg_open', value: 300 },
      { key: 'cart_open', value: 80 },
      { key: 'reg_step1', value: 27 },
      { key: 'payment', value: 0, source: 'none' },
    ]);
    const stages = buildFunnel(values, { paymentFallback: 20 });
    expect(stages[4]?.value).toBe(20);
  });

  it('renders zeros without NaN: missing values become 0 stages, fromPrev guards divide-by-zero', () => {
    const stages = buildFunnel({});
    expect(stages.map((s) => s.value)).toEqual([0, 0, 0, 0, 0]);
    for (const s of stages) expect(Number.isFinite(s.fromPrev)).toBe(true);
    expect(stages[0]?.fromPrev).toBe(1);
    expect(stages[1]?.fromPrev).toBe(0);
  });

  it('survives a 100× spread between stages (ANA-21 acceptance)', () => {
    const stages = buildFunnel({ visits: 2246, regOpen: 27, cartOpen: 34, regStep1: 20 });
    expect(stages[1]?.fromPrev).toBeCloseTo(27 / 2246);
    expect(stages.every((s) => Number.isFinite(s.fromPrev))).toBe(true);
    expect(hasFunnelData(stages)).toBe(true);
  });

  it('hasFunnelData is false only when every stage is empty', () => {
    expect(hasFunnelData(buildFunnel({}))).toBe(false);
    expect(hasFunnelData(buildFunnel({ visits: 1 }))).toBe(true);
  });
});

describe('buildSummaryFunnel (fallback without live pc-goals data)', () => {
  it('keeps the legacy visits → applications → B2B pipeline → B2B paid path', () => {
    const stages = buildSummaryFunnel(
      { visits: 1000, applications: 100, b2bTickets: 60, b2bPaid: 20 },
      {
        visits: 'Визиты',
        applications: 'Заявки B2C',
        b2bPipeline: 'B2B pipeline',
        b2bPaid: 'Оплачено B2B',
      },
    );
    expect(stages.map((s) => [s.label, s.value])).toEqual([
      ['Визиты', 1000],
      ['Заявки B2C', 100],
      ['B2B pipeline', 60],
      ['Оплачено B2B', 20],
    ]);
    expect(stages[2]?.fromPrev).toBeCloseTo(0.6);
    expect(stages[3]?.fromPrev).toBeCloseTo(20 / 60);
  });

  it('returns 0 conversion when the previous stage is empty (no divide-by-zero)', () => {
    const stages = buildSummaryFunnel(
      { visits: 0, applications: 0, b2bTickets: 0, b2bPaid: 0 },
      { visits: 'В', applications: 'З', b2bPipeline: 'P', b2bPaid: 'О' },
    );
    expect(stages.map((s) => s.value)).toEqual([0, 0, 0, 0]);
    expect(stages[0]?.fromPrev).toBe(1);
    expect(stages[3]?.fromPrev).toBe(0);
    expect(hasFunnelData(stages)).toBe(false);
  });
});

describe('funnelOption', () => {
  it('maps stages to an ECharts funnel series in logical order', () => {
    const option = funnelOption(buildFunnel({ visits: 10 })) as {
      series: { type: string; sort: string; data: { name: string; value: number }[] }[];
    };
    expect(option.series[0]?.type).toBe('funnel');
    expect(option.series[0]?.sort).toBe('none');
    expect(option.series[0]?.data[0]).toEqual({
      name: 'visits',
      value: 10,
      fromPrev: 1,
      isFirst: true,
    });
  });

  it('guards the series max so an all-zero funnel cannot produce NaN sizes (empty white block)', () => {
    const option = funnelOption(buildFunnel({})) as {
      series: { min: number; max: number; minSize: string; data: unknown[] }[];
    };
    expect(option.series[0]?.max).toBe(1); // ≥1 even with all-zero values
    expect(option.series[0]?.min).toBe(0);
    expect(option.series[0]?.minSize).toBe('3%'); // 100×-smaller stages stay visible
    expect(option.series[0]?.data).toHaveLength(5);
  });

  it('scales to the largest stage so a 100× spread renders', () => {
    const option = funnelOption(
      buildFunnel({ visits: 2246, regOpen: 27, cartOpen: 34, regStep1: 20, payment: 20 }),
    ) as { series: { max: number }[] };
    expect(option.series[0]?.max).toBe(2246);
  });

  it('labels carry the absolute value and the share of the previous stage', () => {
    const option = funnelOption(buildFunnel({ visits: 100, regOpen: 25 }), '{pct} от пред.') as {
      series: Array<{ label: { formatter: (p: unknown) => string } }>;
    };
    const out = option.series[0]!.label.formatter({
      name: 'reg_open',
      value: 25,
      data: { fromPrev: 0.25, isFirst: false },
    });
    expect(out).toBe('reg_open\n25 · 25.0% {pct} от пред.');
    const first = option.series[0]!.label.formatter({
      name: 'visits',
      value: 100,
      data: { fromPrev: 1, isFirst: true },
    });
    expect(first).toBe('visits\n100');
  });

  it('keeps stage labels readable: fontSize ≥ 12 with a matching lineHeight (ANA-75 БАГ-10)', () => {
    const option = funnelOption(buildFunnel({ visits: 10 })) as {
      series: Array<{ label: { fontSize: number; lineHeight: number; fontWeight: number } }>;
    };
    expect(option.series[0]?.label.fontSize).toBeGreaterThanOrEqual(12);
    expect(option.series[0]?.label.lineHeight).toBeGreaterThanOrEqual(
      option.series[0]!.label.fontSize + 3,
    );
    expect(option.series[0]?.label.fontWeight).toBeGreaterThanOrEqual(500);
  });

  it('wraps label lines instead of clipping them on narrow stages (ANA-124)', () => {
    // position:'inside' with three lines overflows a narrow stage — overflow:'break' + width
    // makes ECharts break long lines instead of cutting them off.
    const option = funnelOption(buildFunnel({ visits: 10 })) as {
      series: Array<{ label: { overflow: string; width: number } }>;
    };
    expect(option.series[0]?.label.overflow).toBe('break');
    expect(option.series[0]?.label.width).toBeGreaterThan(0);
  });

  // ANA-177 (регресс ANA-124): the fixed 128px inside block cannot fit the bottom stages of a
  // 100×-spread funnel (minSize floor 3%) — it spills over the white card (white-on-white,
  // «обрезано») and collides with the neighbouring stage labels («наложено»). Stages too
  // narrow for the block must take their label outside the trapezoid with a leader line.
  // Round 2: the inside/outside decision is PIXEL-based (stage px width vs the 128px block),
  // and the series reserves a left gutter so the outside block cannot clip at the canvas edge.
  type FunnelData = {
    label?: {
      position?: string;
      align?: string;
      overflow?: string;
      width?: number;
      color?: string;
    };
    labelLine?: { show?: boolean; length?: number; length2?: number };
  };
  const dataOf = (stages: FunnelStage[]): FunnelData[] =>
    (funnelOption(stages) as { series: Array<{ data: FunnelData[] }> }).series[0]?.data ?? [];
  const dataOfAt = (stages: FunnelStage[], widthPx: number): FunnelData[] =>
    (
      funnelOption(stages, 'от пред.', { chartWidthPx: widthPx }) as {
        series: Array<{ data: FunnelData[] }>;
      }
    ).series[0]?.data ?? [];

  describe('narrow stages take outside labels (ANA-177)', () => {
    // Real shape from the issue: visits 2246 → payment 20 (~0.9% of the widest stage).
    const spread = buildFunnel({
      visits: 2246,
      regOpen: 300,
      cartOpen: 80,
      regStep1: 27,
      payment: 20,
    });

    it('moves labels of stages too narrow for the fixed inside block outside, with a leader line', () => {
      const data = dataOf(spread);
      // The widest stage (visits, 100%) still hosts its label inside the trapezoid.
      expect(data[0]?.label).toBeUndefined();
      // The rest of the funnel (13% → 0.9%) cannot fit the 128px block — outside labels,
      // text right-aligned so it hugs the funnel axis, guided by a leader line.
      for (const i of [1, 2, 3, 4]) {
        expect(data[i]?.label?.position).toBe('left');
        expect(data[i]?.label?.align).toBe('right');
        expect(data[i]?.labelLine?.show).toBe(true);
      }
    });

    it('keeps the ANA-124 wrapping on outside labels instead of clipping them', () => {
      const data = dataOf(spread);
      const outside = data[4]?.label;
      expect(outside?.overflow).toBe('break');
      expect(outside?.width).toBeGreaterThan(0);
    });

    it('outside labels carry no explicit color — the EChart theme layer paints them readable', () => {
      // White text beyond the trapezoid is white-on-white («обрезано»); the theme-aware
      // EChart wrapper (applyLabelStyle) colors labels without an explicit color. The merged
      // end-to-end style is pinned in EChart.test.tsx (applyLabelStyle × funnelOption).
      const data = dataOf(spread);
      expect(data[3]?.label?.color).toBeUndefined();
    });

    it('sets the leader-line segments explicitly so the reserved gutter is deterministic', () => {
      // ECharts leaves funnel labelLine lengths undocumented — fixed values are what the
      // OUTSIDE_LABEL_GUTTER math (block + both segments + gap) is built on.
      const data = dataOf(spread);
      expect(data[2]?.labelLine?.length).toBeGreaterThan(0);
      expect(data[2]?.labelLine?.length2).toBeGreaterThan(0);
    });

    it('reserves the left gutter for outside labels so the 128px block cannot clip at the edge', () => {
      const option = funnelOption(spread) as {
        series: Array<{ left?: number; right?: number }>;
      };
      const series = option.series[0];
      expect(series?.left).toBe(OUTSIDE_LABEL_GUTTER);
      // The gutter must fit the whole block plus the leader line — otherwise the same
      // «обрезано» symptom moves from the trapezoid to the canvas edge.
      expect(series?.left).toBeGreaterThan(LABEL_WIDTH);
      expect(series?.right).toBeDefined();
    });

    it('keeps the default funnel layout untouched when every label fits inside', () => {
      // Fully populated and wide at the default canvas (min stage 40% × 366 = 146px ≥ 128):
      // no outside labels → no reserved gutter, series layout stays ECharts' default.
      const option = funnelOption(
        buildFunnel({ visits: 100, regOpen: 80, cartOpen: 60, regStep1: 50, payment: 40 }),
      ) as {
        series: Array<{ left?: number; right?: number }>;
      };
      expect(option.series[0]?.left).toBeUndefined();
      expect(option.series[0]?.right).toBeUndefined();
    });

    it('stays deterministic on a degenerate sub-gutter canvas: the body estimate floors at LABEL_WIDTH', () => {
      // Real canvases are never below the gutter+margin (160px), but the builder must stay
      // sane: its own body math floors at LABEL_WIDTH instead of going negative. NB this
      // floors the ESTIMATE only — the series still receives left: OUTSIDE_LABEL_GUTTER, and
      // rendering a sub-160px canvas is ECharts' job, outside this builder's scope.
      const option = funnelOption(spread, 'от пред.', { chartWidthPx: 100 }) as {
        series: Array<{ data: FunnelData[] }>;
      };
      // The floor lands the widest stage exactly ON LABEL_WIDTH (128 < 128 is false → inside);
      // everything below it takes an outside label. Placement stays fully deterministic.
      expect(option.series[0]?.data[0]?.label).toBeUndefined();
      expect(option.series[0]?.data[4]?.label?.position).toBe('left');
    });
  });

  // ANA-177 round 2: pixel-based threshold — a stage hosts the LABEL_WIDTH block only when its
  // trapezoid is at least 128px wide (share of max × canvas width). The boundary values below
  // calibrate the builder's ESTIMATE — a conservative LOWER bound of the real trapezoid (the
  // minSize '3%' floor renders real trapezoids slightly wider) — at the default canvas:
  // 1749/5000 × 366 = 128.03px (estimate ≥ 128 → inside), 1748/5000 × 366 = 127.95px (1px
  // short of the estimate → outside). Note 1749/5000 = 0.3498 < the old fixed 0.35 fraction:
  // the old fraction-based check mislabeled this stage as narrow on ANY canvas.
  describe('pixel threshold boundary (ANA-177 round 2)', () => {
    const boundaryFunnel = (regOpen: number) =>
      buildFunnel({
        visits: 5000,
        regOpen,
        // every other stage stays wide so ONLY the boundary stage sits on the threshold
        cartOpen: 4500,
        regStep1: 4000,
        payment: 3500,
      });

    it('a stage 1px too short for the block takes the outside label', () => {
      // 1748/5000 × 366px = 127.95px < LABEL_WIDTH (128px) → outside.
      const data = dataOfAt(boundaryFunnel(1748), DEFAULT_CHART_WIDTH);
      expect(data[1]?.label?.position).toBe('left');
      expect(data[2]?.label).toBeUndefined();
      expect(data[3]?.label).toBeUndefined();
      expect(data[4]?.label).toBeUndefined();
    });

    it('a stage just wide enough for the block keeps the inside label', () => {
      // 1749/5000 × 366px = 128.03px ≥ LABEL_WIDTH (128px) → inside, no outside labels.
      const data = dataOfAt(boundaryFunnel(1749), DEFAULT_CHART_WIDTH);
      for (const d of data) expect(d.label).toBeUndefined();
    });

    it('the same widths fit inside on a wide canvas — pixel threshold, not a fixed fraction', () => {
      // On a 900px desktop canvas the boundary stage is ~315px wide — comfortably inside,
      // and no gutter is reserved. (The old 0.35 fraction put it outside regardless.)
      const data = dataOfAt(boundaryFunnel(1748), 900);
      for (const d of data) expect(d.label).toBeUndefined();
      const option = funnelOption(boundaryFunnel(1748), 'от пред.', { chartWidthPx: 900 }) as {
        series: Array<{ left?: number; right?: number }>;
      };
      expect(option.series[0]?.left).toBeUndefined();
      expect(option.series[0]?.right).toBeUndefined();
    });
  });
});
