import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChartCaption } from './ChartCaption';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';

describe('ChartCaption', () => {
  it('collapses correct / caveat / advice into one «i» popover, closed by default', () => {
    render(
      <ChartCaption correct="визиты из БД" caveat="UTM не размечены" advice="размечайте UTM" />,
    );
    const btn = screen.getByRole('button', { name: 'Об этом графике' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    // Content stays in the DOM (screen readers get it via aria-describedby) but is hidden.
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip).toHaveClass('sr-only');
    expect(btn).toHaveAttribute('aria-describedby', tip.id);
    expect(screen.getByText('визиты из БД')).toBeInTheDocument();
    expect(screen.getByText('UTM не размечены')).toBeInTheDocument();
    expect(screen.getByText('размечайте UTM')).toBeInTheDocument();
    expect(screen.getByText('🔴 Внимание')).toBeInTheDocument();
  });

  it('renders no visible text block under the chart — one popover only', () => {
    const { container } = render(<ChartCaption correct="a" advice="b" />);
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('opens on click and closes on Escape', () => {
    render(<ChartCaption correct="данные корректны" advice="продолжайте" />);
    const btn = screen.getByRole('button', { name: 'Об этом графике' });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).not.toHaveClass('sr-only');
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('omits the caveat row when no caveat is given', () => {
    render(<ChartCaption correct="данные корректны" advice="продолжайте" />);
    expect(screen.getByText('данные корректны')).toBeInTheDocument();
    expect(screen.getByText('продолжайте')).toBeInTheDocument();
    expect(screen.queryByText('🔴 Внимание')).not.toBeInTheDocument();
  });
});

describe('ChartCaption (en locale)', () => {
  afterEach(() => setTestLocale('ru'));

  it('translates the Correct / Caution / Recommendation labels and the button name', () => {
    setTestLocale('en');
    const { container } = render(<ChartCaption correct="ok" caveat="careful" advice="do it" />);
    expect(screen.getByRole('button', { name: 'About this chart' })).toBeInTheDocument();
    expect(screen.getByText('🟢 Correct')).toBeInTheDocument();
    expect(screen.getByText('🔴 Caution')).toBeInTheDocument();
    expect(screen.getByText('💡 Recommendation')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});
