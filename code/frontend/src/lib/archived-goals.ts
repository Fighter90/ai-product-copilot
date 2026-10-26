/** Metrika's archive flag as sent by `/api/live/goals` (`archived`) and `/api/metrics/goals` (`isArchived`). */
export interface MaybeArchived {
  readonly archived?: boolean;
  readonly isArchived?: boolean;
}

/** True when the goal is archived in Metrika (either API shape; absent flag → active). */
export function isArchived(g: object): boolean {
  const x = g as MaybeArchived;
  return x.archived === true || x.isArchived === true;
}

/**
 * Goals visible under the global «Архивные цели» filter: archived goals are hidden unless the
 * checkbox is on. Order is preserved.
 */
export function visibleGoals<T extends object>(goals: readonly T[], showArchived: boolean): T[] {
  return showArchived ? [...goals] : goals.filter((g) => !isArchived(g));
}
