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

  /**
   * ANA-172: the footer «История изменений» link (and the VersionBadge next to it) must
   * point at the project's own repository — the old ai-product-copilot URLs 404 after the
   * repo was renamed to yandex-metrika-analyse-dashboard.
   */
  it.each(['ru', 'en'] as const)(
    '[%s] footer changelog links point at the project repo (ANA-172)',
    (locale) => {
      setTestLocale(locale);
      const { container } = renderWithProviders(<Landing />);
      const changelogLinks = Array.from(
        container.querySelectorAll<HTMLAnchorElement>('a[href*="CHANGELOG.md"]'),
      );
      expect(changelogLinks.length).toBeGreaterThan(0);
      for (const link of changelogLinks) {
        expect(link.getAttribute('href')).toBe(
          'https://github.com/Fighter90/yandex-metrika-analyse-dashboard/blob/main/CHANGELOG.md',
        );
      }
      // No anchor anywhere on the landing may keep the stale (404) repo name.
      const stale = Array.from(container.querySelectorAll('a')).filter((a) =>
        (a.getAttribute('href') ?? '').includes('ai-product-copilot'),
      );
      expect(stale).toEqual([]);
    },
  );
});
