import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within, act } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { CabinetLayout } from './CabinetLayout';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

// API-клиент CabinetLayout/фильтров мокаем целиком: сеть в тестах не нужна.
vi.mock('../lib/api-v3', () => ({
  v3: {
    notifications: vi.fn(async () => []),
    readNotifications: vi.fn(async () => ({ ok: true as const })),
    updateMe: vi.fn(async () => ({ user: null })),
    changePassword: vi.fn(async () => ({ ok: true as const })),
  },
}));

// Сессия: аналитик (админ-раздел сайдбара скрыт), logout — spy.
const logout = vi.fn(async () => undefined);
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      email: 'analyst@pca.io',
      name: 'Тест Аналитик',
      role: 'analyst' as const,
      locale: 'ru' as const,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      lastLoginAt: null,
    },
    loading: false,
    isAdmin: false,
    login: vi.fn(),
    logout,
    refresh: vi.fn(),
  }),
}));

// FilterBar тянет свои запросы — для навигационных тестов не важен.
vi.mock('./FilterBar', () => ({ FilterBar: () => <div data-testid="filter-bar" /> }));

function renderCabinet(route = '/app', { tourDone = true }: { tourDone?: boolean } = {}) {
  // The onboarding tour has its own suite; keep it closed in layout tests…
  if (tourDone) window.localStorage.setItem('pca.tour.v1.analyst', 'done');
  else window.localStorage.removeItem('pca.tour.v1.analyst');
  return renderWithProviders(
    <Routes>
      <Route path="/app" element={<CabinetLayout />}>
        <Route index element={<div>OVERVIEW PAGE</div>} />
        <Route path="traffic" element={<div>TRAFFIC PAGE</div>} />
      </Route>
    </Routes>,
    route,
  );
}

function hamburger(): HTMLElement {
  return screen.getByRole('button', { name: /menu/i });
}

/** Открыть drawer и вернуть его <nav> (второй nav «cabinet» в DOM: десктоп + drawer). */
function openDrawer(): HTMLElement {
  fireEvent.click(hamburger());
  expect(hamburger()).toHaveAttribute('aria-expanded', 'true');
  const navs = screen.getAllByRole('navigation', { name: 'cabinet' });
  return navs[navs.length - 1]!;
}

