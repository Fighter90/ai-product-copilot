import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { useT } from '../../i18n';

/**
 * 404 page (ANA-174): an unknown URL shows an explicit «not found» state —
 * never a silent redirect. Rendered at the top level (public area) and inside
 * the cabinet layout for unknown /app/* deep links.
 */
export function NotFound(): JSX.Element {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-lg py-16 text-center animate-fade-up">
      <SearchX className="mx-auto h-12 w-12 text-accent" />
      <h1 className="mt-4 text-2xl font-bold">{t('notFound.title')}</h1>
      <p className="mt-2 text-sm text-muted">{t('notFound.text')}</p>
      <Link to="/" className="btn-ghost mt-6">
        ← {t('notFound.home')}
      </Link>
    </div>
  );
}
