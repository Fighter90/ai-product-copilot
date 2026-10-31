import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The v3 shell mounts the public landing at `/`; the cabinet lives behind /app auth.
vi.mock('./lib/api', () => ({
  api: {
    me: vi.fn().mockResolvedValue(null),
    channels: vi.fn().mockResolvedValue([]),
    primaryGoal: vi.fn().mockResolvedValue(null),
    geoDevice: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('./lib/api-v3', () => ({
  v3: {
    me: vi.fn().mockResolvedValue({ user: null }),
    notifications: vi.fn().mockResolvedValue([]),
    providers: vi.fn().mockResolvedValue([]),
    helpArticles: vi.fn().mockResolvedValue([]),
    helpSearch: vi.fn().mockResolvedValue([]),
  },
}));
import { App } from './App';
import { queryClient } from './lib/query';

afterEach(() => {
  queryClient.clear();
  // Тесты ниже уходят с '/' через window.history.pushState, а jsdom-история
  // шарится между тестами файла: при ином порядке выполнения (vitest
  // --sequence.shuffle) первый тест стартует с /app|/b2b и видит /login
  // вместо лендинга. Возвращаем корень — изоляция URL между тестами.
  window.history.pushState({}, '', '/');
});

describe('<App>', () => {
  it('renders the public landing shell with headline and login entry', async () => {
    render(<App />);
    // Landing hero headline (locale defaults by navigator language: ru/en)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /(От Метрики|From Metrika)/i,
    );
    // Public header links into the cabinet / login
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('guest hitting /app is redirected to /login (RequireAuth)', async () => {
    window.history.pushState({}, '', '/app');
    render(<App />);
    // RequireAuth sends the guest to /login?next=/app — the login form renders there.
    await screen.findAllByText(/Войти|Sign in/i);
    expect(window.location.pathname).toBe('/login');
  });

  it('legacy v2 URL /b2b redirects into the cabinet (/app/b2b → /login for a guest)', async () => {
    window.history.pushState({}, '', '/b2b');
    render(<App />);
    // LegacyRedirect maps /b2b → /app/b2b, then RequireAuth forwards the guest to /login.
    await screen.findAllByText(/Войти|Sign in/i);
    expect(window.location.pathname).toBe('/login');
  });
});