describe('CabinetLayout', () => {
  it('renders the desktop sidebar with brand and cabinet nav items', () => {
    const { container } = renderCabinet();
    // Десктопный сайдбар (первый aside) с навигацией «cabinet».
    const sidebar = container.querySelector('aside');
    expect(sidebar).not.toBeNull();
    expect(within(sidebar!).getByRole('navigation', { name: 'cabinet' })).toBeInTheDocument();
    expect(within(sidebar!).getByRole('link', { name: 'Обзор' })).toHaveAttribute('href', '/app');
    expect(within(sidebar!).getByRole('link', { name: 'Трафик' })).toBeInTheDocument();
    // Лого ведёт на публичную часть.
    expect(screen.getByRole('link', { name: /Analytics Copilot/i })).toHaveAttribute('href', '/');
    // Роут-аутлет отрендерился.
    expect(screen.getByText('OVERVIEW PAGE')).toBeInTheDocument();
  });

  it('shows QuotaBanner (ANA-112) above <main>, not at the bottom of the document', () => {
    // Prod-регрессия: баннер висел последним ребёнком корневого div — ниже <main> и
    // футера (y≈1231px из 1268px), пользователь его не видел без прокрутки.
    const { container } = renderCabinet();
    act(() => window.dispatchEvent(new CustomEvent('pca:metrika-quota')));
    const banner = screen.getByTestId('quota-banner');
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    // Порядок в DOM: баннер раньше <main> (и раньше футера) — т.е. над контентом.
    expect(banner.compareDocumentPosition(main!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('toggles aria-expanded on the hamburger and slides the drawer panel', () => {
    renderCabinet();
    expect(hamburger()).toHaveAttribute('aria-expanded', 'false');
    expect(hamburger()).toHaveAttribute('aria-controls', 'mobile-drawer');
    // Drawer всегда в DOM, но в свёрнутом состоянии инертный и спрятан за левый край.
    const drawer = document.getElementById('mobile-drawer')!;
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    const panel = screen.getByTestId('mobile-drawer-panel');
    expect(panel.className).toContain('-translate-x-full');

    fireEvent.click(hamburger());
    expect(hamburger()).toHaveAttribute('aria-expanded', 'true');
    expect(drawer).toHaveAttribute('aria-hidden', 'false');
    expect(panel.className).toContain('translate-x-0');
    expect(panel.className).not.toContain('-translate-x-full');

    // Закрытие по Esc возвращает aria-expanded=false и прячет панель.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(hamburger()).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(panel.className).toContain('-translate-x-full');
  });

  it('closes the drawer on backdrop click', () => {
    renderCabinet();
    openDrawer();
    fireEvent.click(screen.getByTestId('mobile-drawer-backdrop'));
    expect(hamburger()).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('mobile-drawer')).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes the drawer after navigating via a drawer link', () => {
    renderCabinet('/app');
    const drawerNav = openDrawer();
    fireEvent.click(within(drawerNav).getByRole('link', { name: 'Трафик' }));
    // Роут сменился и меню закрылось.
    expect(screen.getByText('TRAFFIC PAGE')).toBeInTheDocument();
    expect(hamburger()).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('mobile-drawer')).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks the nav item matching the current route as active', () => {
    renderCabinet('/app/traffic');
    // Активность проверяем в drawer-навигации (открываем меню).
    const drawerNav = openDrawer();
    const active = within(drawerNav).getByRole('link', { name: 'Трафик' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active.className).toContain('text-accent');
    // Соседний пункт не активен.
    const overview = within(drawerNav).getByRole('link', { name: 'Обзор' });
    expect(overview).not.toHaveAttribute('aria-current');
  });

  it('mounts the role tour (opens on the first visit) and the header help link', () => {
    renderCabinet('/app/traffic', { tourDone: false });
    // ANA-47: тур смонтирован в оболочке кабинета и открыт при первом входе.
    expect(screen.getByRole('dialog', { name: 'Добро пожаловать в кабинет' })).toBeInTheDocument();
    // ANA-45: «?» в шапке ведёт на статью текущего раздела.
    const help = screen.getByRole('link', { name: 'Справка по этому разделу' });
    expect(help).toHaveAttribute('href', '/help/traffic-behavior');
  });

  it('shows the build-mismatch wiring in the footer without a false badge', () => {
    // /api/health недоступен в jsdom → бейдж не рисуется, футер не падает.
    const { container } = renderCabinet();
    const footer = container.querySelector('footer')!;
    // Версия в футере + сайдбаре; бейджа расхождения без ответа /api/health нет.
    expect(within(footer).getAllByTestId('version-badge').length).toBe(1);
    expect(within(footer).queryByTestId('build-mismatch')).toBeNull();
    expect(footer.textContent).toContain('ProductCamp');
  });
});

describe('CabinetLayout user menu', () => {
  it('opens «Сменить пароль» from the user menu and closes the menu on Escape', () => {
    renderCabinet();
    const trigger = screen.getByRole('button', { name: 'Меню пользователя' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('analyst@pca.io')).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Сменить пароль' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Текущий пароль')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('signs out from the menu and closes it on an outside click', () => {
    renderCabinet();
    fireEvent.click(screen.getByRole('button', { name: 'Меню пользователя' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Меню пользователя' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Выйти' }));
    expect(logout).toHaveBeenCalled();
  });

  it('header, menu and password dialog have no Cyrillic in English (user data aside)', () => {
    setTestLocale('en');
    try {
      renderCabinet();
      fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Change password' }));
      // The mocked user name «Тест Аналитик» is data, not UI copy.
      expectNoCyrillic(document.body, { ignore: ['[data-user-data]'] });
    } finally {
      setTestLocale('ru');
    }
  });
});
