import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';
import { NotFound } from './NotFound';

/**
 * ANA-174: an unknown URL must show an explicit «not found» state with a way
 * back to the home page — never a silent redirect.
 */
describe('NotFound', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders the 404 copy in Russian with a link to the home page', () => {
    renderWithProviders(<NotFound />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Страница не найдена' }),
    ).toBeInTheDocument();
    const home = screen.getByRole('link', { name: /На главную/ });
    expect(home).toHaveAttribute('href', '/');
  });

  it('renders without Cyrillic in English', () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<NotFound />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/./);
    expect(screen.getByRole('link', { name: /Back to home/ })).toHaveAttribute('href', '/');
    expectNoCyrillic(container);
  });
});
