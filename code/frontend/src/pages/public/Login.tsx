import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { ApiError } from '../../lib/api';
import { PublicHeader } from './PublicChrome';

/** Sign-in page: email + password; redirects to `next` (default /app). */
export function Login(): JSX.Element {
  const { t } = useT();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    params.get('expired') ? t('auth.sessionExpired') : null,
  );
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next.startsWith('/') ? next : '/app'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      // Only same-origin relative paths without a protocol-relative host (//evil.com).
      const safeNext = /^\/[^/]/.test(next) ? next : '/app';
      navigate(safeNext, { replace: true });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(status === 429 ? t('auth.error.rate') : t('auth.error.credentials'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas">
      <PublicHeader />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-40 top-20 h-[70vh] w-[70vh] animate-spin-slow rounded-full border border-line" />
        <div className="absolute -right-10 top-40 h-[45vh] w-[45vh] rounded-full border border-accent/30" />
        <div className="absolute bottom-[-20vh] left-1/2 h-[40vh] w-[100vw] -translate-x-1/2 rounded-[100%] bg-accent/20 blur-[120px]" />
      </div>
      <div className="relative flex min-h-screen items-center justify-center px-4 pt-16">
        <form
          onSubmit={submit}
          className="card w-full max-w-md p-8 shadow-2xl animate-fade-up"
          aria-labelledby="login-title"
        >
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Lock className="h-5 w-5" />
          </div>
          <h1 id="login-title" className="h-display text-3xl">
            {t('auth.title')}
          </h1>
          <p className="mt-2 text-sm text-muted">{t('auth.subtitle')}</p>
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="label">{t('auth.email')}</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </label>
            <label className="block">
              <span className="label">{t('auth.password')}</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </label>
          </div>
          {error && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary mt-6 w-full py-3 uppercase tracking-wide"
          >
            {busy ? t('common.loading') : t('auth.submit')} <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
