import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InfoHint } from './InfoHint';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

describe('InfoHint', () => {
  it('is a labelled button described by its (hidden) popover', () => {
    render(<InfoHint text="CR = заявки / визиты" />);
    const btn = screen.getByRole('button', { name: 'Подсказка' });
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(btn).toHaveAttribute('aria-describedby', tip.id);
    expect(btn).toHaveAccessibleDescription('CR = заявки / визиты');
    expect(tip).toHaveClass('sr-only');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('uses a custom accessible label', () => {
    render(<InfoHint text="x" label="Что такое CR" />);
    expect(screen.getByRole('button', { name: 'Что такое CR' })).toBeInTheDocument();
  });

  it('opens on keyboard focus and closes on blur', () => {
    render(<InfoHint text="определение" />);
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('определение');
    fireEvent.blur(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on hover and closes on mouse leave', () => {
    const { container } = render(<InfoHint text="hover" />);
    const wrap = container.firstElementChild!;
    fireEvent.mouseEnter(wrap);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseLeave(wrap);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('click pins it open; Escape and an outside click close it', () => {
    render(
      <div>
        <InfoHint text="pinned" align="end" />
        <p>outside</p>
      </div>,
    );
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('ignores Escape while closed and keeps it open on an inside mousedown', () => {
    render(<InfoHint text="inside" />);
    const btn = screen.getByRole('button');
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    fireEvent.mouseDown(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('InfoHint (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('names the button in English', () => {
    setTestLocale('en');
    const { container } = render(<InfoHint text="definition" />);
    expect(screen.getByRole('button', { name: 'Hint' })).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
