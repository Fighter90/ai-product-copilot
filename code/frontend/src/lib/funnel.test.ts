import { describe, it, expect } from 'vitest';
import {
  buildFunnel,
  buildSummaryFunnel,
  funnelOption,
  hasFunnelData,
  valuesFromStages,
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
});
