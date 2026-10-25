import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { v3, type CabinetUser } from '../lib/api-v3';
import { usePrefs } from '../store/prefs';
import { Forbidden } from '../pages/app/Forbidden';

interface AuthState {
  user: CabinetUser | null;
  loading: boolean;
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
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => v3.me().then((r) => r.user),
    retry: false,
    staleTime: 60_000,
  });

  // Any 401 from the API (expired session) → back to the login page, keeping the target.
  useEffect(() => {
    const onUnauthorized = () => {
      qc.setQueryData(['auth', 'me'], null);
      if (location.pathname.startsWith('/app')) {
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

/** Guard: signed-in users only (redirects to /login?next=…). */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
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
