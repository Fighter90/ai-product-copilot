import { selectPrimaryGoal, type Goal } from '@pca/shared';

/**
 * The KPI goal: the admin-pinned GOAL_ID when it is set (> 0) and present in `goals`, otherwise the
 * auto-detected payment/application goal. Mirrors what the sync uses for goal reaches, so labels
 * («Заказов» vs «Заявок») always describe the numbers actually synced.
 */
export function resolvePrimaryGoal(
  goals: readonly Goal[],
  pinnedGoalId?: number,
): Goal | undefined {
  if (pinnedGoalId && pinnedGoalId > 0) {
    const pinned = goals.find((g) => g.id === pinnedGoalId);
    if (pinned) return pinned;
  }
  return selectPrimaryGoal(goals);
}
