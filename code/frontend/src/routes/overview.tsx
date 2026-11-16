import { useState, type ReactNode } from 'react';
import { channelName, fmtDate, translate, useT, type DictKey } from '../i18n';
import type { Locale } from '../store/prefs';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  ChannelStat,
  GeoDeviceStat,
  UtmStat,
  PageStat,
  B2bDeal,
  B2cPayment,
} from '@pca/shared';
import { paidAndGap, readEventDate, isGoalExpired, smartGoal } from '@pca/shared';
import { api } from '../lib/api';
import { v3 } from '../lib/api-v3';
import { useFilters } from '../store/filters';
import { useAuth } from '../auth/AuthContext';
import { formatInt, formatPercent } from '../lib/format';
import { displayPath } from '../lib/url-path';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/ui';
import {
  channelMixOption,
  summarizeChannels,
  topPages,
  topUtmRows,
  weakSpots,
  paidDailyPoints,
} from '../lib/overview';
import {
  BOUNCE_HIGH,
  BOUNCE_LOW,
  CR_EXCELLENT_TARGET,
  CR_GOOD_TARGET,
  CR_HIGH_VS_AVG,
  CR_LOW_VS_AVG,
  MIN_CHANNEL_VISITS,
  MIN_PAGE_VISITS,
} from '../lib/insight-thresholds';
import type { PageRow } from '../lib/behavior';
import { applyTestTrafficFilter, isTestChannelRow, isTestPage } from '../lib/test-traffic';
import { useKpiTarget } from '../lib/kpi-target';
import { utmCoverage } from '../lib/traffic';
import { dailySeries, trendsOption } from '../lib/trends';
import { diffDaysIso } from '../lib/forecast';
import { byCountry, byDevice, audienceBarOption, deviceShareOption } from '../lib/audience';
import { EChart } from '../components/charts/EChart';
import { ChartCaption } from '../components/charts/ChartCaption';
import { filterBySegment, filterUtmBySegment } from '../lib/segment-filter';
import { buildHypothesisUrl } from '../lib/hypothesis-prefill';
import { shouldShowOnboarding, markOnboarded } from '../lib/onboarding';
import { weeklyDigest } from '../lib/weekly-digest';
import { KpiStrip } from '../components/overview/KpiStrip';
import { DataQualityBlock } from '../components/overview/DataQualityBlock';
import { goalPace, type GoalPace, type PaceStatus } from '../components/overview/goal-pace';
import { formatGoalLabel, type GoalLabel } from '@pca/shared';

export type QueryStatus = 'pending' | 'error' | 'success';

/**
 * ANA-75 (БАГ-01): админская «Дата события» (EVENT_DATE) перекрывает эвристический дедлайн героя
 * («конец периода + 2 длины периода»): дедлайн = дата события, статус пересчитан от неё.
 *
 * ANA-170: отклонение — в конвенции goal-pace «forecast − deadline» (отрицательное = запас,
 * положительное = отставание). diffDaysIso(from, to) = to − from, поэтому аргументы —
 * (eventDate, forecastDate); прежний порядок (forecastDate, eventDate) переворачивал знак, и
 * прогноз ПОЗЖЕ дедлайна показывался как «Успеваем: запас N дн.» (регресс прода 15.11.2026).
 */
function applyDeadline(pace: GoalPace, eventDate?: string): GoalPace {
  if (!eventDate || pace.status === 'reached') return pace;
  const deviationDays =
    pace.forecastDate === null ? null : diffDaysIso(eventDate, pace.forecastDate);
  const status: PaceStatus =
    deviationDays === null
      ? 'unreachable'
      : deviationDays < 0
        ? 'onTrack'
        : deviationDays === 0
          ? 'onTime'
          : 'behind';
  return { ...pace, deadline: eventDate, deviationDays, status };
}

