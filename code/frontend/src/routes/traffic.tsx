import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from '@headlessui/react';
import { Link } from 'react-router-dom';
import type { ChannelStat, UtmStat } from '@pca/shared';
import { api } from '../lib/api';
import { useFilters } from '../store/filters';
import { useT, channelName } from '../i18n';
import type { Locale } from '../store/prefs';
import { InsightBadge } from '../components/InsightBadge';
import { localizeChart } from '../lib/chart-i18n';
import { formatInt, formatPercent } from '../lib/format';
import {
  channelBarOption,
  channelVisitsVsReachesOption,
  channelRows,
  untaggedChannelHint,
  LOW_UTM_COVERAGE_RATIO,
  utmCoverage,
  utmRows,
} from '../lib/traffic';
import { utmSankeyOption } from '../lib/sankey';
import { combineStatus, type QueryStatus } from '../lib/query-status';
import { EChart } from '../components/charts/EChart';
import { Tooltip } from '../components/Tooltip';
import { ChartCaption } from '../components/charts/ChartCaption';
import { EmptyState } from '../components/EmptyState';
import { filterBySegment, filterUtmBySegment } from '../lib/segment-filter';
import { applyTestTrafficFilter, isTestChannelRow } from '../lib/test-traffic';
import { buildHypothesisUrl } from '../lib/hypothesis-prefill';
import {
  CR_EXCELLENT_TARGET,
  CR_GOOD_TARGET,
  CR_HIGH_VS_AVG,
  CR_LOW_VS_AVG,
  MIN_CHANNEL_VISITS,
} from '../lib/insight-thresholds';

type TFn = ReturnType<typeof useT>['t'];

/** Compute channel insights */
function computeChannelInsights(stats: ChannelStat[], t: TFn, locale: Locale): JSX.Element[] {
  const insights: JSX.Element[] = [];
  const rows = channelRows(stats);
  const overallCR =
    rows.reduce((a, r) => a + r.goalReaches, 0) / rows.reduce((a, r) => a + r.visits, 0) || 0;

  for (const r of rows) {
    const channel = channelName(r.channel, locale);
    // БАГ-09 (ANA-118): the praise gate mirrors overview.tsx — absolute CR target + relative
    // vs average + unified sample size, all from lib/insight-thresholds.ts, so Traffic never
    // praises a CR that the overall verdict calls «низкий».
    if (
      r.conversionRate >= CR_GOOD_TARGET &&
      r.conversionRate > overallCR * CR_HIGH_VS_AVG &&
      r.visits > MIN_CHANNEL_VISITS
    ) {
      insights.push(
        <InsightBadge
          key={`cr-good-${r.channel}`}
          type="good"
          text={t('ins.channelCrAbove', {
            channel,
            cr: formatPercent(r.conversionRate),
            avg: formatPercent(overallCR),
          })}
        />,
      );
    }
    // Low CR with high traffic - problem
    else if (r.conversionRate < overallCR * CR_LOW_VS_AVG && r.visits > MIN_CHANNEL_VISITS) {
      insights.push(
        <span key={`cr-bad-${r.channel}`} className="inline-flex items-center gap-1">
          <InsightBadge
            type="warning"
            text={t('ins.channelCrBelow', {
              channel,
              cr: formatPercent(r.conversionRate),
              visits: formatInt(r.visits),
            })}
          />
          <Link
            to={buildHypothesisUrl({
              segment: channel,
              trouble: t('ins.lowConversion'),
              evidence: t('ins.crEvidence', {
                cr: formatPercent(r.conversionRate),
                visits: formatInt(r.visits),
              }),
            })}
            className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            {t('ins.toHypothesis')}
          </Link>
        </span>,
      );
    }
  }

  return insights;
}

