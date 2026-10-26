export const METRIKA_BASE_URL = 'https://api-metrika.yandex.net';

export const ENDPOINTS = {
  /** Management API — seed the goals table. */
  goals: (counterId: number): string => `/management/v1/counter/${counterId}/goals`,
  /**
   * Management API — archive a goal. SINGULAR `goal` segment: verified against the live API —
   * `POST .../goals/{id}/archive` (plural) answers "No endpoint", `.../goal/{id}/archive` works.
   */
  goalArchive: (counterId: number, goalId: number): string =>
    `/management/v1/counter/${counterId}/goal/${goalId}/archive`,
  /** Management API — restore an archived goal (counterpart of {@link goalArchive}). */
  goalUnarchive: (counterId: number, goalId: number): string =>
    `/management/v1/counter/${counterId}/goal/${goalId}/unarchive`,
  /** Reporting API — aggregated reports. */
  statData: '/stat/v1/data',
  /** Reporting API — time series. */
  statByTime: '/stat/v1/data/bytime',
  /** Reporting API — drill-down. */
  statDrilldown: '/stat/v1/data/drilldown',
} as const;
