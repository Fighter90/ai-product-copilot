/**
 * Deterministic ECharts option builders + per-chart 🟢/🔴 interpretation for the report (FINAL §6.3/§6.4).
 *
 * These are pure functions of a {@link ReportSnapshot}: same data → same option object and the same
 * recommendation text. The headless chart renderer (backend, coverage-excluded) turns the option
 * into a PNG; this module — and the per-chart traffic-light block — are fully unit-tested so the
 * report's chart content stays traceable. Animations are disabled for byte-stable rendering.
 */
import type { ReportSnapshot, ReportChartId } from './types/report';
import { REPORT_BENCHMARKS, RECOMMENDATION_TEXT } from './report-recommendations';
import type { ReportLocale } from './report-locale';

export const REPORT_CHART_IDS = ['channelBar', 'funnel', 'channelMix'] as const;

export const REPORT_CHART_TITLES: Record<ReportChartId, string> = {
  channelBar: 'Визиты и заявки по каналам',
  funnel: 'Воронка: визит → заявка → оплата',
  channelMix: 'Доля каналов по визитам',
};

/** English chart titles (ANA-42). */
export const REPORT_CHART_TITLES_EN: Record<ReportChartId, string> = {
  channelBar: 'Visits and applications by channel',
  funnel: 'Funnel: visit → application → payment',
  channelMix: 'Channel share of visits',
};

/** Chart titles for the requested report locale. */
export function reportChartTitles(locale: ReportLocale = 'ru'): Record<ReportChartId, string> {
  return locale === 'en' ? REPORT_CHART_TITLES_EN : REPORT_CHART_TITLES;
}

/** Series / stage names drawn inside the chart PNGs, per locale. */
const CHART_LABELS = {
  ru: {
    visits: 'Визиты',
    applications: 'Заявки',
    b2c: 'Заявки B2C',
    b2bPipeline: 'B2B в работе',
    b2bPaid: 'Оплачено B2B',
  },
  en: {
    visits: 'Visits',
    applications: 'Applications',
    b2c: 'B2C applications',
    b2bPipeline: 'B2B in progress',
    b2bPaid: 'B2B paid',
  },
} as const satisfies Record<ReportLocale, unknown>;

/** Fixed GOST-friendly palette (deterministic order). */
const PALETTE = ['#1d4ed8', '#0891b2', '#16a34a', '#ca8a04', '#dc2626', '#7c3aed', '#475569'];
const BASE_TEXT = { fontFamily: 'Times New Roman, serif', color: '#000' } as const;

type ChartOption = Record<string, unknown>;

/** Aggregate channels by name (sum visits + reaches), sorted by visits desc. */
function channelTotals(
  s: ReportSnapshot,
): Array<{ channel: string; visits: number; goalReaches: number }> {
  const map = new Map<string, { visits: number; goalReaches: number }>();
  for (const c of s.channels) {
    const cur = map.get(c.channel) ?? { visits: 0, goalReaches: 0 };
    map.set(c.channel, {
      visits: cur.visits + c.visits,
      goalReaches: cur.goalReaches + c.goalReaches,
    });
  }
  return [...map.entries()]
    .map(([channel, v]) => ({ channel, ...v }))
    .sort((a, b) => b.visits - a.visits);
}

function channelBarOption(s: ReportSnapshot, locale: ReportLocale): ChartOption {
  const L = CHART_LABELS[locale];
  const totals = channelTotals(s);
  return {
    animation: false,
    textStyle: BASE_TEXT,
    color: PALETTE,
    grid: { left: 48, right: 16, top: 40, bottom: 64, containLabel: true },
    legend: { data: [L.visits, L.applications], top: 8, textStyle: BASE_TEXT },
    xAxis: {
      type: 'category',
      data: totals.map((t) => t.channel),
      axisLabel: { interval: 0, rotate: 30, color: '#000' },
    },
    yAxis: { type: 'value', scale: true },
    series: [
      { name: L.visits, type: 'bar', data: totals.map((t) => t.visits), barMaxWidth: 48 },
      {
        name: L.applications,
        type: 'bar',
        data: totals.map((t) => t.goalReaches),
        barMaxWidth: 48,
      },
    ],
  };
}

function funnelOption(s: ReportSnapshot, locale: ReportLocale): ChartOption {
  const L = CHART_LABELS[locale];
  const f = s.funnel;
  return {
    animation: false,
    textStyle: BASE_TEXT,
    color: PALETTE,
    series: [
      {
        type: 'funnel',
        sort: 'descending',
        gap: 2,
        label: { show: true, position: 'inside', color: '#fff' },
        data: [
          { value: f.visits, name: L.visits },
          { value: f.b2cApplications, name: L.b2c },
          { value: f.b2bPipelineTickets, name: L.b2bPipeline },
          { value: f.b2bPaidTickets, name: L.b2bPaid },
        ],
      },
    ],
  };
}

function channelMixOption(s: ReportSnapshot): ChartOption {
  const totals = channelTotals(s);
  return {
    animation: false,
    textStyle: BASE_TEXT,
    color: PALETTE,
    legend: { bottom: 0, textStyle: BASE_TEXT },
    series: [
      {
        type: 'pie',
        radius: ['35%', '65%'],
        label: { formatter: '{b}: {d}%', color: '#000' },
        data: totals.map((t) => ({ value: t.visits, name: t.channel })),
      },
    ],
  };
}

