import { describe, it, expect } from 'vitest';
import {
  addDaysIso,
  diffDaysIso,
  paceInfo,
  scenarioPace,
  daysToTarget,
  forecastGoal,
  forecastChartOption,
} from './forecast';
import type { DailyPoint } from './trends';

/** Fact point factory: ISO date + visits + goal reaches. */
function p(date: string, visits: number, reaches: number): DailyPoint {
  return { date, visits, reaches };
}

/** Fixture: n identical days (default 1000 visits / 5 reaches per day) starting at `from`. */
function flatDays(n: number, from = '2026-01-01', visits = 1000, reaches = 5): DailyPoint[] {
  return Array.from({ length: n }, (_, i) => p(addDaysIso(from, i), visits, reaches));
}

describe('addDaysIso / diffDaysIso', () => {
  it('adds days across month boundaries (UTC, no DST)', () => {
    expect(addDaysIso('2026-01-30', 2)).toBe('2026-02-01');
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01'); // 2026 is not a leap year
  });

  it('returns the input unchanged for an invalid date', () => {
    expect(addDaysIso('not-a-date', 5)).toBe('not-a-date');
  });

  it('computes whole-day differences in both directions (b − a)', () => {
    expect(diffDaysIso('2026-01-01', '2026-01-10')).toBe(9); // b − a
    expect(diffDaysIso('2026-01-10', '2026-01-01')).toBe(-9);
    expect(diffDaysIso('2026-01-14', '2026-03-01')).toBe(46);
  });

  it('guards division by zero on invalid dates (returns 0)', () => {
    expect(diffDaysIso('nope', '2026-01-01')).toBe(0);
    expect(diffDaysIso('2026-01-01', 'nope')).toBe(0);
  });
});

describe('paceInfo', () => {
  it('averages reaches and visits over the window (linear pace)', () => {
    const r = paceInfo([
      p('2026-01-01', 1000, 10),
      p('2026-01-02', 1000, 0),
      p('2026-01-03', 1000, 6),
      p('2026-01-04', 1000, 4),
    ]);
    expect(r.days).toBe(4);
    expect(r.total).toBe(20);
    expect(r.perDay).toBe(5);
    expect(r.visitsPerDay).toBe(1000);
    expect(r.cr).toBeCloseTo(0.005, 12);
  });

  it('handles a single day of data (window clamped to ≥ 1 day)', () => {
    const r = paceInfo([p('2026-01-01', 100, 3)]);
    expect(r.days).toBe(1);
    expect(r.perDay).toBe(3);
    expect(r.cr).toBeCloseTo(0.03, 12);
  });

  it('guards division by zero on empty input', () => {
    const r = paceInfo([]);
    expect(r.days).toBe(1);
    expect(r.total).toBe(0);
    expect(r.perDay).toBe(0);
    expect(r.visitsPerDay).toBe(0);
    expect(r.cr).toBe(0); // no visits → CR undefined → 0
  });
});

describe('scenarioPace', () => {
  const base = { visitsPerDay: 1000, reachPace: 5, cr: 0.005, trafficPct: 0, crUpliftPp: 0 };

  it('reproduces the baseline pace with both levers at 0', () => {
    expect(scenarioPace(base)).toBeCloseTo(5, 9);
  });

  it('scales pace with extra traffic', () => {
    expect(scenarioPace({ ...base, trafficPct: 50 })).toBeCloseTo(7.5, 9); // 1000 × 1.5 × 0.005
  });

  it('adds conversion uplift in percentage points (not a multiplier)', () => {
    // CR 0.5% + 2 п.п. = 2.5% → 1000 × 0.025 = 25
    expect(scenarioPace({ ...base, crUpliftPp: 2 })).toBeCloseTo(25, 9);
  });

  it('combines both levers multiplicatively', () => {
    // 1000 × 1.2 × (0.005 + 0.01) = 18
    expect(scenarioPace({ ...base, trafficPct: 20, crUpliftPp: 1 })).toBeCloseTo(18, 9);
  });

  it('clamps the conversion at 100% even with a huge uplift', () => {
    // CR 99% + 5 п.п. would exceed 1 → clamped → 1000 × 1 = 1000
    expect(scenarioPace({ ...base, cr: 0.99, crUpliftPp: 5 })).toBeCloseTo(1000, 9);
  });

  it('with zero visits, falls back to scaling the raw pace by traffic only', () => {
    // CR is undefined without traffic — the CR lever cannot apply
    expect(scenarioPace({ ...base, visitsPerDay: 0, trafficPct: 20, crUpliftPp: 3 })).toBeCloseTo(
      6,
      9,
    );
  });
});

