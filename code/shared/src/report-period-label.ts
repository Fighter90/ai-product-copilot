/**
 * ANA-39 (report-gost-v2 §4): human-readable period label for the report title page.
 * Pure function of `snapshot.period` — no Date.now, no runtime locale-dependent formatting;
 * identical input always produces an identical label (determinism pinned by tests).
 *
 * Format rule:
 *  - month-aligned period (from = 1st day, to = last day of a month) → «Январь – июнь 2026»;
 *  - single month-aligned month → «Март 2026»;
 *  - month-aligned across years → «Ноябрь 2025 – Февраль 2026»;
 *  - anything else → «01.01.2026 – 04.06.2026» (dd.mm.yyyy);
 *  - unparseable dates degrade deterministically to the raw «from – to» strings.
 */

import type { ReportLocale } from './report-locale';

export interface ReportPeriod {
  readonly from: string;
  readonly to: string;
}

/** RU month nominatives; the second month in a range is printed lowercase via toLowerCase(). */
const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

/** EN month names (ANA-42); ranges keep the second month lowercase, same as RU. */
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Strict UTC parse of YYYY-MM-DD: impossible dates (2026-02-29) return null instead of rolling over. */
function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

function isMonthStart(d: Date): boolean {
  return d.getUTCDate() === 1;
}

function isMonthEnd(d: Date): boolean {
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return d.getUTCDate() === last.getUTCDate();
}

function ddmm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function monthName(d: Date, locale: ReportLocale = 'ru'): string {
  // A 12-tuple; getUTCMonth() is always 0–11, but noUncheckedIndexedAccess needs a guard.
  const months = locale === 'en' ? MONTHS_EN : MONTHS_RU;
  return months[d.getUTCMonth()] ?? months[0];
}

export function reportPeriodLabel(period: ReportPeriod, locale: ReportLocale = 'ru'): string {
  const from = parseDate(period.from);
  const to = parseDate(period.to);
  if (!from || !to) return `${period.from} – ${period.to}`;

  if (!isMonthStart(from) || !isMonthEnd(to)) {
    return `${ddmm(from)} – ${ddmm(to)}`;
  }

  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();

  if (from.getUTCMonth() === to.getUTCMonth() && sameYear) {
    return `${monthName(from, locale)} ${from.getUTCFullYear()}`;
  }

  const first = `${monthName(from, locale)}${sameYear ? '' : ` ${from.getUTCFullYear()}`}`;
  // Same-year ranges lowercase the second month in Russian («Февраль – май 2026»); English keeps
  // month names capitalized ("January – June 2026"); cross-year ones capitalize both.
  const second =
    sameYear && locale === 'ru' ? monthName(to, locale).toLowerCase() : monthName(to, locale);
  const last = `${second} ${to.getUTCFullYear()}`;
  return `${first} – ${last}`;
}
