import { describe, it, expect } from 'vitest';
import { enablePrintStylesheet } from './font-media';

/**
 * CSP прода блокирует инлайновый `onload` у `<link media="print">` (БАГ из верификации 04.11:
 * «Executing inline event handler violates … script-src …»), поэтому подмена media делается
 * из бандла. Регресс-тесты: helper находит правильный link и делает его screen-стилем.
 */
describe('enablePrintStylesheet', () => {
  it('flips the print-only font stylesheet to media=all', () => {
    document.head.innerHTML =
      '<link rel="preconnect" href="https://fonts.googleapis.com" />' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap" media="print" />';

    const link = enablePrintStylesheet();

    expect(link).not.toBeNull();
    expect(link!.media).toBe('all');
  });

  it('does not touch stylesheets that are already applicable (no media=print link → no-op)', () => {
    document.head.innerHTML = '<link rel="stylesheet" href="/assets/index.css" media="all" />';
    const before = document.head.innerHTML;

    const link = enablePrintStylesheet();

    expect(link).toBeNull();
    expect(document.head.innerHTML).toBe(before);
  });

  it('is idempotent — after the flip nothing is left to enable', () => {
    document.head.innerHTML =
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap" media="print" />';

    enablePrintStylesheet();
    // Second call: the print-only link no longer exists → nothing to do, media stays «all».
    const again = enablePrintStylesheet();

    expect(again).toBeNull();
    expect(
      document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis"]')!
        .media,
    ).toBe('all');
  });
});