describe('daysToTarget', () => {
  it('ceils the remaining gap divided by the pace', () => {
    expect(daysToTarget(300, 100, 10)).toBe(20);
    expect(daysToTarget(300, 100, 7)).toBe(29); // ceil(200/7) = 28.6 → 29
  });

  it('returns 0 when the target is already met', () => {
    expect(daysToTarget(300, 300, 10)).toBe(0);
    expect(daysToTarget(300, 350, 10)).toBe(0);
  });

  it('returns null when the pace is 0 or negative (unreachable)', () => {
    expect(daysToTarget(300, 100, 0)).toBeNull();
    expect(daysToTarget(300, 100, -5)).toBeNull();
  });
});

describe('forecastGoal', () => {
  // 14 flat days × 5/day = 70 total; target 300 → 46 days left at the baseline pace.
  const points = flatDays(14, '2026-01-01'); // window ends 2026-01-14
  const base = { points, to: '2026-01-14', target: 300, trafficPct: 0, crUpliftPp: 0 };

  it('forecasts the baseline date and the 2×-window deadline horizon by default', () => {
    const r = forecastGoal(base);
    expect(r.windowDays).toBe(14);
    expect(r.totalNow).toBe(70);
    expect(r.remaining).toBe(230);
    expect(r.pace).toBeCloseTo(5, 9);
    expect(r.horizonDate).toBe('2026-02-11'); // 2026-01-14 + 28 (2 × 14)
    expect(r.baselineDays).toBe(46);
    expect(r.baselineDate).toBe('2026-03-01');
  });

  it('deviation is positive (behind) when the scenario date lands after the deadline', () => {
    const r = forecastGoal(base);
    expect(r.scenarioDays).toBe(46);
    expect(r.deviationDays).toBe(18); // 46 − 28
    expect(r.projectedAtHorizon).toBeCloseTo(210, 9); // 70 + 5 × 28
  });

  it('recomputes the date under the traffic scenario (+50% → 7.5/day → 31 days)', () => {
    const r = forecastGoal({ ...base, trafficPct: 50 });
    expect(r.scenarioPace).toBeCloseTo(7.5, 9);
    expect(r.scenarioDays).toBe(31); // ceil(230 / 7.5)
    expect(r.scenarioDate).toBe('2026-02-14');
    expect(r.deviationDays).toBe(3);
  });

  it('recomputes the date under the CR scenario (+5 п.п. on a 0.5% CR)', () => {
    // CR 0.5% + 5 п.п. = 5.5% → 1000 × 0.055 = 55/day → 230/55 = 4.18 → 5 days
    const r = forecastGoal({ ...base, crUpliftPp: 5 });
    expect(r.scenarioPace).toBeCloseTo(55, 6);
    expect(r.scenarioDays).toBe(5);
    expect(r.scenarioDate).toBe('2026-01-19');
  });

  it('deviation is negative (ahead) against an explicit far deadline', () => {
    const r = forecastGoal({ ...base, horizonDays: 60 });
    expect(r.horizonDate).toBe('2026-03-15'); // 2026-01-14 + 60
    expect(r.deviationDays).toBe(-14); // 46 − 60
  });

  it('scenario with 0/0 levers equals the baseline', () => {
    const r = forecastGoal(base);
    expect(r.scenarioPace).toBeCloseTo(r.pace, 9);
    expect(r.scenarioDays).toBe(r.baselineDays);
    expect(r.scenarioDate).toBe(r.baselineDate);
  });

  it('is monotonic: more traffic never pushes the date further out', () => {
    const less = forecastGoal({ ...base, trafficPct: 10 });
    const more = forecastGoal({ ...base, trafficPct: 50 });
    expect(more.scenarioDays!).toBeLessThanOrEqual(less.scenarioDays!);
  });

  it('handles 0 orders over the window (pace 0 → unreachable, no dates)', () => {
    const r = forecastGoal({
      points: flatDays(7, '2026-01-01', 1000, 0),
      to: '2026-01-07',
      target: 300,
      trafficPct: 0,
      crUpliftPp: 0,
    });
    expect(r.pace).toBe(0);
    expect(r.baselineDays).toBeNull();
    expect(r.baselineDate).toBeNull();
    expect(r.scenarioDays).toBeNull(); // 0 × 1.0 = 0 even with levers at 0
    expect(r.scenarioDate).toBeNull();
    expect(r.deviationDays).toBeNull();
    expect(r.projectedAtHorizon).toBe(0);
  });

  it('a traffic lever alone cannot rescue a zero-traffic window', () => {
    // No visits at all → CR fallback scales the raw (zero) pace → still unreachable
    const r = forecastGoal({
      points: flatDays(7, '2026-01-01', 0, 0),
      to: '2026-01-07',
      target: 300,
      trafficPct: 50,
      crUpliftPp: 0,
    });
    expect(r.scenarioPace).toBe(0);
    expect(r.scenarioDate).toBeNull();
  });

  it('single day of data: window 1, horizon 2, ceil on the remaining gap', () => {
    const r = forecastGoal({
      points: [p('2026-01-01', 1000, 10)],
      to: '2026-01-01',
      target: 300,
      trafficPct: 0,
      crUpliftPp: 0,
    });
    expect(r.windowDays).toBe(1);
    expect(r.horizonDate).toBe('2026-01-03');
    expect(r.baselineDays).toBe(29); // ceil(290 / 10)
    expect(r.baselineDate).toBe('2026-01-30');
    expect(r.deviationDays).toBe(27); // 29 − 2
  });

  it('marks the goal as reached and anchors dates at the period end', () => {
    const r = forecastGoal({
      points: flatDays(14, '2026-01-01', 1000, 25), // 350 ≥ 300
      to: '2026-01-14',
      target: 300,
      trafficPct: 0,
      crUpliftPp: 0,
    });
    expect(r.reached).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.baselineDays).toBe(0);
    expect(r.scenarioDate).toBe('2026-01-14');
    expect(r.deviationDays).toBe(-28); // 28 days of запас before the deadline
  });
});