/** ECharts option for a report chart (deterministic, animations off). */
export function reportChartOption(
  s: ReportSnapshot,
  id: ReportChartId,
  locale: ReportLocale = 'ru',
): ChartOption {
  switch (id) {
    case 'channelBar':
      return channelBarOption(s, locale);
    case 'funnel':
      return funnelOption(s, locale);
    case 'channelMix':
      return channelMixOption(s);
  }
}

export interface ChartRecommendation {
  readonly good: readonly string[];
  readonly bad: readonly string[];
}

const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;

/** Per-chart interpretation sentences per locale (best-channel / no-data reuse the report text). */
const CHART_REC_TEXT = {
  ru: {
    noData: 'Нет данных по каналам за период.',
    worstChannel: (ch: string, cr: number) =>
      `Канал «${ch}»: CR ${pct(cr)} — проверить качество трафика.`,
    concentrated: (ch: string, share: number) =>
      `Канал «${ch}» даёт ${pct(share)} визитов — высокая зависимость от одного источника.`,
    diversified: (ch: string, share: number) =>
      `Трафик диверсифицирован: топ-канал «${ch}» — ${pct(share)} визитов.`,
    crGood: (cr: number) => `Конверсия визит → заявка ${pct(cr)} — на уровне/выше ориентира 5%.`,
    crBad: (cr: number) => `Конверсия визит → заявка ${pct(cr)} — ниже 2%.`,
    gap: (gap: number) => `До цели не хватает ${gap} оплаченных билетов.`,
  },
  en: {
    noData: 'No channel data for the period.',
    worstChannel: (ch: string, cr: number) =>
      `Channel “${ch}”: CR ${pct(cr)} — check traffic quality.`,
    concentrated: (ch: string, share: number) =>
      `Channel “${ch}” brings ${pct(share)} of visits — heavy dependence on a single source.`,
    diversified: (ch: string, share: number) =>
      `Traffic is diversified: top channel “${ch}” — ${pct(share)} of visits.`,
    crGood: (cr: number) =>
      `Visit → application conversion ${pct(cr)} — at/above the 5% benchmark.`,
    crBad: (cr: number) => `Visit → application conversion ${pct(cr)} — below 2%.`,
    gap: (gap: number) => `${gap} paid tickets short of the target.`,
  },
} as const satisfies Record<ReportLocale, unknown>;

/**
 * Per-chart 🟢/🔴 interpretation (FINAL §6.3) — a small traffic-light block tied to one diagram,
 * derived purely from snapshot numbers against {@link REPORT_BENCHMARKS}. Deterministic.
 */
export function chartRecommendation(
  s: ReportSnapshot,
  id: ReportChartId,
  locale: ReportLocale = 'ru',
): ChartRecommendation {
  const T = CHART_REC_TEXT[locale];
  const R = RECOMMENDATION_TEXT[locale];
  const good: string[] = [];
  const bad: string[] = [];
  const totals = channelTotals(s);
  const totalVisits = totals.reduce((a, t) => a + t.visits, 0);

  if (id === 'channelBar' || id === 'channelMix') {
    if (totalVisits === 0) {
      bad.push(T.noData);
      return { good, bad };
    }
  }

  if (id === 'channelBar') {
    const sized = totals
      .filter((t) => t.visits >= REPORT_BENCHMARKS.minVisits)
      .map((t) => ({ ...t, cr: t.goalReaches / t.visits }));
    if (sized.length > 0) {
      const best = [...sized].sort((a, b) => b.cr - a.cr)[0]!;
      const worst = [...sized].sort((a, b) => a.cr - b.cr)[0]!;
      if (best.cr >= REPORT_BENCHMARKS.crGood) {
        good.push(R.bestChannel(best.channel, best.cr));
      }
      if (worst.channel !== best.channel && worst.cr < REPORT_BENCHMARKS.crBad) {
        bad.push(T.worstChannel(worst.channel, worst.cr));
      }
    }
  }

  if (id === 'channelMix') {
    // totalVisits > 0 here (early return above), so there is at least one channel.
    const top = totals[0]!;
    const share = top.visits / totalVisits;
    if (share >= 0.7) {
      bad.push(T.concentrated(top.channel, share));
    } else {
      good.push(T.diversified(top.channel, share));
    }
  }

  if (id === 'funnel') {
    const f = s.funnel;
    const cr = f.visits > 0 ? f.b2cApplications / f.visits : 0;
    if (cr >= REPORT_BENCHMARKS.crGood) {
      good.push(T.crGood(cr));
    } else if (cr < REPORT_BENCHMARKS.crBad) {
      bad.push(T.crBad(cr));
    }
    if (s.kpi.gap <= 0) {
      good.push(R.targetMet(s.kpi.target));
    } else {
      bad.push(T.gap(s.kpi.gap));
    }
  }

  if (good.length === 0) good.push(R.noGood);
  if (bad.length === 0) bad.push(R.noBad);
  return { good, bad };
}
