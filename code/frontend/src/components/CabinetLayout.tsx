import { Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary, RouteFallback } from './ErrorBoundary';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Database,
  FileText,
  Filter,
  Gauge,
  History as HistoryIcon,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  LogOut,
  Menu,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  ScrollText,
  Settings2,
  Table2,
  Target,
  Users,
  Briefcase,
  Megaphone,
  Workflow,
  X,
} from 'lucide-react';
import { FilterBar } from './FilterBar';
import { LangToggle, ThemeToggle, VersionBadge } from './ui';
import { useAuth } from '../auth/AuthContext';
import { useT, ago, type DictKey } from '../i18n';
import { usePrefs } from '../store/prefs';
import { v3 } from '../lib/api-v3';
import { api } from '../lib/api';
import { InfoHint } from './InfoHint';
import { PageHelpLink } from './PageHelpLink';
import { BuildMismatchBadge } from './BuildMismatchBadge';
import { CabinetTour } from './onboarding/OnboardingTour';
import { termHint } from '@pca/shared';
import { BrandMark } from './BrandMark';
import { ChangePasswordModal } from './ChangePasswordModal';

type Icon = ComponentType<{ className?: string }>;
interface NavItem {
  to: string;
  key: DictKey;
  icon: Icon;
  admin?: boolean;
  end?: boolean;
}

export const NAV: Array<{ section: DictKey; admin?: boolean; items: NavItem[] }> = [
  {
    section: 'nav.section.monitor',
    items: [
      { to: '/app', key: 'nav.overview', icon: LayoutDashboard, end: true },
      { to: '/app/live', key: 'nav.live', icon: Activity },
      { to: '/app/goals', key: 'nav.goals', icon: Target },
      { to: '/app/funnel-live', key: 'nav.funnelLive', icon: Workflow },
    ],
  },
  {
    section: 'nav.section.analytics',
    items: [
      { to: '/app/traffic', key: 'nav.traffic', icon: BarChart3 },
      { to: '/app/behavior', key: 'nav.behavior', icon: MousePointerClick },
      { to: '/app/funnel', key: 'nav.funnel', icon: Filter },
      { to: '/app/kpi', key: 'nav.kpi', icon: Gauge },
      { to: '/app/explore', key: 'nav.explore', icon: Table2 },
    ],
  },
  {
    section: 'nav.section.work',
    items: [
      { to: '/app/report', key: 'nav.report', icon: FileText },
      { to: '/app/hypotheses', key: 'nav.hypotheses', icon: Lightbulb },
      { to: '/app/decisions', key: 'nav.decisions', icon: ListChecks },
      { to: '/app/history', key: 'nav.history', icon: HistoryIcon },
      { to: '/app/b2b', key: 'nav.b2b', icon: Briefcase },
      { to: '/app/marketing', key: 'nav.marketing', icon: Megaphone },
      { to: '/app/datalens', key: 'nav.integrations', icon: PieChart },
    ],
  },
  {
    section: 'nav.section.admin',
    admin: true,
    items: [
      { to: '/app/admin/users', key: 'nav.users', icon: Users },
      { to: '/app/admin/ai', key: 'nav.ai', icon: Bot },
      { to: '/app/admin/metrika', key: 'nav.metrika', icon: Database },
      { to: '/app/admin/integrations', key: 'nav.datalensAdmin', icon: Settings2 },
      { to: '/app/admin/audit', key: 'nav.audit', icon: ScrollText },
    ],
  },
];

/** Pages that show the global period/segment filter bar. */
const FILTER_PAGES = [
  '/app',
  '/app/live',
  '/app/goals',
  '/app/funnel-live',
  '/app/traffic',
  '/app/behavior',
  '/app/funnel',
  '/app/kpi',
  '/app/explore',
  '/app/report',
];

