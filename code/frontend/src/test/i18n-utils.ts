import { expect } from 'vitest';
import { act } from '@testing-library/react';
import { usePrefs, type Locale } from '../store/prefs';

const CYRILLIC = /[\u0400-\u04FF]/;
const TEXT_ATTRS = ['aria-label', 'title', 'placeholder', 'alt'] as const;

/** Switch the interface language for a test (also updates localStorage, read by lib/format). */
export function setTestLocale(locale: Locale): void {
  act(() => usePrefs.getState().setLocale(locale));
}

/**
 * Assert that a rendered tree has no Cyrillic in its visible text or text-bearing attributes.
 * `ignore` selectors drop subtrees that legitimately hold Russian data (mocked user data, report
 * document content produced by the backend) before checking.
 */
export function expectNoCyrillic(
  container: HTMLElement | Document = document.body,
  { ignore = [] }: { ignore?: string[] } = {},
): void {
  const root = (container instanceof Document ? container.body : container).cloneNode(
    true,
  ) as HTMLElement;
  for (const sel of ignore) root.querySelectorAll(sel).forEach((el) => el.remove());

  const offenders: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? '';
    if (CYRILLIC.test(text)) offenders.push(text.trim());
  }
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of TEXT_ATTRS) {
      const v = el.getAttribute(attr);
      if (v && CYRILLIC.test(v)) offenders.push(`[${attr}] ${v}`);
    }
  }
  expect(offenders, `Cyrillic text found:\n${offenders.join('\n')}`).toEqual([]);
}
