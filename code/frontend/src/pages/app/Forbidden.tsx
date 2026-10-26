import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n';

/** 403 page shown to analysts who open an admin route. */
export function Forbidden(): JSX.Element {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-lg py-16 text-center animate-fade-up">
      <ShieldAlert className="mx-auto h-12 w-12 text-accent" />
      <h1 className="mt-4 text-2xl font-bold">{t('auth.forbidden.title')}</h1>
      <p className="mt-2 text-sm text-muted">{t('auth.forbidden.text')}</p>
      <Link to="/app" className="btn-ghost mt-6">
        ← {t('nav.overview')}
      </Link>
    </div>
  );
}