function Bell2(): JSX.Element {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: v3.notifications,
    refetchInterval: 60_000,
  });
  const unread = (q.data ?? []).filter((n) => !n.read).length;
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={t('notifications.title')}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-line hover:border-accent hover:text-accent"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-onaccent">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-line bg-raised p-2 shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-semibold">{t('notifications.title')}</span>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs text-accent"
                onClick={() =>
                  v3
                    .readNotifications()
                    .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
                }
              >
                {t('notifications.markRead')}
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(q.data ?? []).length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-muted">
                {t('notifications.empty')}
              </div>
            )}
            {(q.data ?? []).map((n) => (
              <div
                key={n.id}
                className={`rounded-lg px-2 py-2 text-sm ${n.read ? 'opacity-60' : ''}`}
              >
                <div className="font-medium">{n.title}</div>
                {n.body && <div className="line-clamp-2 text-xs text-muted">{n.body}</div>}
                <div className="mt-0.5 text-[11px] text-muted">{ago(n.at, locale)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Header user block → menu with «Сменить пароль» (and sign-out) + the password modal. */
function UserMenu(): JSX.Element {
  const { t } = useT();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="relative border-l border-line pl-3" ref={ref}>
      <button
        type="button"
        aria-label={t('prof.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md text-left hover:text-accent"
      >
        <span
          data-user-data
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent"
        >
          {(user?.name ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden leading-tight sm:block">
          <span data-user-data className="block max-w-[160px] truncate text-sm font-medium">
            {user?.name}
          </span>
          <span className="block text-[11px] text-muted">
            {user ? t(user.role === 'admin' ? 'role.admin' : 'role.analyst') : ''}
          </span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-line bg-raised p-1.5 shadow-2xl animate-fade-in"
        >
          {user?.email && (
            <div className="truncate px-2.5 py-1.5 text-xs text-muted">{user.email}</div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPwOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface hover:text-accent"
          >
            <KeyRound className="h-4 w-4" />
            {t('prof.changePassword')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface hover:text-accent"
          >
            <LogOut className="h-4 w-4" />
            {t('nav.logout')}
          </button>
        </div>
      )}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function SideNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}): JSX.Element {
  const { t } = useT();
  const { isAdmin } = useAuth();
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="cabinet">
      {NAV.filter((s) => !s.admin || isAdmin).map((s) => (
        <div key={s.section}>
          {!collapsed && (
            <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              {t(s.section)}
            </div>
          )}
          <ul className="space-y-0.5">
            {s.items.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.end}
                  onClick={onNavigate}
                  title={collapsed ? t(it.key) : undefined}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-all duration-200 ${
                      isActive
                        ? 'bg-accent/10 font-semibold text-accent-text'
                        : 'text-muted hover:bg-raised hover:text-ink'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                      )}
                      <it.icon className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                      {!collapsed && <span className="truncate">{t(it.key)}</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <Link
          to="/help"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-raised hover:text-ink"
        >
          <BookOpen className="h-4 w-4" />
          {!collapsed && t('nav.help')}
        </Link>
      </div>
    </nav>
  );
}

const MOBILE_TABS: NavItem[] = [
  { to: '/app', key: 'nav.overview', icon: LayoutDashboard, end: true },
  { to: '/app/live', key: 'nav.live', icon: Activity },
  { to: '/app/goals', key: 'nav.goals', icon: Target },
  { to: '/app/report', key: 'nav.report', icon: FileText },
];

/**
 * ANA-18: yellow «Демо-данные» banner shown on every cabinet screen while demo (seed) rows exist
 * in the database (GET /api/demo/status). The first successful Metrika sync wipes them and the
 * banner disappears. Renders nothing on error / before the first load.
 */
export function DemoBanner(): JSX.Element | null {
  const { t, locale } = useT();
  const q = useQuery({
    queryKey: ['demo-status'],
    queryFn: () => api.demoStatus(),
    retry: false,
    refetchInterval: 60_000, // disappear right after the first sync wipes the seed rows
    refetchIntervalInBackground: false,
  });
  if (!q.data?.demo) return null;
  return (
    <div
      data-testid="demo-banner"
      role="status"
      className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 sm:px-6"
    >
      <span className="mr-1" aria-hidden="true">
        🟡
      </span>
      <b>{t('dh.demo.bannerTitle')}</b> {t('dh.demo.bannerText')}{' '}
      <InfoHint
        label={t('dh.demo.bannerTitle')}
        align="end"
        text={<p>{termHint('demoData', locale)}</p>}
      />
    </div>
  );
}

/** Cabinet shell: collapsible sidebar, top bar (filters, theme, language, bell, user), mobile tabs. */
export function CabinetLayout(): JSX.Element {
  const { t } = useT();
  const { logout } = useAuth();
  const { sidebarCollapsed, toggleSidebar } = usePrefs();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const showFilters = FILTER_PAGES.includes(location.pathname.replace(/\/$/, '') || '/app');

  useEffect(() => setMobileOpen(false), [location.pathname]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-300 lg:flex ${
          sidebarCollapsed ? 'w-[68px]' : 'w-64'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-4">
          <Link to="/" className="flex items-center gap-2 overflow-hidden">
            <BrandMark className="h-8 w-8 shrink-0" />
            {!sidebarCollapsed && (
              <span className="truncate text-sm font-bold leading-tight">
                Product<span className="text-accent">Camp</span>
                <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-muted">
                  Analytics Copilot
                </span>
              </span>
            )}
          </Link>
        </div>
        <SideNav collapsed={sidebarCollapsed} />
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-ink"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
            {!sidebarCollapsed && <VersionBadge />}
          </button>
        </div>
      </aside>

      {/* Mobile drawer: always mounted below lg so the open/close transition
          (transform/opacity, 200ms) runs both ways. Inert when closed. */}
      <div
        id="mobile-drawer"
        className={`fixed inset-0 z-50 lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!mobileOpen}
      >
        <div
          data-testid="mobile-drawer-backdrop"
          className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          data-testid="mobile-drawer-panel"
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface transition-[transform,opacity,visibility] duration-200 ease-out ${
            mobileOpen
              ? 'visible translate-x-0 opacity-100'
              : 'invisible -translate-x-full opacity-0'
          }`}
        >
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <span className="flex items-center gap-2 text-sm font-bold">
              <BrandMark className="h-7 w-7" /> Product
              <span className="-ml-2 text-accent">Camp</span>
            </span>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <SideNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          <div className="border-t border-line p-3">
            <VersionBadge />
          </div>
        </aside>
      </div>

      <div
        className={`transition-[padding] duration-300 ${sidebarCollapsed ? 'lg:pl-[68px]' : 'lg:pl-64'}`}
      >
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line lg:hidden"
              aria-label="menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-drawer"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1 truncate text-sm text-muted">
              <span className="hidden sm:inline">{t('app.tagline')}</span>
            </div>
            <PageHelpLink />
            <LangToggle onChange={(l) => void v3.updateMe({ locale: l }).catch(() => undefined)} />
            <ThemeToggle />
            <Bell2 />
            <UserMenu />
            <button
              type="button"
              onClick={() => void logout()}
              title={t('nav.logout')}
              aria-label={t('nav.logout')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line hover:border-accent hover:text-accent"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          {showFilters && <FilterBar />}
        </header>

        {/* ANA-18: seed rows must never be mistaken for live Metrika data — a persistent
            banner on every cabinet screen while any is_demo row exists. */}
        <DemoBanner />

        <main
          key={location.pathname}
          className="mx-auto max-w-7xl px-4 pb-28 pt-6 animate-fade-in sm:px-6 lg:pb-12"
        >
          <ErrorBoundary compact>
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>

        <footer className="hidden border-t border-line px-6 py-4 text-xs text-muted lg:flex lg:items-center lg:justify-between">
          <span>{t('footer.rights')}</span>
          <span className="flex items-center gap-2">
            <BuildMismatchBadge />
            <VersionBadge />
          </span>
        </footer>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
        aria-label="tabs"
      >
        {MOBILE_TABS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[10px] ${isActive ? 'text-accent' : 'text-muted'}`
            }
          >
            <it.icon className="h-5 w-5" />
            {t(it.key)}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex flex-col items-center gap-0.5 py-2 text-[10px] text-muted"
        >
          <Menu className="h-5 w-5" />
          {t('nav.more')}
        </button>
      </nav>

      {/* ANA-47: role-specific onboarding tour, mounted once for the whole cabinet. */}
      <CabinetTour />
    </div>
  );
}
