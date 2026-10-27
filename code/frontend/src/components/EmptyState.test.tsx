import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

const auth = vi.hoisted(() => ({ isAdmin: false, inProvider: false }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => {
    if (!auth.inProvider) throw new Error('useAuth must be used inside <AuthProvider>');
    return { isAdmin: auth.isAdmin };
  },
}));

afterEach(() => {
  auth.isAdmin = false;
  auth.inProvider = false;
});

describe('EmptyState', () => {
  it('renders the default message', () => {
    render(<EmptyState />);
    expect(screen.getByRole('status')).toHaveTextContent(/Нет данных за выбранный период/);
  });

  it('renders a custom message', () => {
    render(<EmptyState message="Пусто" />);
    expect(screen.getByRole('status')).toHaveTextContent('Пусто');
  });

  it('offers the help article to an analyst (no provider → plain link)', () => {
    render(<EmptyState />);
    expect(screen.getByRole('link', { name: 'Открыть справку' })).toHaveAttribute(
      'href',
      '/help/start',
    );
  });

  it('offers «Запустить синхронизацию» to an admin', () => {
    auth.inProvider = true;
    auth.isAdmin = true;
    renderWithProviders(<EmptyState />);
    expect(screen.getByRole('link', { name: 'Запустить синхронизацию' })).toHaveAttribute(
      'href',
      '/app/admin/metrika',
    );
  });

  it('uses a router link for an analyst inside the app', () => {
    auth.inProvider = true;
    renderWithProviders(<EmptyState />);
    expect(screen.getByRole('link', { name: 'Открыть справку' })).toBeInTheDocument();
  });

  it('renders a custom button action', () => {
    const onClick = vi.fn();
    render(<EmptyState action={{ label: 'Повторить', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('hides the action with action={null}', () => {
    render(<EmptyState action={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EmptyState (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders the default message and action in English', () => {
    setTestLocale('en');
    const { container } = render(<EmptyState />);
    expect(screen.getByRole('status')).toHaveTextContent(/No data for the selected period/);
    expect(screen.getByRole('link', { name: 'Open help' })).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
