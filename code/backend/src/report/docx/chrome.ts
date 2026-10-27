import type { ReportLocale } from '@pca/shared';

/**
 * Static «chrome» of the ГОСТ report (ANA-42): title-page wording, «СОДЕРЖАНИЕ» / «ПЕРЕЧЕНЬ
 * РИСУНКОВ» headings, figure captions. Russian strings are byte-identical to the pre-i18n
 * renderers (the ГОСТ verifier depends on it); English ones mirror the shared REPORT_TEXT.en.
 * Content itself (sections, tables, data lines) is translated in shared reportSections —
 * this table only covers what the renderers hard-code around it.
 */
export interface ReportChrome {
  /** Cover: main title, subtitle, track line. */
  readonly reportTitle: string;
  readonly reportSubtitle: string;
  readonly track: string;
  /** Table of contents heading + the small-print notes. */
  readonly contents: string;
  /** DOCX only: the TOC field must be refreshed (F9) to fill page numbers. */
  readonly tocFieldHint: string;
  /** PDF only: static TOC note (no updatable field there). */
  readonly tocNote: string;
  readonly figures: string;
  /** ГОСТ figure caption «Рисунок N — заголовок» / «Figure N — heading». */
  readonly figure: (n: number, heading: string) => string;
  /** Fallback caption when the section carries no number (defensive branch). */
  readonly figureNoNumber: (heading: string) => string;
  /** Cover meta block. */
  readonly periodLabel: string;
  readonly sources: string;
  readonly preparedBy: string;
  /** Appendix headings are kept verbatim (no through number, no caps) when they start with this. */
  readonly appendixPrefix: string;
}

const RU: ReportChrome = {
  reportTitle: 'АНАЛИТИЧЕСКИЙ ОТЧЁТ',
  reportSubtitle: 'по данным веб-аналитики Яндекс.Метрики',
  track: 'Трек «Конверсии и лидген»',
  contents: 'СОДЕРЖАНИЕ',
  tocFieldHint: 'Обновите поле (F9), чтобы проставились страницы',
  tocNote: 'Примечание: содержание сформировано по заголовкам разделов отчёта.',
  figures: 'ПЕРЕЧЕНЬ РИСУНКОВ',
  figure: (n, heading) => `Рисунок ${n} — ${heading}`,
  figureNoNumber: (heading) => `Рисунок — ${heading}`,
  periodLabel: 'Период данных:',
  sources: 'Источники: Reporting API Яндекс.Метрики; данные счётчика ProductCamp',
  preparedBy: 'Подготовлено: ProductCamp Analytics Copilot · версия отчёта ГОСТ-2',
  appendixPrefix: 'Приложение',
};

const EN: ReportChrome = {
  reportTitle: 'ANALYTICAL REPORT',
  reportSubtitle: 'based on Yandex Metrica web analytics',
  track: 'Track “Conversions & Lead Generation”',
  contents: 'CONTENTS',
  tocFieldHint: 'Update the field (F9) to fill in page numbers',
  tocNote: 'Note: the table of contents is built from the report section headings.',
  figures: 'LIST OF FIGURES',
  figure: (n, heading) => `Figure ${n} — ${heading}`,
  figureNoNumber: (heading) => `Figure — ${heading}`,
  periodLabel: 'Data period:',
  sources: 'Sources: Yandex Metrica Reporting API; ProductCamp counter data',
  preparedBy: 'Prepared by: ProductCamp Analytics Copilot · report version GOST-2',
  appendixPrefix: 'Appendix',
};

export const REPORT_CHROME: Record<ReportLocale, ReportChrome> = { ru: RU, en: EN };
