import { useQuery } from '@tanstack/react-query';
import type { ChannelStat, B2bDeal, GeoDeviceStat, PageStat } from '@pca/shared';
import { aggregatePeriod, pageKey, periodTotals } from '@pca/shared';
import { api } from '../lib/api';
import { v3, type LiveFunnel } from '../lib/api-v3';
import { useFilters } from '../store/filters';
import { formatInt, formatPercent } from '../lib/format';
import { combineStatus, type QueryStatus } from '../lib/query-status';
import {
  buildFunnel,
  buildSummaryFunnel,
  funnelOption,
  hasFunnelData,
  valuesFromStages,
} from '../lib/funnel';
import { EChart } from '../components/charts/EChart';
import { ChartCaption } from '../components/charts/ChartCaption';
import { EmptyState } from '../components/EmptyState';
import { channelRows } from '../lib/traffic';
import { funnelByChannelOption } from '../lib/funnel-by-channel';
import { CR_CRITICAL_TARGET, CR_GOOD_TARGET } from '../lib/insight-thresholds';
import { byCountry, audienceBarOption } from '../lib/audience';
import { localizeChart } from '../lib/chart-i18n';
import { InsightBadge } from '../components/InsightBadge';
import { B2cPaymentsCard } from '../components/payments/B2cPaymentsCard';
import { useT, channelName, type DictKey } from '../i18n';
import type { Locale } from '../store/prefs';

type TFn = ReturnType<typeof useT>['t'];