/** Compute UTM insights */
function computeUtmInsights(utm: UtmStat[], stats: ChannelStat[], t: TFn): JSX.Element[] {
  const insights: JSX.Element[] = [];
  const cov = utmCoverage(stats, utm);

  if (cov.ratio >= LOW_UTM_COVERAGE_RATIO) {
    insights.push(
      <InsightBadge
        key="utm-good"
        type="good"
        text={t('ins.utmGood', { pct: formatPercent(cov.ratio) })}
      />,
    );
  } else {
    insights.push(
      <InsightBadge
        key="utm-bad"
        type="warning"
        text={t('ins.utmBad', { pct: formatPercent(cov.ratio) })}
      />,
    );
  }

  // Find top performing UTM campaigns
  const utmWithSource = utm.filter((u) => u.utmSource && u.utmSource !== '(none)');
  if (utmWithSource.length > 0) {
    const topCR = utmWithSource.sort((a, b) => b.conversionRate - a.conversionRate)[0];
    // ANA-118: same thresholds as the channel insights — CR above the shared «хороший»
    // target and enough traffic for the verdict to mean anything.
    if (topCR && topCR.conversionRate > CR_EXCELLENT_TARGET && topCR.visits > MIN_CHANNEL_VISITS) {
      insights.push(
        <InsightBadge
          key="utm-top"
          type="good"
          text={t('ins.utmTop', {
            campaign: `${topCR.utmSource}/${topCR.utmCampaign}`,
            cr: formatPercent(topCR.conversionRate),
          })}
        />,
      );
    }
  }

  return insights;
}

