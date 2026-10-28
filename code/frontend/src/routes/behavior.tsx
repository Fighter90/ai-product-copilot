import { useQuery } from '@tanstack/react-query';
import { weightedBounce, type PageStat } from '@pca/shared';
import { api } from '../lib/api';
import { useFilters } from '../store/filters';
import { formatInt, formatPercent } from '../lib/format';
import { pageRows, type PageRow } from '../lib/behavior';
import { EChart } from '../components/charts/EChart';
import { ChartCaption } from '../components/charts/ChartCaption';
import { EmptyState } from '../components/EmptyState';
import { combineStatus, type QueryStatus } from '../lib/query-status';
import { applyTestTrafficFilter, isTestPage } from '../lib/test-traffic';
import { InsightBadge } from '../components/InsightBadge';
import { InfoHint } from '../components/InfoHint';
import {
  BOUNCE_HIGH,
  BOUNCE_LOW,
  CR_GOOD_TARGET,
  CR_HIGH_VS_AVG,
  CR_LOW_VS_AVG,
  MIN_PAGE_VISITS,
  MIN_PAGE_VISITS_CR_LOW,
} from '../lib/insight-thresholds';
import { useT } from '../i18n';

type TFn = ReturnType<typeof useT>['t'];

/** Compute page insights with detailed analysis */
function computePageInsights(
  pages: PageStat[],
  type: 'entry' | 'exit',
  t: TFn,
): { badges: JSX.Element[]; summary: string } {
  const badges: JSX.Element[] = [];
  if (pages.length === 0) return { badges, summary: '' };

  const rows = pageRows(pages);
  const avgBounce = rows.reduce((a, r) => a + r.bounceRate, 0) / rows.length;
  const avgCR = rows.reduce((a, r) => a + r.conversionRate, 0) / rows.length;
  const totalVisits = rows.reduce((a, r) => a + r.visits, 0);
  const totalReaches = rows.reduce((a, r) => a + r.goalReaches, 0);

  // Summary
  const summary =
    type === 'entry'
      ? t('ins.entrySummary', {
          n: rows.length,
          visits: formatInt(totalVisits),
          apps: formatInt(totalReaches),
          cr: formatPercent(totalVisits > 0 ? totalReaches / totalVisits : 0),
        })
      : t('ins.exitSummary', {
          n: rows.length,
          visits: formatInt(totalVisits),
          bounce: formatPercent(avgBounce),
        });

  for (const p of rows.slice(0, 10)) {
    // High bounce rate warning
    if (p.bounceRate > BOUNCE_HIGH && p.visits > MIN_PAGE_VISITS) {
      badges.push(
        <InsightBadge
          key={`bounce-${type}-${p.page}`}
          type="warning"
          text={t('ins.bounceHigh', {
            bounce: formatPercent(p.bounceRate),
            page: p.page,
            visits: formatInt(p.visits),
          })}
        />,
      );
    }
    // Low bounce rate - good
    else if (p.bounceRate < BOUNCE_LOW && p.visits > MIN_PAGE_VISITS) {
      badges.push(
        <InsightBadge
          key={`good-bounce-${type}-${p.page}`}
          type="good"
          text={t('ins.bounceLow', { bounce: formatPercent(p.bounceRate), page: p.page })}
        />,
      );
    }

    // High conversion - good. ANA-75 (БАГ-09): praised only when the CR also reaches the shared
    // absolute target — «выше среднего (0.3%)» for a 0.6% CR must not sit next to
    // «Общий CR 0.6% — низкий, цель > 2%».
    if (
      p.conversionRate >= CR_GOOD_TARGET &&
      p.conversionRate > avgCR * CR_HIGH_VS_AVG &&
      p.visits > MIN_PAGE_VISITS
    ) {
      badges.push(
        <InsightBadge
          key={`cr-good-${type}-${p.page}`}
          type="good"
          text={t('ins.pageCrHigh', {
            cr: formatPercent(p.conversionRate),
            page: p.page,
            avg: formatPercent(avgCR),
          })}
        />,
      );
    }
    // Low conversion with high traffic - problem
    else if (p.conversionRate < avgCR * CR_LOW_VS_AVG && p.visits > MIN_PAGE_VISITS_CR_LOW) {
      badges.push(
        <InsightBadge
          key={`cr-bad-${type}-${p.page}`}
          type="warning"
          text={t('ins.pageCrLow', {
            cr: formatPercent(p.conversionRate),
            page: p.page,
            visits: formatInt(p.visits),
          })}
        />,
      );
    }
  }

  return { badges, summary };
}

