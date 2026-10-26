import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

describe('EmptyState', () => {
  it('renders the default message', () => {
    render(<EmptyState />);
    expect(screen.getByRole('status')).toHaveTextContent(/Нет данных за выбранный период/);
  });

  it('renders a custom message', () => {
    render(<EmptyState message="Пусто" />);
    expect(screen.getByRole('status')).toHaveTextContent('Пусто');
  });
});

describe('EmptyState (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders the default message in English', () => {
    setTestLocale('en');
    const { container } = render(<EmptyState />);
    expect(screen.getByRole('status')).toHaveTextContent(/No data for the selected period/);
    expectNoCyrillic(container);
  });
});
