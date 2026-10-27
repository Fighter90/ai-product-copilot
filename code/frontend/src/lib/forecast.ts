import { clampRatio } from '@pca/shared';
import { intTooltip } from './echart-format';
import { METRIC_COLORS } from './chart-colors';
import type { DailyPoint } from './trends';

/**
 * ANA-50 «Цели и „Что если“»: линейный прогноз достижения KPI-цели по дневным достижениям цели.
 * All math is pure and side-effect free so it is fully unit-testable (forecast.test.ts) and the
 * KPI page stays a thin UI over these functions.
 *
 * Model: pace = цель-достижения за окно / дней в окне (linear rate, orders/day). A scenario scales
 * traffic (±%) and shifts conversion by percentage points, then the same linear model is re-run.
 * The deadline («дедлайн») is parameterised: by default 2× the fact window after the period end,
 * because the app does not track the event date anywhere.
 */

const DAY_MS = 86_400_000;

/** ISO date (YYYY-MM-DD) + n days → ISO date. UTC arithmetic, no DST pitfalls. */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a); negative when `a` is after `b`; 0 for invalid dates. */
export function diffDaysIso(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.round(ms / DAY_MS);
}

export interface PaceInfo {
  /** Days in the fact window (≥ 1, so a single day of data still yields a pace). */
  readonly days: number;
  /** Total goal reaches over the window. */
  readonly total: number;
  /** Linear pace: total / days (orders per day). */
  readonly perDay: number;
  /** Visits per day over the same window (for the CR lever). */
  readonly visitsPerDay: number;
  /** Baseline conversion: reaches / visits (0 when the window has no visits). */
  readonly cr: number;
}

/** Collapse daily fact points into the linear-pace summary. Empty input → a 1-day zero window. */
export function paceInfo(points: DailyPoint[]): PaceInfo {
  const days = Math.max(points.length, 1);
  const total = points.reduce((acc, p) => acc + p.reaches, 0);
  const visits = points.reduce((acc, p) => acc + p.visits, 0);
  return {
    days,
    total,
    perDay: total / days,
    visitsPerDay: visits / days,
    cr: visits > 0 ? total / visits : 0,
  };
}

/**
 * ANA-50: темп по последним `days` (по умолчанию 7) дням факта — «текущий темп» reacts to a
 * recent acceleration/slowdown that a whole-period linear pace smooths away. Fewer points than
 * the window → whatever fact exists (≥ 1 day, same guard as {@link paceInfo}).
 */
export function recentPaceInfo(points: DailyPoint[], days = 7): PaceInfo {
  return paceInfo(points.slice(Math.max(points.length - days, 0)));
}

export interface ScenarioInput {
  /** Baseline visits per day. */
  readonly visitsPerDay: number;
  /** Baseline orders per day (the pace the scenario replaces). */
  readonly reachPace: number;
  /** Baseline conversion reaches/visits (0..1). */
  readonly cr: number;
  /** Extra traffic, percent (0..50 on the UI slider). */
  readonly trafficPct: number;
  /** Conversion uplift in percentage points (0..5 on the UI slider), added to the ratio. */
  readonly crUpliftPp: number;
}

/**
 * Orders/day under the scenario: visits/day × (1 + traffic%) × clamp(CR + п.п.).
 * With both levers at 0 this reproduces the baseline pace exactly (visitsPerDay × cr = reachPace).
 * When the window has no visits, CR is undefined — the raw pace is scaled by traffic only.
 */
export function scenarioPace(input: ScenarioInput): number {
  const { visitsPerDay, reachPace, cr, trafficPct, crUpliftPp } = input;
  if (visitsPerDay <= 0) return reachPace * (1 + trafficPct / 100);
  const newCr = clampRatio(cr + crUpliftPp / 100);
  return visitsPerDay * (1 + trafficPct / 100) * newCr;
}