/** Shorten a URL to its path for chart labels */
function shortLabel(page: string): string {
  const path = page.replace(/^https?:\/\/[^/]+/, '');
  return path === '' ? '/' : path;
}

/** ECharts bounce rate bar chart (horizontal) */
function bounceBarOption(rows: PageRow[], title: string, bounceLabel: string): object {
  const top = rows
    .slice(0, 8)
    .sort((a, b) => b.bounceRate - a.bounceRate)
    .reverse();
  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 13 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        const p = params[0] as { name: string; value: number };
        return `${p.name}<br/>${bounceLabel}: ${formatPercent(p.value)}`;
      },
    },
    grid: { left: 140, right: 16, top: 32, bottom: 28 },
    xAxis: {
      type: 'value',
      max: 1,
      axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
    },
    yAxis: { type: 'category', data: top.map((r) => shortLabel(r.page)) },
    series: [
      {
        name: bounceLabel,
        type: 'bar',
        data: top.map((r) => ({
          value: r.bounceRate,
          itemStyle: {
            color: r.bounceRate > 0.4 ? '#ef4444' : r.bounceRate > 0.25 ? '#f59e0b' : '#22c55e',
          },
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (v: { value: number }) => formatPercent(v.value),
        },
      },
    ],
  };
}

/** ECharts conversion rate bar chart (horizontal) */
function crBarOption(rows: PageRow[], title: string): object {
  const top = rows
    .slice(0, 8)
    .filter((r) => r.visits > 20)
    .sort((a, b) => a.conversionRate - b.conversionRate)
    .reverse();
  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 13 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        const p = params[0] as { name: string; value: number };
        return `${p.name}<br/>CR: ${formatPercent(p.value)}`;
      },
    },
    grid: { left: 140, right: 16, top: 32, bottom: 28 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
    yAxis: { type: 'category', data: top.map((r) => shortLabel(r.page)) },
    series: [
      {
        name: 'CR',
        type: 'bar',
        data: top.map((r) => ({
          value: r.conversionRate,
          itemStyle: {
            color:
              r.conversionRate > 0.02
                ? '#22c55e'
                : r.conversionRate > 0.005
                  ? '#f59e0b'
                  : '#ef4444',
          },
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (v: { value: number }) => formatPercent(v.value),
        },
      },
    ],
  };
}

function PageTable({ title, rows }: { title: string; rows: PageRow[] }): JSX.Element {
  const { t } = useT();
  const avgCR = rows.length > 0 ? rows.reduce((a, r) => a + r.conversionRate, 0) / rows.length : 0;
  const avgBounce = rows.length > 0 ? rows.reduce((a, r) => a + r.bounceRate, 0) / rows.length : 0;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div
        className="overflow-x-auto rounded-lg border border-slate-200"
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-500">
              <th className="px-3 py-2">{t('an.col.page')}</th>
              <th className="px-3 py-2">{t('an.col.visits')}</th>
              <th className="px-3 py-2">{t('an.col.users')}</th>
              <th className="px-3 py-2">{t('an.col.bounce')}</th>
              <th className="px-3 py-2">{t('an.col.applications')}</th>
              <th className="px-3 py-2">CR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bounceColor =
                r.bounceRate > 0.5
                  ? 'text-red-700'
                  : r.bounceRate > 0.3
                    ? 'text-amber-700'
                    : 'text-green-700';
              const crColor =
                r.conversionRate > avgCR * 1.5
                  ? 'text-green-700'
                  : r.conversionRate < avgCR * 0.5
                    ? 'text-red-700'
                    : 'text-slate-600';
              return (
                <tr key={r.page} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{shortLabel(r.page)}</td>
                  <td className="px-3 py-2">{formatInt(r.visits)}</td>
                  <td className="px-3 py-2">{formatInt(r.users)}</td>
                  <td className={`px-3 py-2 font-medium ${bounceColor}`}>
                    {formatPercent(r.bounceRate)}
                  </td>
                  <td className="px-3 py-2">{formatInt(r.goalReaches)}</td>
                  <td className={`px-3 py-2 font-medium ${crColor}`}>
                    {formatPercent(r.conversionRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t('an.beh.averages', { bounce: formatPercent(avgBounce), cr: formatPercent(avgCR) })}
        </div>
      )}
    </div>
  );
}