describe('forecastChartOption', () => {
  interface ChartOption {
    legend: { data: string[] };
    xAxis: { data: string[] };
    yAxis: { max: number };
    series: Array<{
      name: string;
      data: Array<number | null>;
      lineStyle: { type?: string };
      markLine?: { data: Array<{ yAxis: number }> };
    }>;
  }

  const labels = { fact: 'Факт', forecast: 'Прогноз', target: 'Цель' };

  it('draws cumulative fact + dashed scenario tail ending exactly at the target', () => {
    const opt = forecastChartOption({
      points: [p('2026-01-01', 100, 1), p('2026-01-02', 100, 2), p('2026-01-03', 100, 3)],
      to: '2026-01-03',
      target: 10,
      totalNow: 6,
      scenarioPace: 1,
      scenarioDays: 4,
      horizonDays: 6,
      labels,
    }) as ChartOption;

    expect(opt.xAxis.data).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
    ]);
    const fact = opt.series[0]!;
    const forecast = opt.series[1]!;
    expect(fact.data).toEqual([1, 3, 6]);
    expect(fact.markLine?.data).toEqual([{ yAxis: 10 }]);
    expect(forecast.lineStyle.type).toBe('dashed');
    expect(forecast.data).toEqual([null, null, 6, 7, 8, 9, 10]); // joins the fact, ends at target
    expect(opt.yAxis.max).toBe(11); // ceil(max(fact, tail, target) × 1.05)
    expect(opt.legend.data).toEqual([labels.fact, labels.forecast]);
  });

  it('caps the tail at the horizon when the scenario cannot reach the target', () => {
    const opt = forecastChartOption({
      points: [p('2026-01-01', 100, 5)],
      to: '2026-01-01',
      target: 300,
      totalNow: 5,
      scenarioPace: 1,
      scenarioDays: 295,
      horizonDays: 10,
      labels,
    }) as ChartOption;
    // 1 fact date + 10 tail days (295 > horizon 10)
    expect(opt.xAxis.data).toHaveLength(11);
    const forecast = opt.series[1]!;
    expect(forecast.data).toHaveLength(11);
    expect(forecast.data.at(-1)).toBe(15); // 5 + 1 × 10 — no target jump
    expect(opt.yAxis.max).toBe(315); // ceil(target × 1.05) — markLine keeps the target visible
  });

  it('falls back to a flat zero-baseline chart on empty fact data', () => {
    const opt = forecastChartOption({
      points: [],
      to: '2026-01-31',
      target: 300,
      totalNow: 0,
      scenarioPace: 0,
      scenarioDays: null,
      horizonDays: 4,
      labels,
    }) as ChartOption;
    expect(opt.xAxis.data).toEqual([
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
      '2026-02-03',
      '2026-02-04',
    ]);
    expect(opt.series[0]!.data).toEqual([0]);
    expect(opt.series[1]!.data).toEqual([0, 0, 0, 0, 0]);
    expect(opt.yAxis.max).toBe(315); // ceil(300 × 1.05); Math.max(1,…) guard keeps zero-data sane
  });
});