/**
 * Days needed to close the gap to `target` at `pace` orders/day.
 * Already at/over target → 0; non-positive pace → null (unreachable); otherwise ceil(remaining/pace).
 */
export function daysToTarget(target: number, current: number, pace: number): number | null {
  const remaining = target - current;
  if (remaining <= 0) return 0;
  if (pace <= 0) return null;
  return Math.ceil(remaining / pace);
}

export interface ForecastInput {
  /** Daily fact (visits + goal reaches), sorted by ISO date — `dailySeries(channels)` works. */
  readonly points: DailyPoint[];
  /** Period end (ISO date) — the anchor for forecast dates. */
  readonly to: string;
  /** KPI target (paid tickets). */
  readonly target: number;
  /** Scenario lever: extra traffic, percent. */
  readonly trafficPct: number;
  /** Scenario lever: conversion uplift, percentage points. */
  readonly crUpliftPp: number;
  /** Deadline horizon in days after `to`; default 2× the fact window (no event date in the app). */
  readonly horizonDays?: number;
}

export interface ForecastResult {
  readonly windowDays: number;
  /** Total reaches over the fact window (= current progress). */
  readonly totalNow: number;
  /** Baseline pace (orders/day) — the «текущий темп» over the whole fact window. */
  readonly pace: number;
  /** ANA-50: linear pace over the last 7 days of the window (see {@link recentPaceInfo}). */
  readonly recentPace: number;
  /**
   * ANA-50: требуемый дневной темп к дедлайну — remaining / days until the deadline.
   * Null when the target is already reached (0 needed) or the deadline has passed.
   */
  readonly requiredPace: number | null;
  /** Orders/day under the scenario. */
  readonly scenarioPace: number;
  /** Target − totalNow, floored at 0. */
  readonly remaining: number;
  /** True when totalNow already meets the target. */
  readonly reached: boolean;
  /** Days after `to` to reach the target at the baseline pace (null = unreachable). */
  readonly baselineDays: number | null;
  readonly baselineDate: string | null;
  /** Days after `to` to reach the target at the scenario pace (null = unreachable). */
  readonly scenarioDays: number | null;
  readonly scenarioDate: string | null;
  /** Deadline: `to` + horizonDays (default 2× window). */
  readonly horizonDate: string;
  /**
   * scenarioDate − horizonDate in days: negative = ahead of the deadline (запас),
   * positive = behind it (отставание). Null when the scenario never reaches the target.
   */
  readonly deviationDays: number | null;
  /** Cumulative orders by the deadline under the scenario (1 decimal). */
  readonly projectedAtHorizon: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Full «что если» forecast: linear pace from the fact window, scenario re-run, deadline comparison.
 * Deterministic — same input, same dates — so the UI can recompute it on every slider move.
 */
export function forecastGoal(input: ForecastInput): ForecastResult {
  const { points, to, target, trafficPct, crUpliftPp, horizonDays } = input;
  const pace = paceInfo(points);
  const horizon = horizonDays ?? pace.days * 2;
  const horizonDate = addDaysIso(to, horizon);
  const sp = scenarioPace({
    visitsPerDay: pace.visitsPerDay,
    reachPace: pace.perDay,
    cr: pace.cr,
    trafficPct,
    crUpliftPp,
  });
  const reached = pace.total >= target;
  const baselineDays = daysToTarget(target, pace.total, pace.perDay);
  const scenarioDays = daysToTarget(target, pace.total, sp);
  // Required daily pace to close the gap exactly by the deadline (0 days left → null).
  const daysToLeft = Math.max(diffDaysIso(to, horizonDate), 0);
  const requiredPace =
    reached || daysToLeft === 0 ? null : Math.max(0, target - pace.total) / daysToLeft;
  return {
    windowDays: pace.days,
    totalNow: pace.total,
    pace: pace.perDay,
    recentPace: recentPaceInfo(points).perDay,
    requiredPace,
    scenarioPace: sp,
    remaining: Math.max(0, target - pace.total),
    reached,
    baselineDays,
    baselineDate: baselineDays === null ? null : addDaysIso(to, baselineDays),
    scenarioDays,
    scenarioDate: scenarioDays === null ? null : addDaysIso(to, scenarioDays),
    horizonDate,
    deviationDays: scenarioDays === null ? null : scenarioDays - horizon,
    projectedAtHorizon: round1(pace.total + sp * horizon),
  };
}

const FORECAST_ACCENT = '#FF4D14'; // theme accent (see lib/echarts-theme) for the scenario line

export interface ForecastChartInput {
  /** Daily fact (visits + reaches), sorted by ISO date. */
  readonly points: DailyPoint[];
  /** Period end (ISO date) — forecast tail starts the day after. */
  readonly to: string;
  /** KPI target — the horizontal markLine. */
  readonly target: number;
  /** Cumulative fact at `to` (normally totalNow from {@link forecastGoal}). */
  readonly totalNow: number;
  /** Orders/day of the currently selected scenario. */
  readonly scenarioPace: number;
  /** Days after `to` until the scenario hits the target (null = never → tail capped at horizon). */
  readonly scenarioDays: number | null;
  /** Tail cap in days (the deadline horizon). */
  readonly horizonDays: number;
  /** Localised series names. */
  readonly labels: { readonly fact: string; readonly forecast: string; readonly target: string };
}

/** Cumulative fact line + dashed scenario forecast + horizontal target line (pure option builder). */
export function forecastChartOption(input: ForecastChartInput): object {
  const {
    points,
    to,
    target,
    totalNow,
    scenarioPace: pace,
    scenarioDays,
    horizonDays,
    labels,
  } = input;

  const factDates = points.map((p) => p.date);
  const factCum: number[] = [];
  let acc = 0;
  for (const p of points) {
    acc += p.reaches;
    factCum.push(acc);
  }
  // Empty window → anchor the chart on the period end with a zero baseline.
  if (factDates.length === 0) {
    factDates.push(to);
    factCum.push(0);
  }

  const tailLen =
    scenarioDays === null ? horizonDays : Math.min(Math.max(scenarioDays, 0), horizonDays);
  const tailDates: string[] = [];
  const tailValues: number[] = [];
  for (let i = 1; i <= tailLen; i += 1) {
    tailDates.push(addDaysIso(to, i));
    // The last tail point is exactly the target when the scenario reaches it inside the horizon.
    tailValues.push(
      scenarioDays !== null && i === scenarioDays
        ? target
        : Math.round((totalNow + pace * i) * 100) / 100,
    );
  }

  const dates = [...factDates, ...tailDates];
  const forecast: (number | null)[] = [
    ...Array.from({ length: factDates.length - 1 }, () => null),
    totalNow,
    ...tailValues,
  ];

  const allValues = [...factCum, ...tailValues, target];
  // max(1,…) — ось не вырождается при пустых данных
  const yMax = Math.ceil(Math.max(1, ...allValues) * 1.05);

  return {
    tooltip: { trigger: 'axis', ...intTooltip },
    legend: { data: [labels.fact, labels.forecast] },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value', min: 0, max: yMax },
    series: [
      {
        name: labels.fact,
        type: 'line',
        smooth: true,
        data: factCum,
        lineStyle: { color: METRIC_COLORS.applications },
        itemStyle: { color: METRIC_COLORS.applications },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: METRIC_COLORS.payments },
          label: { formatter: labels.target, position: 'insideEndTop' },
          data: [{ yAxis: target }],
        },
      },
      {
        name: labels.forecast,
        type: 'line',
        smooth: true,
        data: forecast,
        lineStyle: { type: 'dashed', color: FORECAST_ACCENT },
        itemStyle: { color: FORECAST_ACCENT },
      },
    ],
  };
}
