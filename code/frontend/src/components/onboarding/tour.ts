import type { DictKey } from '../../i18n';

export type TourRole = 'admin' | 'analyst';

export interface TourStep {
  readonly id: string;
  readonly title: DictKey;
  readonly body: DictKey;
  /** Cabinet route the step is about; Next/Back navigate there. */
  readonly to?: string;
}

/** Analyst path (ANA-47): period → weak spots → hypothesis → report. */
const ANALYST_STEPS: readonly TourStep[] = [
  { id: 'welcome', title: 'hint.tour.welcome.title', body: 'hint.tour.welcome.analyst' },
  { id: 'period', title: 'hint.tour.period.title', body: 'hint.tour.period.body', to: '/app' },
  { id: 'weak', title: 'hint.tour.weak.title', body: 'hint.tour.weak.body', to: '/app' },
  {
    id: 'hypothesis',
    title: 'hint.tour.hypothesis.title',
    body: 'hint.tour.hypothesis.body',
    to: '/app/report',
  },
  {
    id: 'report',
    title: 'hint.tour.report.title',
    body: 'hint.tour.report.body',
    to: '/app/report',
  },
];

/** Admin path: the analyst path plus users, Metrika and AI providers. */
const ADMIN_EXTRA: readonly TourStep[] = [
  {
    id: 'users',
    title: 'hint.tour.users.title',
    body: 'hint.tour.users.body',
    to: '/app/admin/users',
  },
  {
    id: 'metrika',
    title: 'hint.tour.metrika.title',
    body: 'hint.tour.metrika.body',
    to: '/app/admin/metrika',
  },
  {
    id: 'providers',
    title: 'hint.tour.providers.title',
    body: 'hint.tour.providers.body',
    to: '/app/admin/ai',
  },
];

export function tourSteps(role: TourRole): readonly TourStep[] {
  if (role === 'analyst') return ANALYST_STEPS;
  return [
    { ...ANALYST_STEPS[0]!, body: 'hint.tour.welcome.admin' },
    ...ANALYST_STEPS.slice(1),
    ...ADMIN_EXTRA,
  ];
}

const KEY = (role: TourRole): string => `pca.tour.v1.${role}`;
/** Fired by «Пройти тур заново» so a mounted tour restarts without a reload. */
export const TOUR_RESTART_EVENT = 'pca:tour-restart';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isTourDone(role: TourRole): boolean {
  return storage()?.getItem(KEY(role)) === 'done';
}

export function markTourDone(role: TourRole): void {
  storage()?.setItem(KEY(role), 'done');
}

/** Forget the «seen» flag for every role and ask a mounted tour to start again. */
export function restartTour(): void {
  const s = storage();
  s?.removeItem(KEY('admin'));
  s?.removeItem(KEY('analyst'));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TOUR_RESTART_EVENT));
}
