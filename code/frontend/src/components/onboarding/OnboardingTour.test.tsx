import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { CabinetTour, OnboardingTour } from './OnboardingTour';
import { RestartTourButton } from './RestartTourButton';
import {
  TOUR_OFF_KEY,
  isTourDone,
  isTourSuppressed,
  markTourDone,
  restartTour,
  tourSteps,
} from './tour';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';

const session = vi.hoisted(() => ({ role: 'analyst' as 'admin' | 'analyst' | null }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: session.role ? { role: session.role } : null }),
}));

function Where(): JSX.Element {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderTour(role: 'admin' | 'analyst' | null, route = '/app/traffic') {
  return renderWithProviders(
    <>
      <OnboardingTour role={role} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>,
    route,
  );
}

beforeEach(() => {
  window.localStorage.removeItem('pca.tour.v1.admin');
  window.localStorage.removeItem('pca.tour.v1.analyst');
  window.localStorage.removeItem(TOUR_OFF_KEY);
  session.role = 'analyst';
});
afterEach(() => setTestLocale('ru'));

describe('tour steps', () => {
  it('analyst: period → weak spots → hypothesis → report', () => {
    expect(tourSteps('analyst').map((s) => s.id)).toEqual([
      'welcome',
      'period',
      'weak',
      'hypothesis',
      'report',
    ]);
  });

  it('admin: the analyst path plus users, Metrika and providers', () => {
    const admin = tourSteps('admin');
    expect(admin.map((s) => s.id)).toEqual([
      'welcome',
      'period',
      'weak',
      'hypothesis',
      'report',
      'users',
      'metrika',
      'providers',
    ]);
    expect(admin[0]!.body).toBe('hint.tour.welcome.admin');
  });

  it('stores the «seen» flag per role and restart clears it', () => {
    markTourDone('admin');
    expect(isTourDone('admin')).toBe(true);
    expect(isTourDone('analyst')).toBe(false);
    restartTour();
    expect(isTourDone('admin')).toBe(false);
  });
});

describe('OnboardingTour', () => {
  it('opens on the first visit as a labelled, non-modal dialog', () => {
    renderTour('analyst');
    const dlg = screen.getByRole('dialog', { name: 'Добро пожаловать в кабинет' });
    expect(dlg).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByText('Шаг 1 из 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Далее' })).toHaveFocus();
  });

  it('does not open once completed, nor without a role', () => {
    markTourDone('analyst');
    const { unmount } = renderTour('analyst');
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    renderTour(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Next/Back walk the steps and navigate to their sections; Finish marks it done', () => {
    renderTour('analyst');
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByText('Шаг 2 из 5')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/app');
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/report');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('Шаг 3 из 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('Шаг 1 из 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByText(/Пройти тур заново/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isTourDone('analyst')).toBe(true);
  });

  it('admins get 8 steps ending with AI providers', () => {
    renderTour('admin');
    expect(screen.getByText('Шаг 1 из 8')).toBeInTheDocument();
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByRole('dialog', { name: 'AI-провайдеры' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/app/admin/ai');
  });

  it('is dismissible with the close icon, the skip link or Escape', () => {
    const { unmount } = renderTour('analyst');
    fireEvent.click(screen.getAllByRole('button', { name: 'Пропустить тур' })[0]!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isTourDone('analyst')).toBe(true);
    unmount();

    window.localStorage.removeItem('pca.tour.v1.analyst');
    renderTour('analyst');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isTourDone('analyst')).toBe(true);
  });

  it('restarts in place on the restart event', () => {
    markTourDone('analyst');
    renderTour('analyst');
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => restartTour());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ignores the restart event without a role', () => {
    renderTour(null);
    act(() => restartTour());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders in English', () => {
    setTestLocale('en');
    renderTour('admin');
    const dlg = screen.getByRole('dialog', { name: 'Welcome to the cabinet' });
    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument();
    expectNoCyrillic(dlg);
  });
});

describe('CabinetTour', () => {
  it('binds the tour to the signed-in role', () => {
    session.role = 'admin';
    renderWithProviders(<CabinetTour />);
    expect(screen.getByText('Шаг 1 из 8')).toBeInTheDocument();
  });

  it('renders nothing for a guest', () => {
    session.role = null;
    renderWithProviders(<CabinetTour />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('suppression (ANA-141: ?tour=0 / qa-notour)', () => {
  /** jsdom has no address bar; point window.location at `/${search}` and restore it after. */
  const setSearch = (search: string): void => {
    window.history.replaceState(null, '', `/${search}`);
  };

  afterEach(() => setSearch(''));

  it('isTourSuppressed: only ?tour=0 or the qa-notour flag suppress it', () => {
    setSearch('');
    expect(isTourSuppressed()).toBe(false);
    setSearch('?tour=0');
    expect(isTourSuppressed()).toBe(true);
    setSearch('?tour=1');
    expect(isTourSuppressed()).toBe(false);
    setSearch('');
    window.localStorage.setItem(TOUR_OFF_KEY, '1');
    expect(isTourSuppressed()).toBe(true);
    window.localStorage.removeItem(TOUR_OFF_KEY);
    expect(isTourSuppressed()).toBe(false);
  });

  it('?tour=0 keeps the tour closed on a fresh storage — content is visible without clicks', () => {
    setSearch('?tour=0');
    renderTour('analyst');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the qa-notour flag keeps the tour closed on a fresh storage', () => {
    window.localStorage.setItem(TOUR_OFF_KEY, '1');
    renderTour('analyst');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('?tour=0 also blocks the restart event — scripts never face the tour', () => {
    setSearch('?tour=0');
    markTourDone('analyst');
    renderTour('analyst');
    act(() => restartTour());
    expect(screen.queryByRole('dialog')).toBeNull();
    // restart still cleared the flag; only suppression keeps the tour closed
    expect(isTourDone('analyst')).toBe(false);
  });

  it('the role effect honours suppression when the session resolves', () => {
    setSearch('?tour=0');
    const view = renderTour(null);
    view.rerender(
      <>
        <OnboardingTour role="analyst" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('without suppression a regular user still sees the tour once', () => {
    setSearch('');
    renderTour('analyst');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('RestartTourButton', () => {
  it('clears the flag and opens the cabinet', () => {
    markTourDone('analyst');
    renderWithProviders(
      <>
        <RestartTourButton />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      '/help/start',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Пройти тур заново' }));
    expect(isTourDone('analyst')).toBe(false);
    expect(screen.getByTestId('where')).toHaveTextContent('/app');
  });
});
