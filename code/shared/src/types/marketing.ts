/**
 * ANA-73: weekly marketing / influence-partner metrics — the dashboard replacement for the
 * Google Sheet «Инфопартнеры ProductCamp | лето 2026» (лист «стата»).
 *
 * One value per (weekStart, metricKey). `source` records who produced the value:
 *   manual  — entered/corrected by an admin or analyst in the UI; the sync never overwrites it
 *   import  — bulk-loaded from the historical Google Sheet (real campaign data)
 *   metrika — computed by the weekly sync from the synced Metrika tables / manual DB entries
 * Priority: manual > import > metrika.
 */

export type MarketingSource = 'manual' | 'metrika' | 'import';

export interface MarketingCell {
  /** ISO date of the first day of the campaign week (the sheet's week grid). */
  weekStart: string;
  metricKey: string;
  value: number;
  source: MarketingSource;
  note?: string;
  isDemo?: boolean;
  updatedAt: string;
  updatedBy?: string;
}

export interface NewMarketingCell {
  weekStart: string;
  metricKey: string;
  value: number;
  note?: string;
}

/** One campaign week of the sheet grid (irregular splits — kept exactly as in the source). */
export interface MarketingWeek {
  /** ISO date of the week start, also the grid key. */
  key: string;
  start: string;
  /** ISO date of the week end (inclusive). */
  end: string;
  month: string;
  labelRu: string;
  labelEn: string;
}

export interface MarketingSection {
  key: 'content' | 'influence';
  ru: string;
  en: string;
}

export interface MarketingMetricDef {
  key: string;
  ru: string;
  en: string;
  section: MarketingSection['key'];
  /** Recomputed by the weekly sync from synced Metrika tables / DB entries. */
  sync: boolean;
}

/** GET /api/marketing/weekly — everything the page needs to render the sheet-shaped grid. */
export interface MarketingGrid {
  months: Array<{ key: string; ru: string; en: string }>;
  weeks: MarketingWeek[];
  sections: MarketingSection[];
  metrics: MarketingMetricDef[];
  cells: MarketingCell[];
}

/** POST /api/marketing/weekly/sync result. */
export interface MarketingSyncSummary {
  weeks: number;
  /** Cells written per metric key. */
  updated: Record<string, number>;
  /** Weeks with no source data (pre-launch) — left empty until the historical backfill. */
  skippedWeeks: string[];
  /** Present when a Metrika backfill window was requested. */
  pulled?: unknown;
}

/**
 * ANA-165: one metric of the marketing weekly grid totalled over the report period.
 * `total` sums only real (non-demo) cells; `weeks` counts the distinct campaign weeks
 * that contributed at least one cell.
 */
export interface MarketingMetricTotal {
  metricKey: string;
  labelRu: string;
  labelEn: string;
  /** Catalog section; 'other' only for keys outside the metric catalog (defensive). */
  section: 'content' | 'influence' | 'other';
  total: number;
  weeks: number;
}

/**
 * ANA-165: the Marketing page's weekly grid (sheet «стата») aggregated for the report
 * snapshot — per-metric totals over the campaign weeks intersecting the report period.
 * Lets DOCX/PDF and the AI analysis reason about marketing activities without a live API.
 */
export interface MarketingSummary {
  /** Contributing weeks (grid order; unknown weekStarts last, sorted, as single days). */
  weeks: Array<{ key: string; start: string; end: string }>;
  /** Catalog-order metrics with at least one contributing cell (unknown keys last, sorted). */
  byMetric: MarketingMetricTotal[];
}
