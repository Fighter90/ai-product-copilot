import { addDaysIso, daysToTarget, paceInfo } from '../../lib/forecast';
import type { DailyPoint } from '../../lib/trends';

/** Answer to «успеваем к цели?» for the Overview first screen. */
export type PaceStatus = 'reached' | 'onTrack' | 'onTime' | 'behind' | 'unreachable';

export interface GoalPace {
  readonly current: number;
  readonly target: number;
  /** current / target, clamped to 0..1 (drives the progress ring). */
  readonly progress: number;
  /** Goal reaches per day over the fact window (linear pace, same model as the KPI page). */
  readonly perDay: number;
  /** True when the pace counts applications, not payments — then it is only an upper estimate. */
  readonly isUpperEstimate: boolean;
  /** Projected date to close the gap at the current pace (null = unreachable). */
  readonly forecastDate: string | null;
  /** Deadline: period end + 2× the fact window — the same horizon the KPI page («Что если») uses. */
  readonly deadline: string;
  /** forecast − deadline in days: negative = ahead, positive = behind, null = unreachable. */
  readonly deviationDays: number | null;
  readonly status: PaceStatus;
}

export interface GoalPaceInput {
  /** Daily fact (visits + goal reaches), sorted by ISO date — `dailySeries(channels)`. */
  readonly points: DailyPoint[];
  /** Period end (ISO date); defaults to the last fact date. */
  readonly to?: string;
  readonly target: number;
  /** Confirmed payments so far (the KPI strip's «paid»: B2B paid + purchase-goal reaches). */
  readonly current: number;
  /** Primary goal is a purchase goal → its reaches are payments and the pace is exact. */
  readonly goalIsPaid: boolean;
}

/**
 * Linear «успеваем?» forecast for the Overview hero. Progress counts confirmed payments (agrees
 * with the KPI strip gap); the pace is goal reaches/day from {@link paceInfo} — exact for a
 * purchase goal, an upper estimate for an application goal (заявка ≠ оплата). Pure.
 */
export function goalPace(input: GoalPaceInput): GoalPace {
  const { points, target, current, goalIsPaid } = input;
  const to = input.to ?? points[points.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
  const pace = paceInfo(points);
  const horizon = pace.days * 2;
  const deadline = addDaysIso(to, horizon);
  const days = daysToTarget(target, current, pace.perDay);
  const forecastDate = days === null ? null : addDaysIso(to, days);
  const deviationDays = days === null ? null : days - horizon;

  let status: PaceStatus;
  if (current >= target) status = 'reached';
  else if (deviationDays === null) status = 'unreachable';
  else if (deviationDays < 0) status = 'onTrack';
  else if (deviationDays === 0) status = 'onTime';
  else status = 'behind';

  return {
    current,
    target,
    progress: target > 0 ? Math.min(Math.max(current / target, 0), 1) : 0,
    perDay: pace.perDay,
    isUpperEstimate: !goalIsPaid,
    forecastDate,
    deadline,
    deviationDays,
    status,
  };
}
