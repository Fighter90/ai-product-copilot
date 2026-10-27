/**
 * Report language (ANA-42). The DOCX/PDF/preview content is built in the locale chosen at export
 * time; Russian stays the default and its output is byte-identical to the pre-i18n report (the ГОСТ
 * verifier and RU tests depend on it). Data values (channel names, hypothesis texts, AI narrative)
 * are printed as stored — only the report's own template text is translated.
 */
export const REPORT_LOCALES = ['ru', 'en'] as const;

export type ReportLocale = (typeof REPORT_LOCALES)[number];

/** Narrow an arbitrary value (query param, UI state) to a supported report locale. */
export function isReportLocale(value: unknown): value is ReportLocale {
  return typeof value === 'string' && (REPORT_LOCALES as readonly string[]).includes(value);
}
