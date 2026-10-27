import type { ReportSnapshot } from './types/report';
import type { ReportLocale } from './report-locale';

/** Conversion-rate / bounce benchmarks used for the report's 🟢/🔴 recommendations. */
export const REPORT_BENCHMARKS = {
  /** CR at/above this is healthy. */
  crGood: 0.05,
  /** CR below this is a problem. */
  crBad: 0.02,
  /** Bounce at/above this on an entry page is a problem. */
  bounceBad: 0.7,
  /** Minimum visits for a channel/page signal to be trustworthy. */
  minVisits: 50,
} as const;

export interface ReportRecommendations {
  readonly good: readonly string[];
  readonly bad: readonly string[];
}

const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;

/** Recommendation sentences per report locale (ANA-42); RU text is the historical wording. */
export const RECOMMENDATION_TEXT = {
  ru: {
    noData: 'Нет данных по каналам за период — синхронизируйте данные из Метрики.',
    crGood: (cr: number) => `Общий CR ${pct(cr)} — на уровне или выше ориентира 5%.`,
    crBad: (cr: number) =>
      `Общий CR ${pct(cr)} — ниже 2%, проверьте качество трафика и посадочные.`,
    bestChannel: (ch: string, cr: number) =>
      `Лучший канал «${ch}»: CR ${pct(cr)} — масштабировать.`,
    worstChannel: (ch: string, cr: number, visits: number) =>
      `Канал «${ch}»: CR ${pct(cr)} при ${visits} визитах — проверить качество.`,
    highBounce: (page: string, b: number) =>
      `Страница входа ${page}: отказы ${pct(b)} — упростить первый экран.`,
    targetMet: (target: number) => `Цель ${target} оплаченных билетов достигнута.`,
    gap: (target: number, gap: number, paid: number) =>
      `До цели ${target} не хватает ${gap} оплаченных билетов (оплачено ${paid}).`,
    noGood: 'Явных сильных сторон по порогам не выявлено.',
    noBad: 'Явных проблем по порогам не выявлено.',
  },
  en: {
    noData: 'No channel data for the period — sync data from Metrika.',
    crGood: (cr: number) => `Overall CR ${pct(cr)} — at or above the 5% benchmark.`,
    crBad: (cr: number) =>
      `Overall CR ${pct(cr)} — below 2%, check traffic quality and landing pages.`,
    bestChannel: (ch: string, cr: number) => `Best channel “${ch}”: CR ${pct(cr)} — scale it.`,
    worstChannel: (ch: string, cr: number, visits: number) =>
      `Channel “${ch}”: CR ${pct(cr)} with ${visits} visits — check its quality.`,
    highBounce: (page: string, b: number) =>
      `Entry page ${page}: bounce ${pct(b)} — simplify the first screen.`,
    targetMet: (target: number) => `Target of ${target} paid tickets reached.`,
    gap: (target: number, gap: number, paid: number) =>
      `${gap} paid tickets short of the ${target} target (paid ${paid}).`,
    noGood: 'No clear strengths by the thresholds.',
    noBad: 'No clear problems by the thresholds.',
  },
} as const satisfies Record<ReportLocale, unknown>;

/**
 * Deterministic «🟢 что хорошо / 🔴 что плохо» recommendations for the report, derived purely from
 * snapshot numbers against {@link REPORT_BENCHMARKS}. No AI, no clock — fully reproducible and
 * traceable. Used by reportSections so DOCX/PDF/screen all carry the same block.
 */
export function buildReportRecommendations(
  s: ReportSnapshot,
  locale: ReportLocale = 'ru',
): ReportRecommendations {
  const T = RECOMMENDATION_TEXT[locale];
  const good: string[] = [];
  const bad: string[] = [];

  const totalVisits = s.channels.reduce((a, c) => a + c.visits, 0);
  const totalReaches = s.channels.reduce((a, c) => a + c.goalReaches, 0);
  const overallCr = totalVisits > 0 ? totalReaches / totalVisits : 0;

  if (totalVisits === 0) {
    bad.push(T.noData);
    return { good, bad };
  }

  if (overallCr >= REPORT_BENCHMARKS.crGood) {
    good.push(T.crGood(overallCr));
  } else if (overallCr < REPORT_BENCHMARKS.crBad) {
    bad.push(T.crBad(overallCr));
  }

  // Best / worst channel by CR among those with enough traffic.
  const sized = s.channels
    .filter((c) => c.visits >= REPORT_BENCHMARKS.minVisits)
    .map((c) => ({ channel: c.channel, visits: c.visits, cr: c.goalReaches / c.visits }));
  if (sized.length > 0) {
    const best = [...sized].sort((a, b) => b.cr - a.cr)[0]!;
    const worst = [...sized].sort((a, b) => a.cr - b.cr)[0]!;
    if (best.cr >= REPORT_BENCHMARKS.crGood) {
      good.push(T.bestChannel(best.channel, best.cr));
    }
    if (worst.channel !== best.channel && worst.cr < REPORT_BENCHMARKS.crBad) {
      bad.push(T.worstChannel(worst.channel, worst.cr, worst.visits));
    }
  }

  // Entry pages with high bounce.
  const highBounce = s.breakdowns.entryPages.filter(
    (p) => p.visits >= REPORT_BENCHMARKS.minVisits && p.bounceRate >= REPORT_BENCHMARKS.bounceBad,
  );
  for (const p of highBounce.slice(0, 2)) {
    bad.push(T.highBounce(p.page, p.bounceRate));
  }

  // KPI gap (paid tickets).
  if (s.kpi.gap <= 0) {
    good.push(T.targetMet(s.kpi.target));
  } else {
    bad.push(T.gap(s.kpi.target, s.kpi.gap, s.kpi.b2bPaidTickets));
  }

  if (good.length === 0) good.push(T.noGood);
  if (bad.length === 0) bad.push(T.noBad);
  return { good, bad };
}
