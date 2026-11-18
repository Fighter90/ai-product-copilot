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
/** localStorage flag (ANA-141): scripts and repeat visitors suppress the tour entirely. */
export const TOUR_OFF_KEY = 'qa-notour';
/**
 * Session-scoped dismissal (ANA-187): «Пропустить»/Escape/«Завершить» mark the tour seen for the
 * rest of the browser session even when the persistent localStorage flag is lost or blocked —
 * the regression saw «ШАГ 1 ИЗ 5» reopen on every page load within a session.
 */
export const TOUR_SESSION_KEY = 'pca.tour.session.dismissed';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * True when the tour must never open: `?tour=0` in the address bar or the `qa-notour` localStorage
 * flag (ANA-141). Automated browser checks and repeat users see the full cabinet content with no
 * tour clicks; a regular visitor still sees the tour once («done» flag per role).
 */
export function isTourSuppressed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('tour') === '0') return true;
    const flag = storage()?.getItem(TOUR_OFF_KEY);
    return flag !== null && flag !== undefined;
  } catch {
    return false;
  }
}

export function isTourDone(role: TourRole): boolean {
  return storage()?.getItem(KEY(role)) === 'done';
}

export function markTourDone(role: TourRole): void {
  try {
    storage()?.setItem(KEY(role), 'done');
  } catch {
    // Blocked storage cannot persist the flag — the session mark (ANA-187) still applies.
  }
}

/** True when the tour was dismissed earlier in this browser session (ANA-187). */
export function isTourDismissedInSession(): boolean {
  return session()?.getItem(TOUR_SESSION_KEY) === '1';
}

/** Best-effort session mark: survives reloads even where localStorage does not persist. */
export function markTourSessionDismissed(): void {
  try {
    session()?.setItem(TOUR_SESSION_KEY, '1');
  } catch {
    // No writable storage at all — nothing more we can do.
  }
}

/** Forget the session dismissal — part of «Пройти тур заново». */
export function clearTourSessionDismissal(): void {
  session()?.removeItem(TOUR_SESSION_KEY);
}

/** Forget the «seen» flag for every role and ask a mounted tour to start again. */
export function restartTour(): void {
  const s = storage();
  s?.removeItem(KEY('admin'));
  s?.removeItem(KEY('analyst'));
  clearTourSessionDismissal();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TOUR_RESTART_EVENT));
}
