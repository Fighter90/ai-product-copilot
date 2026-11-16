import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';
import { fireEvent, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { usePrefs } from '../../store/prefs';

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
   * ANA-172 (re-verified 16.11): the footer «История изменений» link was REMOVED — both
   * candidate URLs 404 for any visitor (the old repo name does not exist, the current
   * repo `ai-product-copilot` is private). The version badge is plain text now.
   */
  it.each(['ru', 'en'] as const)('[%s] footer has no dead changelog link (ANA-172)', (locale) => {
    setTestLocale(locale);
    const { container } = renderWithProviders(<Landing />);
    const anchors = Array.from(container.querySelectorAll('a'));
    const changelogLinks = anchors.filter((a) =>
      (a.getAttribute('href') ?? '').includes('CHANGELOG.md'),
    );
    expect(changelogLinks).toEqual([]);
    // Neither the dead old repo name nor the private current repo name may appear as links.
    const deadRepoLinks = anchors.filter((a) =>
      (a.getAttribute('href') ?? '').includes('yandex-metrika-analyse-dashboard'),
    );
    expect(deadRepoLinks).toEqual([]);
    const privateRepoLinks = anchors.filter((a) =>
      (a.getAttribute('href') ?? '').includes('ai-product-copilot'),
    );
    expect(privateRepoLinks).toEqual([]);
    // The version badge still renders the build label (now as plain text, not a link).
    expect(document.querySelector('[data-testid="version-badge"]')).not.toBeNull();
  });
});

/** Router location probe (MemoryRouter does not touch window.location). */
function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <span data-testid="loc">{loc.pathname + loc.search + loc.hash}</span>;
}

/**
 * ANA-173 (регресс прод 15.11) — «мёртвые» интеракции хедера на лендинге:
 * 1) EN-тумблер не менял язык (в кабинете работает — там выбор переживает reload за счёт
 *    серверного профиля, на публичных страницах выбор держится только на хранилище);
 * 2) анкор «Как это работает» (#how) не скроллил (scrollY=0, hash пустой).
 */
describe('Landing header interactions (ANA-173)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('pca.locale', 'ru');
    window.localStorage.setItem('pca.theme', 'dark');
    usePrefs.setState({ theme: 'dark', locale: 'ru', sidebarCollapsed: false });
    document.documentElement.lang = 'ru';
    document.documentElement.dataset.theme = 'dark';
  });

  it('storage denied: EN in the public header switches the landing language in place', () => {
    // Профиль QA-браузера запрещает хранилище: раньше выбор «испарялся» при reload
    // и страница возвращалась на RU (aria-pressed=false, h1 RU, lang=ru).
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    const { container } = renderWithProviders(<Landing />);
    const en = screen.getByRole('button', { name: 'en' });
    fireEvent.click(en);
    // Язык применён на месте: атрибуты <html>, состояние тумблера и тексты лендинга.
    expect(document.documentElement.lang).toBe('en');
    expect(en.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('h1')?.textContent).toContain('From Metrika');
  });

  it('EN in the public header persists the choice to storage (survives the reload)', () => {
    // Живое хранилище: клик по EN в хедере лендинга обязан записать выбор —
    // именно он переживает перезагрузку страницы в проде.
    const { container } = renderWithProviders(<Landing />);
    fireEvent.click(screen.getByRole('button', { name: 'en' }));
    expect(usePrefs.getState().locale).toBe('en');
    expect(window.localStorage.getItem('pca.locale')).toBe('en');
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent === 'en' && b.getAttribute('aria-pressed') === 'true',
      ),
    ).toBe(true);
  });

  it('«Как это работает» (#how) scrolls to the section and syncs the hash', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { container, getByTestId } = renderWithProviders(
        <>
          <LocationProbe />
          <Landing />
        </>,
      );
      const anchor = container.querySelector<HTMLAnchorElement>('a[href="#how"]');
      expect(anchor).not.toBeNull();
      // Цель анкора существует (предусловие нативного скролла).
      expect(document.getElementById('how')).not.toBeNull();
      fireEvent.click(anchor!);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect((scrollIntoView.mock.instances[0] as HTMLElement).id).toBe('how');
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      // Hash синхронизирован через роутер.
      expect(getByTestId('loc').textContent).toBe('/#how');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('respects prefers-reduced-motion: scrolls to #how instantly', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    // jsdom не имеет matchMedia — подставляем и восстанавливаем вручную.
    const originalMm = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
    try {
      const { container } = renderWithProviders(<Landing />);
      fireEvent.click(container.querySelector<HTMLAnchorElement>('a[href="#how"]')!);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    } finally {
      window.matchMedia = originalMm;
      Element.prototype.scrollIntoView = original;
    }
  });
});
