import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: null, login: vi.fn() }),
}));
import { Login } from './Login';

describe('Login', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders the sign-in form in Russian', () => {
    renderWithProviders(<Login />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText(/Email|Почта/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Пароль/i)).toBeInTheDocument();
  });

  it('renders without Cyrillic in English', () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<Login />);
    expect(container.querySelector('button[type="submit"]')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