/** Pure presentational Traffic view: channel mix + table, plus the UTM-breakdown table. */
export function TrafficView({
  status,
  stats,
  utm,
}: {
  status: QueryStatus;
  stats: ChannelStat[];
  utm: UtmStat[];
}): JSX.Element {
  const { segment } = useFilters();
  const { t, locale } = useT();
  const [sankeyOpen, setSankeyOpen] = useState(false);
  if (status === 'pending') return <p className="text-slate-500">{t('common.loading')}</p>;
  if (status === 'error')
    return (
      <p role="alert" className="text-red-700">
        {t('an.tr.error')}
      </p>
    );

  if (stats.length === 0 && utm.length === 0)
    return segment === 'b2b' ? <EmptyState message={t('seg.b2bHint')} /> : <EmptyState />;

  const cov = utmCoverage(stats, utm);
  const rows = channelRows(stats);
  const utmTable = utmRows(utm);
  const channelInsights = computeChannelInsights(stats, t, locale);
  const utmInsights = computeUtmInsights(utm, stats, t);
  const untaggedHint = untaggedChannelHint(stats);
  const channelLabel = (c: string) => channelName(c, locale);

  return (
    <section className="space-y-6">
      {/* ANA-17: в сегменте без UTM-разметки (напр. b2b) оценка покрытия не имеет смысла */}
      {cov.low && utm.length > 0 ? (
        <div role="status" className="rounded bg-amber-100 px-3 py-2 text-sm text-amber-800">
          <p>{t('kpi.lowUtmShort', { pct: formatPercent(cov.ratio) })}</p>
          {/* ANA-149: senior referral/ambassador teams ask WHERE the untagged traffic comes
              from — show the top channels behind the untagged visits instead of a bare % . */}
          {untaggedHint.length > 0 ? (
            <p className="mt-1">
              {t('kpi.lowUtmChannels', {
                channels: untaggedHint
                  .map((h) => `${channelLabel(h.channel)} — ${formatInt(h.visits)}`)
                  .join(', '),
              })}
            </p>
          ) : null}
          <p className="mt-1">{t('kpi.lowUtmHowTo')}</p>
        </div>
      ) : null}
      {segment === 'b2b' ? (
        <div
          role="status"
          className="rounded border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm text-indigo-800"
        >
          {t('seg.b2bHint')}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">{t('an.tr.channelsVisits')}</h2>
        <EChart option={localizeChart(channelBarOption(rows), { category: channelLabel })} />
        {channelInsights.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">{channelInsights}</div>
        )}
        <ChartCaption
          correct={t('cap.tr.visits.correct')}
          caveat={t('cap.tr.visits.caveat')}
          advice={t('cap.tr.visits.advice')}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">{t('an.tr.visitsVsApps')}</h2>
        <EChart
          option={localizeChart(
            channelVisitsVsReachesOption(rows, {
              visits: t('an.col.visits'),
              reaches: t('an.col.applications'),
            }),
            {
              series: [t('an.col.visits'), t('an.col.applications')],
              category: channelLabel,
            },
          )}
        />
        <ChartCaption
          correct={t('cap.tr.vs.correct')}
          caveat={t('cap.tr.vs.caveat')}
          advice={t('cap.tr.vs.advice')}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('an.tr.flow')}</h2>
          <button
            type="button"
            onClick={() => setSankeyOpen(true)}
            className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
          >
            {`⛶ ${t('an.tr.fullscreen')}`}
          </button>
        </div>
        <EChart
          option={utmSankeyOption(utm, {
            terminal: t('an.col.applications'),
            noUtm: t('an.noUtm'),
          })}
          height={460}
        />
        <ChartCaption
          correct={t('cap.tr.flow.correct')}
          caveat={t('cap.tr.flow.caveat')}
          advice={t('cap.tr.flow.advice')}
        />
      </div>

      {/* Fullscreen Sankey — readable on a large canvas */}
      <Dialog open={sankeyOpen} onClose={() => setSankeyOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="flex h-[90vh] w-[95vw] max-w-[1600px] flex-col rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold">{t('an.tr.flow')}</Dialog.Title>
              <button
                type="button"
                onClick={() => setSankeyOpen(false)}
                aria-label={t('common.close')}
                className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
              >
                {`✕ ${t('common.close')}`}
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {sankeyOpen && (
                <EChart
                  option={utmSankeyOption(utm, {
                    terminal: t('an.col.applications'),
                    noUtm: t('an.noUtm'),
                  })}
                  height={window.innerHeight * 0.78}
                />
              )}
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t('an.tr.table')}</h2>
        {/* ANA-135: таблица каналов — единственная на странице без обёртки-скролла; при 390px
            её min-content (длинные названия каналов + «Пользователи») вылезал за контейнер
            (scrollWidth 398 > 390). Обёртка как у UTM-таблицы ниже и таблиц overview/history. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">{t('an.col.channel')}</th>
                <th>{t('an.col.visits')}</th>
                <th>{t('an.col.users')}</th>
                <th>{t('an.col.applications')}</th>
                <th>CR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.channel} className="border-t border-slate-100">
                  <td className="py-1">{channelLabel(r.channel)}</td>
                  <td>{formatInt(r.visits)}</td>
                  <td>{formatInt(r.users)}</td>
                  <td>{formatInt(r.goalReaches)}</td>
                  <td>{formatPercent(r.conversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">
          <Tooltip text={t('an.tr.utmHint')}>{t('an.tr.utm')}</Tooltip>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Source</th>
                <th>Medium</th>
                <th>Campaign</th>
                <th>{t('an.col.visits')}</th>
                <th>{t('an.col.applications')}</th>
                <th>CR</th>
              </tr>
            </thead>
            <tbody>
              {utmTable.map((u) => (
                <tr
                  key={`${u.source} ${u.medium} ${u.campaign}`}
                  className="border-t border-slate-100"
                >
                  <td className="py-1">{u.source}</td>
                  <td>{u.medium}</td>
                  <td>{u.campaign}</td>
                  <td>{formatInt(u.visits)}</td>
                  <td>{formatInt(u.goalReaches)}</td>
                  <td>{formatPercent(u.conversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {utmInsights.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{utmInsights}</div>}
      </div>
    </section>
  );
}

/** Data wrapper: channel + UTM queries combined into one status. */
export function Traffic(): JSX.Element {
  const { from, to, segment, includeTest } = useFilters();
  const channels = useQuery({
    queryKey: ['channels', from, to],
    queryFn: () => api.channels({ from, to }),
  });
  const utm = useQuery({ queryKey: ['utm', from, to], queryFn: () => api.utm({ from, to }) });
  const status = combineStatus(channels.status, utm.status);

  // Apply segment filter; ANA-22 hides the test/service rows unless «Показать тестовый трафик».
  const allChannels = channels.data ?? [];
  const visibleChannels = applyTestTrafficFilter(allChannels, includeTest, isTestChannelRow);
  const visibleUtm = applyTestTrafficFilter(utm.data ?? [], includeTest, isTestChannelRow);
  const filteredChannels = filterBySegment(visibleChannels, segment);
  const filteredUtm = filterUtmBySegment(visibleUtm, segment);

  return <TrafficView status={status} stats={filteredChannels} utm={filteredUtm} />;
}
