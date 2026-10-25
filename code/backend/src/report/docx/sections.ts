/**
 * Report section content lives in @pca/shared (single source of truth for DOCX, PDF and the
 * on-screen preview). Re-exported here to keep existing backend import paths working.
 *
 * The backend-facing {@link ReportSection} is a structural superset of the shared section type:
 * it tolerates optional render hints (`caption` — подпись рисунка) that the shared schema gains
 * over time. The DOCX builder reads them defensively (absent → derived defaults), so sections
 * produced by older or newer @pca/shared builds remain renderable without backend changes.
 */
import { reportSections as sharedReportSections } from '@pca/shared';
import type { ReportChartId, ReportSnapshot } from '@pca/shared';

export interface ReportSection {
  readonly heading: string;
  readonly lines: string[];
  /** When set and snapshot.charts has this id, renderers embed the chart PNG at the top of the section. */
  readonly chartId?: ReportChartId;
  /** Optional figure caption («Рисунок N — …»); renderers fall back to `Рисунок N — ${heading}`. */
  readonly caption?: string;
}

/** Shared sections are structurally compatible with the backend superset (extra fields allowed). */
export function reportSections(snapshot: ReportSnapshot): ReportSection[] {
  return sharedReportSections(snapshot);
}

/**
 * Front matter — разделы, идущие до основного текста. По ГОСТ Р 7.32-2017 и эталону заказчика
 * они НЕ входят в сквозную нумерацию разделов (нумерация начинается с «Краткие итоги»).
 */
export const FRONT_HEADINGS: ReadonlySet<string> = new Set([
  'ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ',
  'ВВЕДЕНИЕ',
  'УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ',
]);

/** True, если раздел — фронт-материя (без номера в оглавлении и заголовке). */
export function isFrontMatter(heading: string): boolean {
  return FRONT_HEADINGS.has(heading.trim().toUpperCase());
}
