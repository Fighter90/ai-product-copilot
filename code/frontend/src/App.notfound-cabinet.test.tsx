import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CabinetUser } from './lib/api-v3';

/**
 * ANA-174 regression: a deep link to a nonexistent cabinet section must show the
 * 404 state inside the cabinet chrome — never silently bounce to /app (the old
 * catch-all <Navigate to="/app" replace /> hid broken links from the user).
 *
 * Same stubbing approach as App.admin-guard.test.tsx: /auth/me answers with the
 * analyst; the cabinet chrome's other fetches (/notifications, /health,
 * /demo/status) are object-shaped and falsy-tolerant.
 */

const analyst: CabinetUser = {
  id: 2,
  email: 'analyst@x.ru',
  name: 'Аналитик',
  role: 'analyst',
  locale: 'ru',
  isActive: true,
  createdAt: '2025-01-01',
  lastLoginAt: null,
};

const stubFetch = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let payload: unknown = {};
      if (url.includes('/auth/me')) payload = { user: analyst };
      else if (url.includes('/notifications')) payload = [];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
};

import { App } from './App';
import { queryClient } from './lib/query';

beforeEach(stubFetch);

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
  window.history.pushState({}, '', '/');
});

describe('cabinet deep link to a nonexistent section', () => {
  it('shows «Страница не найдена» inside the cabinet, without redirecting', async () => {
    window.history.pushState({}, '', '/app/definitely-not-a-page');
    render(<App />);
    // The explicit 404 state (i18n ru `notFound.title`)…
    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeInTheDocument();
    // …stays at the requested URL…
    expect(window.location.pathname).toBe('/app/definitely-not-a-page');
    // …inside the cabinet chrome: the sidebar keeps its entry points
    // (desktop + mobile nav both render «Обзор» — hence getAllByRole)…
    expect(screen.getAllByRole('link', { name: 'Обзор' }).length).toBeGreaterThan(0);
    // …and the 404 page itself links back home.
    expect(screen.getByRole('link', { name: /На главную/ })).toHaveAttribute('href', '/');
  });
});
