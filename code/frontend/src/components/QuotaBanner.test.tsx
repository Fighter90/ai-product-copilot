import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { QuotaBanner } from './QuotaBanner';
import { setTestLocale } from '../test/i18n-utils';

describe('QuotaBanner (ANA-112)', () => {
  beforeEach(() => setTestLocale('ru'));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const fire = (): void => {
    act(() => window.dispatchEvent(new CustomEvent('pca:metrika-quota')));
  };

  it('shows on the pca:metrika-quota event with ru text (no cyrillic in en)', () => {
    render(<QuotaBanner />);
    expect(screen.queryByTestId('quota-banner')).toBeNull();
    fire();
    expect(screen.getByTestId('quota-banner')).toHaveTextContent(/квота API/i);
    setTestLocale('en');
    fire();
    expect(screen.getByTestId('quota-banner').textContent).not.toMatch(/[\u0400-\u04FF]/);
  });

  it('dismisses and hides itself after 2 minutes', () => {
    vi.useFakeTimers();
    render(<QuotaBanner />);
    fire();
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
    expect(screen.queryByTestId('quota-banner')).toBeNull();
    fire();
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByTestId('quota-banner')).toBeNull();
  });
});
