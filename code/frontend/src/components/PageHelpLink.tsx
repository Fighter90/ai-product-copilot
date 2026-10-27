import { Link, useLocation } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { useT } from '../i18n';

/** Help article slugs (docs/help/{ru,en}/NN-<slug>.md, numeric prefix stripped by the backend). */
export const HELP_SLUGS = [
  'start',
  'overview',
  'live',
  'goals',
  'traffic-behavior',
  'funnel',
  'explore',
  'report',
  'history-b2b',
  'marketing',
  'datalens',
  'assistant',
  'admin',
  'prefs',
  'metrics',
  'architecture',
  'roles',
  'reports-how',
  'llm-keys',
  'admin-guide',
  'analyst-guide',
] as const;
export type HelpSlug = (typeof HELP_SLUGS)[number];

/** Cabinet path prefix → help article. Longest prefix wins; `/app` itself is the Overview. */
const PATH_SLUGS: ReadonlyArray<readonly [string, HelpSlug]> = [
  ['/app/live', 'live'],
  ['/app/goals', 'goals'],
  ['/app/kpi', 'goals'],
  ['/app/funnel-live', 'live'],
  ['/app/funnel', 'funnel'],
  ['/app/traffic', 'traffic-behavior'],
  ['/app/behavior', 'traffic-behavior'],
  ['/app/explore', 'explore'],
  ['/app/report', 'report'],
  ['/app/history', 'history-b2b'],
  ['/app/b2b', 'history-b2b'],
  ['/app/marketing', 'marketing'],
  ['/app/datalens', 'datalens'],
  ['/app/admin/users', 'roles'],
  ['/app/admin/ai', 'llm-keys'],
  ['/app/admin/integrations', 'datalens'],
  ['/app/admin', 'admin'],
];

/** The help article that documents a cabinet path (falls back to «Начало работы»). */
export function helpSlugForPath(pathname: string): HelpSlug {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/app') return 'overview';
  let best: readonly [string, HelpSlug] | undefined;
  for (const entry of PATH_SLUGS) {
    const [prefix] = entry;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    if (!best || prefix.length > best[0].length) best = entry;
  }
  return best?.[1] ?? 'start';
}

/**
 * Contextual «?» link to the help article of the current cabinet section (ANA-45). Pass `slug`
 * to override the path-based match.
 */
export function PageHelpLink({
  slug,
  className = '',
}: {
  slug?: HelpSlug;
  className?: string;
}): JSX.Element {
  const { t } = useT();
  const { pathname } = useLocation();
  const target = slug ?? helpSlugForPath(pathname);
  return (
    <Link
      to={`/help/${target}`}
      aria-label={t('hint.helpLink')}
      title={t('hint.helpLink')}
      data-testid="page-help-link"
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted hover:border-accent hover:text-accent ${className}`}
    >
      <HelpCircle className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}
