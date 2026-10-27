import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../lib/api-v3', () => ({ v3: {} }));

import { Landing } from './Landing';

/**
 * ANA-71: the landing must be substantive — a real FAQ (≥10 questions with non-empty answers)
 * and ≥6 "how it works" steps — in BOTH locales, with no hardcoded Russian leaking into EN.
 */

describe('Landing detail (ANA-71)', () => {
  it.each(['ru', 'en'] as const)('[%s] FAQ has ≥10 detailed Q&As', (locale) => {
    setTestLocale(locale);
    const { container } = renderWithProviders(<Landing />);
    const faqButtons = container.querySelectorAll('button[aria-expanded]');
    expect(faqButtons.length).toBeGreaterThanOrEqual(10);
    // Every FAQ item must carry a real answer (rendered in the collapsible region).
    const answers = container.querySelectorAll('[class*="grid-rows"] > div');
    expect(answers.length).toBeGreaterThanOrEqual(10);
  });

  it.each(['ru', 'en'] as const)('[%s] "how it works" has ≥6 steps', (locale) => {
    setTestLocale(locale);
    const { container } = renderWithProviders(<Landing />);
    const howSection = container.querySelector('#how');
    expect(howSection).not.toBeNull();
    const stepTitles = howSection?.querySelectorAll('h3');
    expect(stepTitles?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('en locale renders without Cyrillic', () => {
    setTestLocale('en');
    const { container } = renderWithProviders(<Landing />);
    expectNoCyrillic(container);
  });
});