/** Insight badge with green/red indicator */
function InsightBadge({
  type,
  text,
}: {
  type: 'good' | 'warning' | 'info';
  text: string;
}): JSX.Element {
  const colors =
    type === 'good'
      ? 'bg-green-100 text-green-800'
      : type === 'warning'
        ? 'bg-red-100 text-red-800'
        : 'bg-blue-100 text-blue-800';
  const icon = type === 'good' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${colors}`}>
      {icon} {text}
    </span>
  );
}

/** Compute insights from channel data */
function computeChannelInsights(stats: ChannelStat[], locale: Locale): JSX.Element[] {
  const insights: JSX.Element[] = [];
  const totalVisits = stats.reduce((a, c) => a + c.visits, 0);
  const totalApplications = stats.reduce((a, c) => a + c.goalReaches, 0);
  const overallCR = totalVisits > 0 ? totalApplications / totalVisits : 0;

  // Overall conversion assessment
  if (overallCR > CR_EXCELLENT_TARGET) {
    insights.push(
      <InsightBadge
        key="cr-good"
        type="good"
        text={translate(locale, 'i18n.ov.ins.crGood', { cr: formatPercent(overallCR) })}
      />,
    );
  } else if (overallCR < CR_GOOD_TARGET) {
    insights.push(
      <InsightBadge
        key="cr-bad"
        type="warning"
        text={translate(locale, 'i18n.ov.ins.crBad', { cr: formatPercent(overallCR) })}
      />,
    );
  }

  // Find best and worst channels
  const channelCRs = stats.reduce<Map<string, { visits: number; reaches: number }>>((acc, c) => {
    const cur = acc.get(c.channel) ?? { visits: 0, reaches: 0 };
    acc.set(c.channel, { visits: cur.visits + c.visits, reaches: cur.reaches + c.goalReaches });
    return acc;
  }, new Map());

  for (const [raw, data] of channelCRs) {
    const channel = channelName(raw, locale);
    const cr = data.visits > 0 ? data.reaches / data.visits : 0;
    // ANA-75 (БАГ-09): «высокий CR» у канала — только если CR дотягивает до общей цели,
    // иначе похвала каналу противоречит вердикту «общий CR низкий» рядом с ней.
    if (
      cr >= CR_GOOD_TARGET &&
      cr > overallCR * CR_HIGH_VS_AVG &&
      data.visits > MIN_CHANNEL_VISITS
    ) {
      insights.push(
        <InsightBadge
          key={`good-${channel}`}
          type="good"
          text={translate(locale, 'i18n.ov.ins.chGood', {
            channel,
            cr: formatPercent(cr),
          })}
        />,
      );
    } else if (cr < overallCR * CR_LOW_VS_AVG && data.visits > MIN_CHANNEL_VISITS) {
      insights.push(
        <InsightBadge
          key={`bad-${channel}`}
          type="warning"
          text={translate(locale, 'i18n.ov.ins.chBad', {
            channel,
            cr: formatPercent(cr),
          })}
        />,
      );
    }
  }

  return insights;
}

/** Compute UTM insights from the single coverage factsource (visit-weighted utmCoverage). */
function computeUtmInsights(stats: ChannelStat[], utm: UtmStat[], locale: Locale): JSX.Element[] {
  const insights: JSX.Element[] = [];
  if (stats.length === 0) return insights;

  const coverage = utmCoverage(stats, utm).ratio * 100;

  if (coverage >= 70) {
    insights.push(
      <InsightBadge
        key="utm-good"
        type="good"
        text={translate(locale, 'i18n.ov.ins.utmGood', { pct: coverage.toFixed(0) })}
      />,
    );
  } else {
    insights.push(
      <InsightBadge
        key="utm-bad"
        type="warning"
        text={translate(locale, 'i18n.ov.ins.utmBad', { pct: coverage.toFixed(0) })}
      />,
    );
  }

  return insights;
}

/**
 * Compute page insights. ANA-75 (БАГ-09): the rows here are exactly the aggregated top rows the
 * adjacent table renders (`pageRows` + visits sort + slice), so every number quoted in a badge is
 * visible in the table — no insight can reference a hidden row.
 */
function computePageInsights(
  rows: PageRow[],
  type: 'entry' | 'exit',
  locale: Locale,
): JSX.Element[] {
  const insights: JSX.Element[] = [];
  if (rows.length === 0) return insights;

  rows.forEach((p) => {
    const path = displayPath(p.page);
    if (p.bounceRate > BOUNCE_HIGH && p.visits > MIN_PAGE_VISITS) {
      insights.push(
        <InsightBadge
          key={`bounce-${type}-${p.page}`}
          type="warning"
          text={translate(locale, 'i18n.ov.ins.bounceHigh', {
            cr: formatPercent(p.bounceRate),
            path,
            n: p.visits,
          })}
        />,
      );
    } else if (p.bounceRate < BOUNCE_LOW && p.visits > MIN_PAGE_VISITS) {
      insights.push(
        <InsightBadge
          key={`good-${type}-${p.page}`}
          type="good"
          text={translate(locale, 'i18n.ov.ins.bounceLow', {
            cr: formatPercent(p.bounceRate),
            path,
          })}
        />,
      );
    }
  });

  return insights;
}

/** Compute geo insights */
function computeGeoInsights(geoDevice: GeoDeviceStat[] | undefined, locale: Locale): JSX.Element[] {
  const insights: JSX.Element[] = [];
  if (!geoDevice || geoDevice.length === 0) return insights;

  const byCountry = geoDevice.reduce<Map<string, { visits: number; reaches: number }>>((acc, g) => {
    const cur = acc.get(g.country) ?? { visits: 0, reaches: 0 };
    acc.set(g.country, { visits: cur.visits + g.visits, reaches: cur.reaches + g.goalReaches });
    return acc;
  }, new Map());

  for (const [country, data] of byCountry) {
    const cr = data.visits > 0 ? data.reaches / data.visits : 0;
    if (cr > 0.1 && data.visits > 50) {
      insights.push(
        <InsightBadge
          key={`geo-good-${country}`}
          type="good"
          text={translate(locale, 'i18n.ov.ins.geoGood', {
            country,
            cr: formatPercent(cr),
          })}
        />,
      );
    } else if (cr < 0.02 && data.visits > 100) {
      insights.push(
        <InsightBadge
          key={`geo-bad-${country}`}
          type="warning"
          text={translate(locale, 'i18n.ov.ins.geoBad', {
            country,
            cr: formatPercent(cr),
          })}
        />,
      );
    }
  }

  return insights;
}

type ChannelMixOption = {
  legend: { data: string[] } & Record<string, unknown>;
  series: Array<
    { data: Array<{ name: string } & Record<string, unknown>> } & Record<string, unknown>
  >;
} & Record<string, unknown>;

/**
 * Channel-mix pie with localised channel names. Colours are resolved from the raw Metrika names
 * inside channelMixOption, so names are translated afterwards to keep colours stable.
 */
function localizedChannelMixOption(stats: ChannelStat[], locale: Locale): object {
  const opt = channelMixOption(stats) as ChannelMixOption;
  const tr = (n: string): string => channelName(n, locale);
  return {
    ...opt,
    legend: { ...opt.legend, data: opt.legend.data.map(tr) },
    series: opt.series.map((s) => ({
      ...s,
      data: s.data.map((d) => ({ ...d, name: tr(d.name) })),
    })),
  };
}

/** Caption under a chart, all three lines from the dictionary (`ov.cap.<id>.*`). */
function Caption({ id }: { id: 'trends' | 'mix' | 'geo' | 'device' }): JSX.Element {
  const { t } = useT();
  return (
    <ChartCaption
      correct={t(`ov.cap.${id}.correct` as DictKey)}
      caveat={t(`ov.cap.${id}.caveat` as DictKey)}
      advice={t(`ov.cap.${id}.advice` as DictKey)}
    />
  );
}

/** Entry/exit pages table: rows are normalized path keys (ANA-178) — the label and the title carry the path. */
function PagesTable({ title, rows }: { title: string; rows: PageRow[] }): JSX.Element {
  const { t } = useT();
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={title}>
      <table className="w-full min-w-[28rem] text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1">{t('ov.col.page')}</th>
            <th>{t('ov.col.visits')}</th>
            <th>{t('ov.col.bounce')}</th>
            <th>{t('ov.col.applications')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.page} className="border-t border-slate-100">
              <td className="max-w-[20rem] truncate py-1" title={p.page}>
                {displayPath(p.page)}
              </td>
              <td>{formatInt(p.visits)}</td>
              <td>{formatPercent(p.bounceRate)}</td>
              <td>{formatInt(p.goalReaches)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Admin flag without requiring an <AuthProvider> (same fallback as EmptyState). */
function useIsAdmin(): boolean {
  try {
    return useAuth().isAdmin;
  } catch {
    return false;
  }
}

/** ANA-131: chart-card placeholder — real card = border + title + EChart (default height 300px). */
function ChartCardSkeleton(): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <Skeleton className="mb-2 h-6 w-1/3" />
      <Skeleton className="h-[300px]" />
    </div>
  );
}

/** ANA-131: table-card placeholder (UTM / entry / exit / weak spots): title + fixed-height rows. */
function TableCardSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <Skeleton className="mb-2 h-6 w-1/3" />
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    </div>
  );
}

/**
 * ANA-131: structure skeletons for the whole Overview load instead of a lone «Загрузка…» line —
 * fullPage screenshots taken seconds after navigation used to catch an empty screen with a
 * spinner. The placeholder mirrors the real page geometry: KPI hero + 2×2 tiles (same grid as
 * KpiStrip), weekly digest, charts at the EChart default height (300px) and table cards.
 * Every block has a fixed height, so the swap to real content does not jump the layout.
 * role="status" + the localized label keep it screen-reader friendly (placeholders carry no text).
 */
function OverviewSkeleton(): JSX.Element {
  const { t } = useT();
  return (
    <section
      data-testid="overview-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('ov.loading')}
      className="space-y-6"
    >
      {/* KPI strip: hero card + 2×2 tiles — the same grid as KpiStrip. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:p-4">
          <Skeleton className="h-20 w-20 shrink-0 rounded-full lg:h-24 lg:w-24" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
      {/* Weekly digest: title + three columns. */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <Skeleton className="mb-3 h-6 w-1/4" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
      {/* Charts: exact EChart default height (300px) — no layout shift when content arrives. */}
      <ChartCardSkeleton />
      <ChartCardSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
      {/* UTM / entry pages / exit pages / weak spots. */}
      <TableCardSkeleton />
      <TableCardSkeleton rows={3} />
      <TableCardSkeleton rows={3} />
      <TableCardSkeleton rows={2} />
    </section>
  );
}

/** Pure presentational Overview — testable across all states without the data layer. */
export function OverviewView({
  status,
  stats,
  b2bDeals,
  primaryGoalName,
  goalLabel,
  geoDevice,
  utm,
  entryPages,
  exitPages,
  to,
  afterKpi,
  kpiTarget,
  b2cPaid = 0,
  b2cDays,
  eventDate,
  showDeadlineCaveat,
  today,
}: {
  status: QueryStatus;
  stats: ChannelStat[];
  b2bDeals?: B2bDeal[];
  primaryGoalName?: string;
  goalLabel?: GoalLabel;
  geoDevice?: GeoDeviceStat[];
  utm?: UtmStat[];
  entryPages?: PageStat[];
  exitPages?: PageStat[];
  /** Period end (ISO date) — anchor for the «успеваем?» forecast; defaults to the last fact date. */
  to?: string;
  /** Secondary content (e.g. the onboarding card) rendered below the KPI strip, never above it. */
  afterKpi?: ReactNode;
  /** Admin «Цель по оплатам» (paid tickets); defaults to 300. */
  kpiTarget?: number;
  /** ANA-19: manually entered / CSV-imported paid B2C tickets for the period (payments summary). */
  b2cPaid?: number;
  /**
   * ANA-171: per-day B2C payments (`GET /payments/b2c`, same range) — together with paid B2B
   * deals they build the hero's PAID daily series, so the forecast counts the same money as
   * the ring. Absent (loading/failed) → [] → zero paid pace → honest «Прогноз: —».
   */
  b2cDays?: B2cPayment[];
  /** ANA-75 (БАГ-01): admin EVENT_DATE — the KPI deadline; empty → the heuristic + caveat. */
  eventDate?: string;
  /** ANA-75 (БАГ-01): show the deadline heuristic caveat (same text as the KPI page). */
  showDeadlineCaveat?: boolean;
  /**
   * ANA-166: «сегодня» для SMART-формулировки и авто-состояния «дедлайн прошёл». Живой
   * дашборд использует настоящую дату; тесты передают явную (в render-пути отчёта Date.now() нет).
   */
  today?: string;
}): JSX.Element {
  const { t, locale } = useT();
  const { segment } = useFilters();
  const isAdmin = useIsAdmin();
  // ANA-131: structure skeletons instead of a lone spinner — fullPage screenshots catch the
  // loading state, so the real page geometry is visible immediately (see OverviewSkeleton).
  if (status === 'pending') return <OverviewSkeleton />;
  if (status === 'error')
    return (
      <p role="alert" className="text-red-700">
        {t('ov.error')}
      </p>
    );

  if (stats.length === 0) {
    // БАГ-11 → ANA-176: в сегменте B2B визитов Метрики нет by construction (segment-filter),
    // а KPI-цель относится к общему потоку — стрип с нулями («Заявок 0 / Осталось 300»)
    // вводил в заблуждение. KPI-блок цели скрыт, вместо него пояснение; оплаченные B2B-сделки
    // остаются на /app/kpi (вкладка B2B) и странице B2B-сделок.
    if (segment === 'b2b') {
      return (
        <section className="space-y-6">
          <p
            data-testid="b2b-goal-hidden"
            className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600"
          >
            {t('ov.b2bGoalHidden', { target: formatInt(kpiTarget ?? 300) })}
          </p>
          {afterKpi}
          <EmptyState
            message={t('ov.b2bEmpty')}
            action={isAdmin ? { label: t('ov.b2bEmptyAction'), to: '/app/b2b' } : null}
          />
        </section>
      );
    }
    return (
      <div className="space-y-6">
        <EmptyState />
        {afterKpi}
      </div>
    );
  }

  const goalIsPaid = goalLabel?.isPaid ?? false;
  const base = summarizeChannels(stats, b2bDeals ?? [], goalIsPaid, kpiTarget, b2cPaid);
  // REG-03 (ANA-92), инвариант «заявка ≠ оплата»: единая семантика «Оплачено/Осталось» — тот же
  // helper paidAndGap, что на /app/kpi и в снапшоте: ТОЛЬКО подтверждённые деньги (B2C-платежи +
  // B2B-paid). Заказы Метрики (applications) — отдельная метрика и в оплату не входят.
  const { paid, gap } = paidAndGap({
    target: base.target,
    b2cPaidTickets: b2cPaid,
    b2bPaidTickets: base.b2bPaid,
  });
  const kpi = { ...base, paid, gap };
  const weak = weakSpots(stats);
  const daily = dailySeries(stats);
  // ANA-171 (заявка ≠ оплата): hero pace counts the same money as the ring — B2C payments
  // (manual/CSV, per day) + paid B2B deals, dense over the Metrika fact window. Zero paid
  // pace → honest «Прогноз: —», no applications-fiction date (регресс прода 15.11.2026).
  const paidSeries = paidDailyPoints(b2cDays ?? [], b2bDeals ?? [], daily);
  const pace = applyDeadline(
    goalPace({ points: paidSeries, to, target: kpi.target, current: kpi.paid, goalIsPaid: true }),
    eventDate,
  );
  // ANA-166: SMART-формулировка цели + авто-состояние «дедлайн прошёл». Истекает только
  // настроенный EVENT_DATE (эвристический дедлайн — не обязательство); в SMART идёт тот
  // дедлайн, который показывает герой (EVENT_DATE, иначе расчёт темпа). Правка ревью:
  // расчётный дедлайн, оказавшийся в прошлом (старый период), не превращает SMART в «прошёл» —
  // срок опускается, пилюля темпа остаётся честной «успеваем/не успеваем».
  const todayIso = today ?? new Date().toISOString().slice(0, 10);
  const goalExpired = isGoalExpired(eventDate ?? '', todayIso);
  const goalSmart = smartGoal({
    target: kpi.target,
    paid: kpi.paid,
    deadline: eventDate || (isGoalExpired(pace.deadline, todayIso) ? '' : pace.deadline),
    today: todayIso,
    locale,
  });
  const geoRows = geoDevice ? byCountry(geoDevice) : [];
  const devRows = geoDevice ? byDevice(geoDevice) : [];
  const hasGeo = geoRows.length > 0 && devRows.length > 0;

  // UTM coverage — single source: visit-weighted utmCoverage(channels, utm) from lib/traffic
  // (UTM-tagged visits / total visits). Overview and Traffic report the same number.
  const utmCov = utmCoverage(stats, utm ?? []);
  const utmCoveragePct = (utmCov.ratio * 100).toFixed(0);
  const lowUtm = utmCov.low;

  // Top entry/exit pages — ANA-75 (БАГ-07/09): per-day API rows are aggregated per page (topPages,
  // sorted by visits) and BOTH the table and the page insights read this same top-5 list.
  const topEntry = topPages(entryPages ?? []).slice(0, 5);
  const topExit = topPages(exitPages ?? []).slice(0, 5);

  // Compute insights
  const channelInsights = computeChannelInsights(stats, locale);
  const utmInsights = computeUtmInsights(stats, utm ?? [], locale);
  const entryInsights = computePageInsights(topEntry, 'entry', locale);
  const exitInsights = computePageInsights(topExit, 'exit', locale);
  const geoInsights = computeGeoInsights(geoDevice, locale);

  // Data-quality notices live in one collapsed block below the KPI strip (ANA-48).
  const qualityItems: Array<{ key: string; node: ReactNode }> = [];
  if (primaryGoalName) {
    qualityItems.push({
      key: 'goal',
      node: (
        <>
          {t('ov.quality.goalAutoPrefix')} <b>{primaryGoalName}</b> {t('ov.quality.goalAutoSuffix')}
        </>
      ),
    });
  }
  if (lowUtm && (utm?.length ?? 0) > 0) {
    qualityItems.push({ key: 'utm', node: t('kpi.lowUtm', { pct: utmCoveragePct }) });
  }

  return (
    <section className="space-y-6">
      <KpiStrip
        kpi={kpi}
        pace={pace}
        goalIsPaid={goalIsPaid}
        showApplicationsCaveat={goalLabel?.showApplicationsCaveat !== false}
        weakSpot={weak[0]}
        expired={goalExpired}
        smart={goalSmart}
      />

      {/* ANA-75 (BUG-01): the heuristic deadline gets the same caveat on Overview and /app/kpi.
          REG-17 (ANA-105): the caveat equals the calculation — the real coverage days and the
          computed deadline (pace.deadline after applyDeadline), not a static «+ 2× period» text. */}
      {showDeadlineCaveat ? (
        <p data-testid="deadline-caveat" className="text-xs text-slate-600">
          {t('ov.deadlineCaveatComputed', {
            days: pace.windowDays,
            date: fmtDate(pace.deadline, locale),
          })}
        </p>
      ) : null}

      <DataQualityBlock items={qualityItems} />

      {afterKpi}

      <WeeklyDigest stats={stats} />

      <Card title={t('ov.card.trends')}>
        <EChart
          option={trendsOption(daily, {
            visits: t('an.col.visits'),
            reaches: t('an.col.applications'),
          })}
        />
        {channelInsights.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">{channelInsights}</div>
        )}
        <Caption id="trends" />
      </Card>

      <Card title={t('ov.card.mix')}>
        <EChart option={localizedChannelMixOption(stats, locale)} />
        <Caption id="mix" />
      </Card>

      {hasGeo ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title={t('ov.card.geo')}>
            <EChart option={audienceBarOption(geoRows, '')} />
            {geoInsights.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">{geoInsights}</div>
            )}
            <Caption id="geo" />
          </Card>
          <Card title={t('ov.card.device')}>
            <EChart option={deviceShareOption(devRows, t('an.devShare'))} />
            <Caption id="device" />
          </Card>
        </div>
      ) : null}

      {/* UTM breakdown */}
      {utm && utm.length > 0 && (
        <Card title={t('ov.card.utm', { pct: utmCoveragePct })}>
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={t('i18n.ov.utmTableAria')}
          >
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Source</th>
                  <th>Medium</th>
                  <th>Campaign</th>
                  <th>{t('ov.col.visits')}</th>
                  <th>{t('ov.col.applications')}</th>
                  <th>CR</th>
                </tr>
              </thead>
              <tbody>
                {/* БАГ-07: normalized key (trim + lowercase) — «tg/post/general» 20+18 is one row. */}
                {topUtmRows(utm).map((u, i) => (
                  <tr
                    key={`${u.utmSource}-${u.utmMedium}-${u.utmCampaign}-${i}`}
                    className="border-t border-slate-100"
                  >
                    <td className="py-1">{u.utmSource ?? '(none)'}</td>
                    <td>{u.utmMedium ?? '(none)'}</td>
                    <td>{u.utmCampaign ?? '(none)'}</td>
                    <td>{formatInt(u.visits)}</td>
                    <td>{formatInt(u.goalReaches)}</td>
                    <td>{formatPercent(u.conversionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {utmInsights.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{utmInsights}</div>}
        </Card>
      )}

      {/* Entry pages */}
      {topEntry.length > 0 && (
        <Card title={t('ov.card.entry')}>
          <PagesTable title={t('ov.card.entry')} rows={topEntry} />
          {entryInsights.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">{entryInsights}</div>
          )}
        </Card>
      )}

      {/* Exit pages */}
      {topExit.length > 0 && (
        <Card title={t('ov.card.exit')}>
          <PagesTable title={t('ov.card.exit')} rows={topExit} />
          {exitInsights.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">{exitInsights}</div>
          )}
        </Card>
      )}

      <Card id="weak-spots" title={t('ov.card.weak')}>
        {weak.length === 0 ? (
          <p className="text-sm text-slate-500">{t('ov.weak.none')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {weak.map((w) => (
              <li key={w.channel} className="flex justify-between border-b border-slate-100 py-1">
                <span>{channelName(w.channel, locale)}</span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-500">
                    {t('ov.weak.detail', {
                      visits: formatInt(w.visits),
                      cr: formatPercent(w.conversionRate),
                    })}
                  </span>
                  <Link
                    to={buildHypothesisUrl({
                      segment: w.channel,
                      trouble: t('i18n.ov.weak.trouble'),
                      evidence: t('i18n.ov.weak.evidence', {
                        cr: formatPercent(w.conversionRate),
                        n: formatInt(w.visits),
                      }),
                    })}
                    className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    {t('ov.weak.hypothesis')}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

/**
 * Dismissible first-visit onboarding card (3 quick steps). Thin UI over lib/onboarding +
 * localStorage; hidden once dismissed.
 */
function OnboardingCard(): JSX.Element | null {
  const { t } = useT();
  const [visible, setVisible] = useState(() => shouldShowOnboarding(localStorage));
  if (!visible) return null;
  const dismiss = (): void => {
    markOnboarded(localStorage);
    setVisible(false);
  };
  return (
    <div className="relative rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('common.close')}
        className="absolute right-3 top-3 text-indigo-600 hover:text-indigo-700"
      >
        ✕
      </button>
      <h2 className="mb-2 text-base font-semibold text-indigo-900">{t('onboarding.title')}</h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-indigo-800">
        <li>{t('onboarding.step1')}</li>
        <li>{t('onboarding.step2')}</li>
        <li>{t('onboarding.step3')}</li>
      </ol>
    </div>
  );
}

/** Data wrapper: binds the channel query to the presentational view. */
export function Overview(): JSX.Element {
  const { from, to, segment, includeTest } = useFilters();
  const q = useQuery({
    queryKey: ['channels', from, to],
    queryFn: () => api.channels({ from, to }),
  });
  // The auto-detected KPI goal — independent of the date range. Absent (404) → badge hidden.
  const goal = useQuery({ queryKey: ['primary-goal'], queryFn: api.primaryGoal, retry: false });
  const geoDevice = useQuery({
    queryKey: ['geo-device', from, to],
    queryFn: () => api.geoDevice({ from, to }),
  });
  const utm = useQuery({
    queryKey: ['utm', from, to],
    queryFn: () => api.utm({ from, to }),
  });
  const entryPages = useQuery({
    queryKey: ['pages', from, to],
    queryFn: () => api.pages({ from, to }),
  });
  const exitPages = useQuery({
    queryKey: ['exit-pages', from, to],
    queryFn: () => api.exitPages({ from, to }),
  });
  const b2bDeals = useQuery({
    queryKey: ['b2b'],
    queryFn: () => api.b2b(),
  });
  // ANA-19: «Оплачено» = B2C paid (manual/CSV) + B2B paid — the payments summary is the factsource.
  const payments = useQuery({
    queryKey: ['payments-summary', from, to],
    queryFn: () => api.paymentsSummary({ from, to }),
    retry: false,
  });
  // ANA-171: the same B2C payments per day — with the paid B2B deals they build the hero's
  // PAID daily series, so the «успеваем к 300?» forecast counts payments, not applications.
  const b2cDays = useQuery({
    queryKey: ['b2c-payments', from, to],
    queryFn: () => api.b2cPayments({ from, to }),
    retry: false,
  });
  const kpiTarget = useKpiTarget();
  // ANA-75 (БАГ-01): админская «Дата события» (EVENT_DATE) — единый дедлайн KPI на всех экранах;
  // не задана/невалидна → '' → эвристика «+2 длины периода» и оговорка. REG-12: публичный срез
  // GET /api/settings/public (только KPI_TARGET/EVENT_DATE) — GET /api/settings теперь только админ.
  const settingsQ = useQuery({
    queryKey: ['settings-public'],
    queryFn: v3.settingsPublic,
    retry: false,
    staleTime: 60_000,
  });
  const eventDate = readEventDate(settingsQ.data);

  // Apply segment filter; ANA-22 hides the test/service rows unless «Показать тестовый трафик».
  const allChannels = q.data ?? [];
  const visibleChannels = applyTestTrafficFilter(allChannels, includeTest, isTestChannelRow);
  const visibleUtm = applyTestTrafficFilter(utm.data ?? [], includeTest, isTestChannelRow);
  const filteredChannels = filterBySegment(visibleChannels, segment);
  const filteredUtm = filterUtmBySegment(visibleUtm, segment);

  return (
    <OverviewView
      status={q.status}
      stats={filteredChannels}
      b2bDeals={b2bDeals.data}
      primaryGoalName={goal.data?.name}
      goalLabel={formatGoalLabel(goal.data)}
      geoDevice={geoDevice.data}
      utm={filteredUtm}
      entryPages={applyTestTrafficFilter(entryPages.data ?? [], includeTest, (r) =>
        isTestPage(r.page),
      )}
      exitPages={applyTestTrafficFilter(exitPages.data ?? [], includeTest, (r) =>
        isTestPage(r.page),
      )}
      to={to}
      afterKpi={<OnboardingCard />}
      kpiTarget={kpiTarget}
      b2cPaid={payments.data?.b2cPaid ?? 0}
      b2cDays={b2cDays.data}
      eventDate={eventDate}
      showDeadlineCaveat={!eventDate}
    />
  );
}

/** WoW delta chip: green when up, red when down, grey when flat/unknown. */
function Delta({ ratio }: { ratio: number }): JSX.Element {
  const tone = ratio > 0 ? 'text-green-700' : ratio < 0 ? 'text-red-700' : 'text-slate-500';
  const arrow = ratio > 0 ? '▲' : ratio < 0 ? '▼' : '→';
  return (
    <span className={`text-xs font-medium ${tone}`}>
      {arrow} {formatPercent(Math.abs(ratio))} WoW
    </span>
  );
}

/** Weekly digest: a one-glance "what happened this week" card (WoW visits/applications + leaders). */
function WeeklyDigest({ stats }: { stats: ChannelStat[] }): JSX.Element | null {
  const { t, locale } = useT();
  const d = weeklyDigest(stats);
  if (!d.hasData) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">{t('digest.title')}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">{t('digest.visits7')}</p>
          <p className="text-xl font-semibold">{formatInt(d.visits)}</p>
          <Delta ratio={d.visitsDelta} />
        </div>
        <div>
          <p className="text-xs text-slate-500">{t('ov.digest.applications7')}</p>
          <p className="text-xl font-semibold">{formatInt(d.applications)}</p>
          <Delta ratio={d.applicationsDelta} />
        </div>
        <div>
          <p className="text-xs text-slate-500">{t('ov.digest.topChannel')}</p>
          <p className="text-base font-semibold">
            {d.topChannel ? channelName(d.topChannel.channel, locale) : '—'}
          </p>
          {d.topChannel ? (
            <p className="text-xs text-slate-500">
              {t('ov.digest.visitsN', { n: formatInt(d.topChannel.visits) })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Card({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div id={id} className="scroll-mt-20 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}