/** Pure presentational Behavior view: top entry + exit pages with bounce rate + conversion. */
export function BehaviorView({
  status,
  entry,
  exit,
}: {
  status: QueryStatus;
  entry: PageStat[];
  exit: PageStat[];
}): JSX.Element {
  const { t } = useT();
  if (status === 'pending') return <p className="text-slate-500">{t('common.loading')}</p>;
  if (status === 'error')
    return (
      <p role="alert" className="text-red-700">
        {t('an.beh.error')}
      </p>
    );

  if (entry.length === 0 && exit.length === 0) return <EmptyState />;

  const entryRows = pageRows(entry);
  const exitRows = pageRows(exit);
  const { badges: entryBadges, summary: entrySummary } = computePageInsights(entry, 'entry', t);
  const { summary: exitSummary } = computePageInsights(exit, 'exit', t);

  // Summary stats
  const totalEntryVisits = entryRows.reduce((a, r) => a + r.visits, 0);
  const totalEntryReaches = entryRows.reduce((a, r) => a + r.goalReaches, 0);
  const entryCR = totalEntryVisits > 0 ? totalEntryReaches / totalEntryVisits : 0;
  // ANA-16: visit-weighted bounce via the shared aggregator — a plain row average lets a
  // 1-visit page with 100% bounce move the headline as much as the home page.
  const avgEntryBounce = weightedBounce(entryRows);

  // Find best and worst pages
  const bestPage =
    entryRows.length > 0
      ? entryRows.reduce(
          (best, r) => (r.conversionRate > best.conversionRate ? r : best),
          entryRows[0]!,
        )
      : null;
  const worstPage =
    entryRows.length > 0
      ? entryRows.reduce((worst, r) => (r.bounceRate > worst.bounceRate ? r : worst), entryRows[0]!)
      : null;

  return (
    <section className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.beh.entryCount')}</div>
          <div className="text-2xl font-bold">{entryRows.length}</div>
          {entrySummary && <div className="mt-1 text-xs text-slate-500">{entrySummary}</div>}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            {t('an.visitsCount')}
            {/* ANA-20: pages vs channels legitimately diverge — the source is stated and explained */}
            <InfoHint text={t('dq.visitsSourceHint')} />
          </div>
          <div className="text-2xl font-bold">{formatInt(totalEntryVisits)}</div>
          <div className="mt-1 text-xs text-slate-500">
            {t('dq.visitsSource')} · CR {formatPercent(entryCR)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            {t('an.beh.avgBounce')}
            <InfoHint text={t('dq.bounceWeightedHint')} />
          </div>
          <div
            className={`text-2xl font-bold ${avgEntryBounce > 0.3 ? 'text-red-700' : avgEntryBounce > 0.2 ? 'text-amber-700' : 'text-green-700'}`}
          >
            {formatPercent(avgEntryBounce)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {avgEntryBounce > 0.3 ? `⚠️ ${t('an.beh.high')}` : `✅ ${t('an.beh.normal')}`}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.beh.exitCount')}</div>
          <div className="text-2xl font-bold">{exitRows.length}</div>
          {exitSummary && <div className="mt-1 text-xs text-slate-500">{exitSummary}</div>}
        </div>
      </div>

      {/* Key insights */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('an.keyInsights')}</h3>
        <div className="flex flex-wrap gap-2">
          {bestPage && bestPage.conversionRate >= CR_GOOD_TARGET && (
            <InsightBadge
              type="good"
              text={t('ins.bestCr', {
                page: shortLabel(bestPage.page),
                cr: formatPercent(bestPage.conversionRate),
              })}
            />
          )}
          {worstPage && worstPage.bounceRate > BOUNCE_HIGH && (
            <InsightBadge
              type="warning"
              text={t('ins.worstBounce', {
                page: shortLabel(worstPage.page),
                bounce: formatPercent(worstPage.bounceRate),
              })}
            />
          )}
          {entryCR >= CR_GOOD_TARGET ? (
            <InsightBadge
              type="good"
              text={t('ins.overallCrGood', { cr: formatPercent(entryCR) })}
            />
          ) : (
            <InsightBadge
              type="warning"
              text={t('ins.overallCrLow', { cr: formatPercent(entryCR) })}
            />
          )}
          {entryBadges.slice(0, 3)}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <EChart option={crBarOption(entryRows, t('an.beh.chart.entryCr'))} />
          <ChartCaption
            correct={t('cap.beh.cr.correct')}
            caveat={t('cap.beh.cr.caveat')}
            advice={t('cap.beh.cr.advice')}
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <EChart
            option={bounceBarOption(entryRows, t('an.beh.chart.entryBounce'), t('an.col.bounce'))}
          />
          <ChartCaption
            correct={t('cap.beh.bounce.correct')}
            caveat={t('cap.beh.bounce.caveat')}
            advice={t('cap.beh.bounce.advice')}
          />
        </div>
      </div>

      {/* Exit page chart */}
      {exitRows.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <EChart
            option={bounceBarOption(exitRows, t('an.beh.chart.exitBounce'), t('an.col.bounce'))}
          />
          <ChartCaption
            correct={t('cap.beh.exit.correct')}
            caveat={t('cap.beh.exit.caveat')}
            advice={t('cap.beh.exit.advice')}
          />
        </div>
      )}

      {/* Tables */}
      <PageTable title={t('an.beh.entryTitle')} rows={entryRows} />
      {exitRows.length > 0 && <PageTable title={t('an.beh.exitTitle')} rows={exitRows} />}

      {/* Recommendations */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('an.recommendations')}</h3>
        <ul className="space-y-2 text-sm text-slate-600">
          {worstPage && worstPage.bounceRate > BOUNCE_HIGH && (
            <li className="flex items-start gap-2">
              <span className="text-red-500">🔴</span>
              <span>
                <b>{shortLabel(worstPage.page)}</b>{' '}
                {t('an.beh.rec.worst', { bounce: formatPercent(worstPage.bounceRate) })}
              </span>
            </li>
          )}
          {entryCR < CR_GOOD_TARGET && (
            <li className="flex items-start gap-2">
              <span className="text-amber-500">🟡</span>
              <span>{t('an.beh.rec.crLow', { cr: formatPercent(entryCR) })}</span>
            </li>
          )}
          {entryCR >= CR_GOOD_TARGET && (
            <li className="flex items-start gap-2">
              <span className="text-green-500">🟢</span>
              <span>{t('an.beh.rec.crGood', { cr: formatPercent(entryCR) })}</span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <span className="text-blue-500">ℹ️</span>
            <span>{t('an.beh.rec.ab')}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}

/** Data wrapper: entry + exit page queries combined into one status. */
export function Behavior(): JSX.Element {
  const { from, to, includeTest } = useFilters();
  const entry = useQuery({ queryKey: ['pages', from, to], queryFn: () => api.pages({ from, to }) });
  const exit = useQuery({
    queryKey: ['exit-pages', from, to],
    queryFn: () => api.exitPages({ from, to }),
  });
  const status = combineStatus(entry.status, exit.status);
  // ANA-22: test/service pages (file://, /test_1, Tilda test pages…) are hidden unless
  // «Показать тестовый трафик» is on.
  return (
    <BehaviorView
      status={status}
      entry={applyTestTrafficFilter(entry.data ?? [], includeTest, (r) => isTestPage(r.page))}
      exit={applyTestTrafficFilter(exit.data ?? [], includeTest, (r) => isTestPage(r.page))}
    />
  );
}
