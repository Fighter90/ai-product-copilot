import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { BrandMark } from '../../components/BrandMark';
import { LangToggle, ThemeToggle, VersionBadge } from '../../components/ui';
import { BuildMismatchBadge, BuildMismatchBanner } from '../../components/BuildMismatchBadge';
import { useT } from '../../i18n';
import { useAuth } from '../../auth/AuthContext';

/** Header for public pages (landing, help, login): transparent → solid on scroll. */
export function PublicHeader(): JSX.Element {
  const { t } = useT();
  const { user } = useAuth();
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
        solid ? 'border-b border-line bg-canvas/85 backdrop-blur-md' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <BrandMark className="h-8 w-8" />
          <span className="text-sm font-bold leading-tight">
            Product<span className="text-accent">Camp</span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-muted sm:block">
              Analytics Copilot
            </span>
          </span>
        </Link>
        <nav className="ml-6 hidden items-center gap-6 text-sm text-muted md:flex">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'text-ink' : 'hover:text-ink')}
          >
            {t('nav.landing')}
          </NavLink>
          <NavLink
            to="/help"
            className={({ isActive }) => (isActive ? 'text-ink' : 'hover:text-ink')}
          >
            {t('nav.help')}
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LangToggle />
          <ThemeToggle />
          <Link
            to={user ? '/app' : '/login'}
            className="btn-primary hidden uppercase tracking-wide sm:inline-flex"
          >
            {user ? t('nav.cabinet') : t('nav.login')} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter(): JSX.Element {
  const { t } = useT();
  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <BrandMark className="h-6 w-6" />
          <span>{t('footer.rights')}</span>
        </div>
        <div className="flex items-center gap-5">
          <Link to="/help" className="hover:text-ink">
            {t('nav.help')}
          </Link>
          <a
            href="https://github.com/Fighter90/ai-product-copilot/blob/main/CHANGELOG.md"
            className="hover:text-ink"
          >
            {t('footer.changelog')}
          </a>
          <span className="flex items-center gap-2">
            {/* ANA-43: warns when the landing/help bundle is older than the running backend. */}
            <BuildMismatchBadge />
            <VersionBadge />
          </span>
        </div>
      </div>
      {/* REG-15: a stale tab learns about a post-deploy version change within 5 minutes. */}
      <BuildMismatchBanner />
    </footer>
  );
}
