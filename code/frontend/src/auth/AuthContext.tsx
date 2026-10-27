import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { v3, type CabinetUser } from '../lib/api-v3';
import { ApiError } from '../lib/api';
import { usePrefs } from '../store/prefs';
import { useT } from '../i18n';
import { Forbidden } from '../pages/app/Forbidden';

interface AuthState {
  user: CabinetUser | null;
  loading: boolean;
  /** /auth/me keeps failing with a non-auth error (server down) — not the same as signed out. */
  unavailable: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<CabinetUser>;
  logout: () => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<AuthState | null>(null);

/** Session state for the whole app (cookie-based; `/api/auth/me` is the source of truth). */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  // `GET /auth/me` answers guests with 200 `{ user: null }`. An explicit 401/403 (older backend)
  // also means "signed out". Transient failures (502 during a deploy, 503 from the nginx rate
  // limit, network blips) are retried and must never log the user out.
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      v3
        .me()
        .then((r) => {
          const next = r?.user ?? null;
          // Was signed in, now anonymous → the session expired: same flow as an API 401.
          if (!next && qc.getQueryData(['auth', 'me'])) {
            window.dispatchEvent(new CustomEvent('pca:unauthorized'));
          }
          return next;
        })
        .catch((err: unknown) => {
          if (isAuthError(err)) return null;
          throw err;
        }),
    retry: (count) => count < 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 60_000,
  });

  // The listener is registered once — read the current route through a ref, not the closure.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  // Any 401 from the API (expired session) → back to the login page, keeping the target.
  useEffect(() => {
    const onUnauthorized = () => {
      qc.setQueryData(['auth', 'me'], null);
      if (pathRef.current.startsWith('/app')) {
        // Read live values — the handler must not capture a stale route from the closure.
        navigate(
          `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}&expired=1`,
          {
            replace: true,
          },
        );
      }
    };
    window.addEventListener('pca:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pca:unauthorized', onUnauthorized);
  }, [qc, navigate]);

  const user = me.data ?? null;
  const setLocale = usePrefs((s) => s.setLocale);

  const value: AuthState = {
    user,
    loading: me.isLoading,
    unavailable: me.isError && me.data === undefined,
    isAdmin: user?.role === 'admin',
    login: async (email, password) => {
      const res = await v3.login(email, password);
      qc.setQueryData(['auth', 'me'], res.user);
      if (res.user.locale) setLocale(res.user.locale);
      return res.user;
    },
    logout: async () => {
      await v3.logout().catch(() => undefined);
      qc.clear();
      qc.setQueryData(['auth', 'me'], null);
      navigate('/login', { replace: true });
    },
    refresh: () => void qc.invalidateQueries({ queryKey: ['auth', 'me'] }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function isAuthError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 401 || err.status === 403;
  // Legacy/unknown error shapes: treat an explicit "401" message as signed out.
  return err instanceof Error && /\b401\b/.test(err.message);
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

function Splash(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-accent" />
    </div>
  );
}

function ServerUnavailable({ onRetry }: { onRetry: () => void }): JSX.Element {
  const { t } = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
      <p className="text-lg font-semibold">{t('i18n.auth.unavailable.title')}</p>
      <p className="max-w-md text-sm text-muted">{t('i18n.auth.unavailable.text')}</p>
      <button type="button" className="btn-primary px-4" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  );
}

/** Guard: signed-in users only (redirects to /login?next=…). */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading, unavailable, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (unavailable) return <ServerUnavailable onRetry={refresh} />;
  if (!user) {
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }
  return <>{children}</>;
}

/** Guard: administrators only (403 page for analysts). */
export function RequireAdmin({ children }: { children: ReactNode }): JSX.Element {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Forbidden />;
}
