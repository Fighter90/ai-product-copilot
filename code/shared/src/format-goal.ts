import type { Goal } from './types/metrics';
import { classifyGoal } from './goal-classifier';

/**
 * How a goal's reaches should be labelled across the UI and report. When the primary goal is the
 * purchase goal («Ecommerce: покупка»), its `goalReaches` are created orders in Метрике — but the
 * product vocabulary (and the tester contract, ANA-75/БАГ-02) labels Метрика reaches «заявки»
 * everywhere: funnel, tables and KPI strip all say «заявки», so the tile does too. They are still
 * never confirmed payments (ANA-19) — the «заявка ≠ оплата» caveat stays on.
 */
export interface GoalLabel {
  readonly title: string;
  readonly isPaid: boolean;
  readonly showApplicationsCaveat: boolean;
  readonly showEstimate: boolean;
}

export function formatGoalLabel(goal: Goal | undefined): GoalLabel {
  if (goal && classifyGoal(goal) === 'purchase') {
    return { title: 'Заявок', isPaid: true, showApplicationsCaveat: true, showEstimate: false };
  }
  return {
    title: 'Заявок B2C',
    isPaid: false,
    showApplicationsCaveat: true,
    showEstimate: true,
  };
}
