import { useCallback } from 'react';
import { usePrefs, type Locale } from '../store/prefs';
import { CHANNELS, en, ru, type DictKey } from './dict';

const DICTS: Record<Locale, Record<DictKey, string>> = { ru, en };

/** Translate a key for a locale with `{var}` substitution. Unknown keys return the key itself. */
export function translate(
  locale: Locale,
  key: DictKey,
  vars?: Record<string, string | number>,
): string {
  const s = DICTS[locale][key] ?? DICTS.ru[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s;
}

/** React hook: `const { t, locale } = useT(); t('nav.overview')`. */
export function useT(): {
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  locale: Locale;
} {
  const locale = usePrefs((s) => s.locale);
  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
  return { t, locale };
}

/** Localised Metrika channel name (falls back to the original). */
export function channelName(name: string, locale: Locale): string {
  return CHANNELS[name]?.[locale] ?? name;
}

/** Locale-aware number formatting (one locale everywhere — audit finding ANA-54). */
export function fmtNum(n: number, locale: Locale, digits = 0): string {
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);
}

export function fmtPct(n: number, locale: Locale, digits = 1): string {
  return `${fmtNum(n, locale, digits)}%`;
}

export function fmtDate(iso: string, locale: Locale, withTime = false): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** "12 s ago" / "3 min ago". */
export function ago(iso: string, locale: Locale, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return translate(locale, 'common.justNow');
  if (s < 90) return translate(locale, 'common.secondsAgo', { n: s });
  return translate(locale, 'common.minutesAgo', { n: Math.round(s / 60) });
}

export type { DictKey };
