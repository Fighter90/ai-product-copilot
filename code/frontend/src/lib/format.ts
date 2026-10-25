import { clampRatio } from '@pca/shared';

/** Locale-aware number/date formatting: follows the interface language (pca.locale). */
function localeTag(): 'ru-RU' | 'en-US' {
  try {
    return localStorage.getItem('pca.locale') === 'en' ? 'en-US' : 'ru-RU';
  } catch {
    return 'ru-RU';
  }
}

/** Integer with thin-space grouping, following the active locale. */
export function formatInt(n: number): string {
  return new Intl.NumberFormat(localeTag()).format(Math.round(n));
}

/**
 * Ratio (0..1) → percent string. Defensively clamps to [0, 1] so a stray rate > 100% (Metrika can
 * return conversionRate > 1 on multi-goal pages) renders as "100.0%" instead of e.g. "200.0%".
 */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(clampRatio(ratio) * 100).toFixed(digits)}%`;
}

/** ISO timestamp/date → YYYY-MM-DD. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