/** Bar chart for channel conversion rates */
function channelCrOption(channels: ChannelStat[], t: TFn, locale: Locale): object {
  const rows = channelRows(channels)
    .filter((r) => r.visits > 20)
    .sort((a, b) => a.conversionRate - b.conversionRate);
  return {
    title: {
      text: t('an.fn.chart.channelCr'),
      left: 'center',
      textStyle: { fontSize: 13 },
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        const p = params[0] as { name: string; value: number };
        return `${p.name}<br/>CR: ${formatPercent(p.value)}`;
      },
    },
    grid: { left: 120, right: 16, top: 32, bottom: 28 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
    yAxis: { type: 'category', data: rows.map((r) => channelName(r.channel, locale)) },
    series: [
      {
        name: 'CR',
        type: 'bar',
        data: rows.map((r) => ({
          value: r.conversionRate,
          itemStyle: {
            color:
              r.conversionRate > 0.02 ? '#22c55e' : r.conversionRate > 0.01 ? '#f59e0b' : '#ef4444',
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

/**
 * Funnel loss analysis (ANA-75 БАГ-10): the two branches are computed independently —
 * B2C (visits → заявки B2C) uses only Metrika visits/applications, while B2B pipeline losses use
 * only B2B deal data (tickets in the pipeline vs paid). B2C applications no longer count as
 * B2B pipeline losses.
 */
function FunnelLossAnalysis({
  visits,
  reaches,
  b2bTickets,
  b2bPaid,
}: {
  visits: number;
  reaches: number;
  b2bTickets: number;
  b2bPaid: number;
}): JSX.Element {
  const { t } = useT();
  // B2C-ветка: визиты, не дошедшие до заявки B2C.
  const lostAtApplication = Math.max(0, visits - reaches);
  const applicationLossRate = visits > 0 ? (lostAtApplication / visits) * 100 : 0;
  // B2B-ветка: только сделки/стадии — билеты в пайплайне, не дошедшие до оплаты.
  const lostAtB2bPipeline = Math.max(0, b2bTickets - b2bPaid);
  const b2bPipelineLossRate = b2bTickets > 0 ? (lostAtB2bPipeline / b2bTickets) * 100 : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('an.fn.loss.title')}</h3>
      <div className="space-y-2 text-sm text-slate-600">
        <div className="flex items-center justify-between">
          <span>{t('an.fn.loss.b2c')}</span>
          <span className="font-medium">
            {t('an.fn.loss.visits', {
              n: formatInt(lostAtApplication),
              pct: formatPercent(applicationLossRate / 100),
            })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t('an.fn.loss.b2b')}</span>
          <span className="font-medium">
            {t('an.fn.loss.deals', {
              n: formatInt(lostAtB2bPipeline),
              pct: formatPercent(b2bPipelineLossRate / 100),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Pure presentational Funnel — the «заявка ≠ оплата» conversion path across all states. */
export function FunnelView({
  status,
  stats,
  deals,
  geoDevice,
  pages,
  live = null,
}: {
  status: QueryStatus;
  stats: ChannelStat[];
  deals: B2bDeal[];
  geoDevice: GeoDeviceStat[];
  pages: PageStat[];
  /** Live pc-goals funnel (GET /api/live/funnel); null when unavailable → cached totals. */
  live?: LiveFunnel | null;
}): JSX.Element {
  const { t, locale } = useT();
  if (status === 'pending') return <p className="text-slate-500">{t('common.loading')}</p>;
  if (status === 'error')
    return (
      <p role="alert" className="text-red-700">
        {t('an.fn.error')}
      </p>
    );

  // Headline Визиты/Заявки B2C come from the single factsource so this page agrees with Overview
  // and Goals. appConversionRate below reuses the same clamped CR.
  const { visits, applications: reaches, conversionRate: appConversionRate } = periodTotals(stats);
  const b2bTickets = deals.reduce((a, d) => a + d.tickets, 0);
  const b2bPaid = deals.reduce((a, d) => a + (d.stage === 'paid' ? d.tickets : 0), 0);
  const b2bDealsCount = deals.length;

  if (visits === 0 && b2bDealsCount === 0) return <EmptyState />;

  // Conversion rate between B2B stages
  const paymentConversionRate = b2bTickets > 0 ? b2bPaid / b2bTickets : 0;

  // Geo data
  const geoRows = geoDevice.length > 0 ? byCountry(geoDevice) : [];

  // B2B deals by stage
  const dealsByStage = deals.reduce<Map<string, { tickets: number; count: number }>>((acc, d) => {
    const cur = acc.get(d.stage) ?? { tickets: 0, count: 0 };
    acc.set(d.stage, { tickets: cur.tickets + d.tickets, count: cur.count + 1 });
    return acc;
  }, new Map());

  // Page insights — БАГ-07: page rows arrive per day and per raw URL («/?utm=…», «/b2b/»), so
  // they are aggregated by the normalized page key first (path without query, one trailing-slash
  // form) — otherwise «Проблемные страницы» repeats one page 3–5 times with split numbers.
  // The shared aggregator sums visits/reaches, visit-weights bounce and recomputes CR.
  const normalizedPages = aggregatePeriod(pages, (p) => pageKey(p.page)).map((p) => ({
    ...p,
    page: pageKey(p.page),
  }));
  const highBouncePages = normalizedPages.filter((p) => p.bounceRate > 0.4 && p.visits > 30);
  const lowCrPages = normalizedPages.filter((p) => p.conversionRate < 0.005 && p.visits > 50);
  // ANA-21: per-issue pc-goals funnel (Визиты → reg_open → cart_open → reg_step1 → Оплата) when
  // the live funnel is available; «Оплата» falls back to manually entered B2B deals paid in the
  // period. Without live data the chart falls back to the cached SQLite totals.
  // ANA-75 БАГ-10: «Визиты» в воронке переопределяются тем же periodTotals(stats), что и в
  // карточке выше — один источник на страницу, иначе карточка и воронка расходятся (live-цели
  // считают визиты по-другому).
  const stages = live
    ? buildFunnel(
        { ...valuesFromStages(live.stages), visits },
        {
          paymentFallback: b2bPaid,
          labels: {
            visits: t('an.col.visits'),
            reg_open: t('an.fn.stage.regOpen'),
            cart_open: t('an.fn.stage.cartOpen'),
            reg_step1: t('an.fn.stage.regStep1'),
            payment: t('an.fn.stage.payment'),
          },
        },
      )
    : buildSummaryFunnel(
        { visits, applications: reaches, b2bTickets, b2bPaid },
        {
          visits: t('an.col.visits'),
          applications: t('an.fn.b2cApps'),
          b2bPipeline: 'B2B pipeline',
          b2bPaid: t('an.fn.b2bPaid'),
        },
      );

  return (
    <section className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.visitsCount')}</div>
          <div className="text-xl font-bold">{formatInt(visits)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.fn.b2cAppsCount')}</div>
          <div className="text-xl font-bold">{formatInt(reaches)}</div>
          <div className="text-xs text-slate-500">CR {formatPercent(appConversionRate)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">B2B pipeline</div>
          <div className="text-xl font-bold">{formatInt(b2bTickets)}</div>
          <div className="text-xs text-slate-500">{t('an.dealsN', { n: b2bDealsCount })}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.fn.b2bPaid')}</div>
          <div className="text-xl font-bold">{formatInt(b2bPaid)}</div>
          <div className="text-xs text-slate-500">CR {formatPercent(paymentConversionRate)}</div>
        </div>
      </div>

      {/* Key insights */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('an.keyInsights')}</h3>
        <div className="flex flex-wrap gap-2">
          {appConversionRate >= CR_GOOD_TARGET ? (
            <InsightBadge
              type="good"
              text={t('ins.appCrGood', { cr: formatPercent(appConversionRate) })}
            />
          ) : (
            <InsightBadge
              type="warning"
              icon="🔴"
              text={t('ins.appCrLow', { cr: formatPercent(appConversionRate) })}
            />
          )}
          {b2bPaid > 0 ? (
            <InsightBadge type="good" text={t('ins.b2bPaid', { n: formatInt(b2bPaid) })} />
          ) : (
            <InsightBadge type="warning" icon="🔴" text={t('ins.b2bZero')} />
          )}
          {b2bDealsCount > 0 ? (
            <InsightBadge type="info" text={t('ins.b2bDeals', { n: b2bDealsCount })} />
          ) : (
            <InsightBadge type="warning" icon="🔴" text={t('ins.b2bNoDeals')} />
          )}
        </div>
      </div>

      {/* Funnel chart */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-lg font-semibold">{t('an.fn.conversionFunnel')}</h3>
        {hasFunnelData(stages) ? (
          <>
            <EChart option={funnelOption(stages, t('an.fn.funnel.prevShort'))} />
            {/* Text mirror of the funnel: every stage with its absolute and % of the previous
                one, readable without the canvas (screen readers, copy-paste). */}
            <ol
              className="mt-3 space-y-1 text-sm text-slate-600"
              aria-label={t('an.fn.funnel.stageList')}
            >
              {stages.map((s, i) => (
                <li key={s.key} className="flex items-center justify-between gap-2">
                  <span>{s.label}</span>
                  <span className="font-medium">
                    {formatInt(s.value)}
                    {i > 0 && (
                      <span className="ml-1 font-normal text-slate-500">
                        · {formatPercent(s.fromPrev)} {t('an.fn.funnel.prevShort')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <EmptyState />
        )}
        <ChartCaption
          correct={t('cap.fn.funnel.correct')}
          caveat={t('cap.fn.funnel.caveat')}
          advice={t('cap.fn.funnel.advice')}
        />
      </div>

      {/* Loss analysis */}
      <FunnelLossAnalysis
        visits={visits}
        reaches={reaches}
        b2bTickets={b2bTickets}
        b2bPaid={b2bPaid}
      />

      {/* Channel conversion chart */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <EChart option={channelCrOption(stats, t, locale)} />
        <ChartCaption
          correct={t('cap.fn.cr.correct')}
          caveat={t('cap.fn.cr.caveat')}
          advice={t('cap.fn.cr.advice')}
        />
      </div>

      {/* Funnel by channel: visits vs applications */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-lg font-semibold">{t('an.fn.byChannel')}</h3>
        <EChart
          option={localizeChart(
            funnelByChannelOption(stats, {
              visits: t('an.col.visits'),
              reaches: t('an.col.applications'),
            }),
            {
              series: [t('an.col.visits'), t('an.col.applications')],
              category: (c) => channelName(c, locale),
            },
          )}
        />
        <ChartCaption
          correct={t('cap.fn.byCh.correct')}
          caveat={t('cap.fn.byCh.caveat')}
          advice={t('cap.fn.byCh.advice')}
        />
      </div>

      {/* Geo breakdown */}
      {geoRows.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-lg font-semibold">{t('an.fn.geo')}</h3>
          <EChart option={audienceBarOption(geoRows, t('an.fn.geoChart'))} />
          <ChartCaption
            correct={t('cap.fn.geo.correct')}
            caveat={t('cap.fn.geo.caveat')}
            advice={t('cap.fn.geo.advice')}
          />
        </div>
      )}

      {/* B2B deals by stage */}
      {dealsByStage.size > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('an.fn.stages')}</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                { stage: 'lead', label: 'kpi.whatif.b2b.stageLead', color: 'bg-slate-100' },
                {
                  stage: 'negotiation',
                  label: 'kpi.whatif.b2b.stageNegotiation',
                  color: 'bg-amber-100',
                },
                { stage: 'invoiced', label: 'an.fn.stageInvoiced', color: 'bg-blue-100' },
                { stage: 'paid', label: 'kpi.whatif.b2b.stagePaid', color: 'bg-green-100' },
              ] satisfies Array<{ stage: string; label: DictKey; color: string }>
            ).map(({ stage, label, color }) => {
              const data = dealsByStage.get(stage);
              return (
                <div key={stage} className={`rounded-lg p-3 ${color}`}>
                  <div className="text-xs text-slate-500">{t(label)}</div>
                  <div className="text-lg font-bold">
                    {data ? t('an.ticketsN', { n: formatInt(data.tickets) }) : '0'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {t('an.dealsN', { n: data ? data.count : 0 })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Page insights */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('an.fn.problemPages')}</h3>
        <div className="space-y-2 text-sm text-slate-600">
          {highBouncePages.length > 0 ? (
            <div>
              <p className="font-medium text-red-700">{t('an.fn.highBounce')}</p>
              <ul className="mt-1 list-inside list-disc">
                {highBouncePages.slice(0, 5).map((p, i) => (
                  <li key={`${p.page}-${i}`}>
                    {t('an.fn.pageLine', {
                      page: p.page,
                      pct: formatPercent(p.bounceRate),
                      visits: formatInt(p.visits),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-green-700">{`✅ ${t('an.fn.noHighBounce')}`}</p>
          )}
          {lowCrPages.length > 0 && (
            <div>
              <p className="mt-2 font-medium text-amber-700">{t('an.fn.lowCr')}</p>
              <ul className="mt-1 list-inside list-disc">
                {lowCrPages.slice(0, 5).map((p, i) => (
                  <li key={`${p.page}-${i}`}>
                    {t('an.fn.pageLine', {
                      page: p.page,
                      pct: formatPercent(p.conversionRate),
                      visits: formatInt(p.visits),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Recommendations */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('an.recommendations')}</h3>
        <ul className="space-y-2 text-sm text-slate-600">
          {appConversionRate < CR_CRITICAL_TARGET && (
            <li className="flex items-start gap-2">
              <span className="text-red-500">🔴</span>
              <span>
                <b>{t('an.rec.crCritical', { cr: formatPercent(appConversionRate) })}</b>{' '}
                {t('an.rec.crCriticalBody')}
              </span>
            </li>
          )}
          {b2bPaid === 0 && (
            <li className="flex items-start gap-2">
              <span className="text-red-500">🔴</span>
              <span>
                <b>{t('an.rec.b2bZero')}</b> {t('an.fn.rec.b2bZeroBody')}
              </span>
            </li>
          )}
          {highBouncePages.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="text-amber-500">🟡</span>
              <span>
                <b>{t('an.fn.rec.bounce', { n: highBouncePages.length })}</b>{' '}
                {t('an.rec.bounceBody')}
              </span>
            </li>
          )}
          {appConversionRate >= CR_GOOD_TARGET && (
            <li className="flex items-start gap-2">
              <span className="text-green-500">🟢</span>
              <span>
                <b>{t('an.rec.crGood', { cr: formatPercent(appConversionRate) })}</b>{' '}
                {t('an.rec.crGoodBody')}
              </span>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

/** Data wrapper. */
export function Funnel(): JSX.Element {
  const { from, to } = useFilters();
  const channelsQ = useQuery({
    queryKey: ['channels', from, to],
    queryFn: () => api.channels({ from, to }),
  });
  const dealsQ = useQuery({ queryKey: ['b2b'], queryFn: api.b2b });
  const geoQ = useQuery({
    queryKey: ['geo-device', from, to],
    queryFn: () => api.geoDevice({ from, to }),
  });
  const pagesQ = useQuery({
    queryKey: ['pages', from, to],
    queryFn: () => api.pages({ from, to }),
  });
  // ANA-21: the per-issue stages (reg_open → cart_open → reg_step1 → Оплата) come from the live
  // pc-goals funnel; a failure (no token, quota) degrades softly to the cached SQLite totals.
  const liveQ = useQuery({
    queryKey: ['live-funnel', from, to],
    queryFn: () => v3.liveFunnel({ from, to }),
    retry: false,
    staleTime: 60_000,
  });

  const status = combineStatus(channelsQ.status, dealsQ.status, geoQ.status, pagesQ.status);

  return (
    <div className="space-y-6">
      <FunnelView
        status={status}
        stats={channelsQ.data ?? []}
        deals={dealsQ.data ?? []}
        geoDevice={geoQ.data ?? []}
        pages={pagesQ.data ?? []}
        live={liveQ.data ?? null}
      />
      {/* ANA-19: manual B2C payments — the confirmed-money input lives next to the B2B pipeline.
          These rows feed the "Paid" figure (= B2C paid + B2B paid) in the Overview KPI strip. */}
      <B2cPaymentsCard />
    </div>
  );
}
