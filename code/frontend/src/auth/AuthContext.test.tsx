import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider, RequireAuth, RequireAdmin, useAuth } from './AuthContext';
import { v3, type CabinetUser } from '../lib/api-v3';
import { usePrefs } from '../store/prefs';

vi.mock('../lib/api-v3', () => ({
  v3: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

const adminUser: CabinetUser = {
  id: 1,
  email: 'admin@x.ru',
  name: 'Админ',
  role: 'admin',
  locale: 'ru',
  isActive: true,
  createdAt: '2025-01-01',
  lastLoginAt: null,
};
const analystUser: CabinetUser = { ...adminUser, id: 2, role: 'analyst', locale: 'en' };

/** Потребитель контекста для ассертов. */
function Probe(): JSX.Element {
  const { user, loading, isAdmin, login, logout, refresh } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="isAdmin">{String(isAdmin)}</span>
      <span data-testid="user">{user ? user.email : 'null'}</span>
      <button onClick={() => void login('a@x.ru', 'pw')}>login</button>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => refresh()}>refresh</button>
    </div>
  );
}

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <span data-testid="path">{loc.pathname + loc.search}</span>;
}

function renderWith(initialPath = '/'): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          {/* вне Routes — живёт при любых редиректах */}
          <LocationProbe />
          <Routes>
            <Route path="/" element={<Probe />} />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <div data-testid="secret">secret-app</div>
                </RequireAuth>
              }
            />
            <Route
              path="/app/admin"
              element={
                <RequireAdmin>
                  <div data-testid="admin-zone">admin-zone</div>
                </RequireAdmin>
              }
            />
            <Route path="/login" element={<div data-testid="login-page">login</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.setItem('pca.locale', 'ru');
});
afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('AuthProvider / useAuth', () => {
  it('loading, then the user from /auth/me; isAdmin reflects the role', async () => {
    vi.mocked(v3.me).mockReturnValue(new Promise(() => undefined)); // висит → loading
    renderWith();
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('null');
  });

  it('resolved me → user + isAdmin=true for admin', async () => {
    vi.mocked(v3.me).mockResolvedValue({ user: adminUser });
    renderWith();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('admin@x.ru');
    expect(screen.getByTestId('isAdmin')).toHaveTextContent('true');
  });

  it('analyst → isAdmin=false', async () => {
    vi.mocked(v3.me).mockResolvedValue({ user: analystUser });
    renderWith();
    await waitFor(() => expect(screen.getByTestId('isAdmin')).toHaveTextContent('false'));
  });

  it('me failure → anonymous user (гость)', async () => {
    vi.mocked(v3.me).mockRejectedValue(new Error('401'));
    renderWith();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('null');
  });

  it('login кладёт пользователя в кэш и применяет locale из профиля', async () => {
    vi.mocked(v3.me).mockRejectedValue(new Error('anonymous'));
    vi.mocked(v3.login).mockResolvedValue({ user: analystUser });
    renderWith();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('null');

    screen.getByText('login').click();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent(analystUser.email));
    // locale профиля применён к prefs (аналитик с locale=en)
    expect(usePrefs.getState().locale).toBe('en');
    expect(v3.login).toHaveBeenCalledWith('a@x.ru', 'pw');
  });

  it('logout вызывает v3.logout, чистит кэш и уводит на /login (401-событие тоже)', async () => {
    vi.mocked(v3.me).mockResolvedValue({ user: adminUser });
    vi.mocked(v3.logout).mockResolvedValue({ ok: true });
    // window.location (не роутер) — источник ?next= в редиректе по 401
    window.history.pushState({}, '', '/app/current?x=1');
    renderWith('/app');
    await waitFor(() => expect(screen.getByTestId('secret')).toBeInTheDocument());

    // 401 от API → событие → редирект на /login?next=…&expired=1
    window.dispatchEvent(new CustomEvent('pca:unauthorized'));
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
    expect(screen.getByTestId('path').textContent).toBe(
      '/login?next=%2Fapp%2Fcurrent%3Fx%3D1&expired=1',
    );
  });

  it('logout по кнопке: v3.logout вызван, пользователь аноним, редирект на /login', async () => {
    vi.mocked(v3.me).mockResolvedValue({ user: adminUser });
    vi.mocked(v3.logout).mockRejectedValue(new Error('network')); // logout глотает ошибку
    renderWith();
    await waitFor(() => expect(screen.getByTestId('user')!.textContent).toBe('admin@x.ru'));
    screen.getByText('logout').click();
    await waitFor(() => expect(v3.logout).toHaveBeenCalled());
    // qc.clear() + setQueryData(null) → user сброшен; навигация на /login
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
    expect(screen.getByTestId('path').textContent).toBe('/login');
  });
});

describe('RequireAuth / RequireAdmin', () => {
  it('аноним на /app → редирект на /login?next=/app', async () => {
    vi.mocked(v3.me).mockRejectedValue(new Error('401'));
    renderWith('/app');
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
    expect(screen.getByTestId('path').textContent).toBe('/login?next=%2Fapp');
  });

  it('авторизованный на /app видит контент', async () => {
    vi.mocked(v3.me).mockResolvedValue({ user: analystUser });
    renderWith('/app');
    await waitFor(() => expect(screen.getByTestId('secret')).toBeInTheDocument());
  });

  it('аналитик на /app/admin → страница 403, админ → контент', async () => {
    vi.mocked(v3.me).mockResolvedValue({ user: analystUser });
    renderWith('/app/admin');
    // Forbidden рендерит заголовок 403 (ru-словарь)
    await waitFor(() => expect(screen.getByRole('heading')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-zone')).toBeNull();

    cleanup();
    vi.mocked(v3.me).mockResolvedValue({ user: adminUser });
    renderWith('/app/admin');
    await waitFor(() => expect(screen.getByTestId('admin-zone')).toBeInTheDocument());
  });

  it('useAuth вне провайдера бросает ошибку', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Orphan(): JSX.Element {
      useAuth();
      return <div />;
    }
    expect(() => render(<Orphan />)).toThrow('useAuth must be used inside <AuthProvider>');
    spy.mockRestore();
  });
});
