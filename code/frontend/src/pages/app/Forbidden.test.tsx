import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';
import { Forbidden } from './Forbidden';

describe('Forbidden', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders the 403 copy in Russian', () => {
    renderWithProviders(<Forbidden />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveTextContent('Обзор');
  });

  it('renders without Cyrillic in English', () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<Forbidden />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/./);
    expect(screen.getByRole('link')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
