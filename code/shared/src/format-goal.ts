import type { Goal } from './types/metrics';
import { classifyGoal } from './goal-classifier';

/**
 * How a goal's reaches should be labelled across the UI and report. When the primary goal is the
 * purchase goal («Ecommerce: покупка»), its `goalReaches` are created orders in this business, not
 * confirmed payments (ANA-19) — so we say «Заказов» and drop the «заявка ≠ оплата» caveat and the
 * conversion estimate. For any other goal, reaches are applications (заявки), which are an upper
 * bound on orders — keep the caveat and estimate.
 */
export interface GoalLabel {
  readonly title: string;
  readonly isPaid: boolean;
  readonly showApplicationsCaveat: boolean;
  readonly showEstimate: boolean;
}

export function formatGoalLabel(goal: Goal | undefined): GoalLabel {
  if (goal && classifyGoal(goal) === 'purchase') {
    return { title: 'Заказов', isPaid: true, showApplicationsCaveat: false, showEstimate: false };
  }
  return {
    title: 'Заявок B2C',
    isPaid: false,
    showApplicationsCaveat: true,
    showEstimate: true,
  };
}
