import { Link, useInRouterContext } from 'react-router-dom';
import { useT } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { helpSlugForPath } from './PageHelpLink';

export interface EmptyStateAction {
  readonly label: string;
  /** In-app route (rendered as a link). */
  readonly to?: string;
  /** Click handler (rendered as a button when there is no `to`). */
  readonly onClick?: () => void;
}

/** Admin flag without requiring an <AuthProvider> (EmptyState also renders in isolated views). */
function useIsAdmin(): boolean {
  try {
    return useAuth().isAdmin;
  } catch {
    return false;
  }
}

const ACTION_CLASS =
  'mt-4 inline-flex items-center justify-center rounded-md border border-accent/50 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10';

/**
 * Empty state: what happened plus one action (ANA-47). Without an explicit `action` the admin gets
 * «Запустить синхронизацию» (Metrika settings, where the sync lives) and an analyst gets the help
 * article of the current section. Pass `action={null}` to hide the button.
 */
export function EmptyState({
  message,
  action,
}: {
  message?: string;
  action?: EmptyStateAction | null;
}): JSX.Element {
  const { t } = useT();
  const isAdmin = useIsAdmin();
  const inRouter = useInRouterContext();
  const resolved: EmptyStateAction | null =
    action === undefined
      ? isAdmin
        ? { label: t('hint.empty.sync'), to: '/app/admin/metrika' }
        : {
            label: t('hint.empty.help'),
            to: `/help/${helpSlugForPath(typeof window === 'undefined' ? '/' : window.location.pathname)}`,
          }
      : action;

  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
    >
      <p>{message ?? t('an.empty')}</p>
      {resolved?.to ? (
        inRouter ? (
          <Link to={resolved.to} onClick={resolved.onClick} className={ACTION_CLASS}>
            {resolved.label}
          </Link>
        ) : (
          <a href={resolved.to} onClick={resolved.onClick} className={ACTION_CLASS}>
            {resolved.label}
          </a>
        )
      ) : resolved ? (
        <button type="button" onClick={resolved.onClick} className={ACTION_CLASS}>
          {resolved.label}
        </button>
      ) : null}
    </div>
  );
}
