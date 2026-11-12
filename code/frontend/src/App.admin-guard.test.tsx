import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CabinetUser } from './lib/api-v3';

/**
 * ANA-140 regression test: an analyst who opens an admin route must see the Forbidden
 * (403) screen — not the admin page content, not an empty content area.
 *
 * The guard itself already ships on main: every /app/admin/* route is wrapped in
 * <RequireAdmin> (App.tsx), which renders <Forbidden /> for non-admins, and the browser
 * level of the same contract is covered by e2e/roles.spec.ts («direct visit → 403 panel»).
 * This suite locks the contract at the unit level so a future routing refactor cannot
 * silently drop the wrapper.
 */

/** ru h1 titles of the admin pages (i18n `admin.*.title`) — must never leak to an analyst. */
const ADMIN_PAGES: Array<{ route: string; adminTitle: string }> = [
  { route: '/app/admin/users', adminTitle: 'Пользователи' },
  { route: '/app/admin/ai', adminTitle: 'AI-провайдеры' },
  { route: '/app/admin/metrika', adminTitle: 'Метрика и данные' },
  { route: '/app/admin/integrations', adminTitle: 'Интеграции · DataLens' },
  { route: '/app/admin/audit', adminTitle: 'Журнал действий' },
];

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

/**
 * Session API answers with the analyst. The cabinet chrome mounted alongside any route
 * also fetches: /notifications (array!) and /health + /demo/status (object-shaped and
 * falsy-tolerant). Forbidden itself renders purely from i18n — it performs no fetches —
 * and with the guard intact no admin component ever mounts, so no admin endpoint is hit.
 */
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

describe.each(ADMIN_PAGES)('analyst at $route', ({ route, adminTitle }) => {
  it('shows the Forbidden screen, not the admin page', async () => {
    window.history.pushState({}, '', route);
    render(<App />);
    // Forbidden: «Нет доступа» heading appears (i18n ru `auth.forbidden.title`).
    expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument();
    // No admin page content leaks: neither the page h1 (`admin.*.title`) nor the
    // Users page action button (`admin.users.invite`).
    expect(screen.queryByRole('heading', { level: 1, name: adminTitle })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить пользователя' })).toBeNull();
    // The cabinet sidebar must not expose the admin section either
    // (`nav.section.admin` section header, `nav.users` nav item).
    expect(screen.queryByText('Администрирование')).toBeNull();
    expect(screen.queryByText('Пользователи')).toBeNull();
  });
});
