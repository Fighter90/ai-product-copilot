import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { B2bDeal, ChannelStat, GoalLabel } from '@pca/shared';
import { paidAndGap, periodTotals, formatGoalLabel, readEventDate } from '@pca/shared';
import { api } from '../lib/api';
import { useFilters } from '../store/filters';
import { formatInt, formatPercent } from '../lib/format';
import { dailySeries, type DailyPoint } from '../lib/trends';
import { forecastGoal, forecastChartOption } from '../lib/forecast';
import { pipelineSummary } from '../lib/b2b';
import { useKpiTarget } from '../lib/kpi-target';
import { Card } from '../components/ui';
import { EChart } from '../components/charts/EChart';
import { useT, fmtDate, fmtNum, type DictKey } from '../i18n';

type QueryStatus = 'pending' | 'error' | 'success';

/** Progress ring showing goal completion */
function GoalRing({
  progress,
  target,
  current,
}: {
  progress: number;
  target: number;
  current: number;
}): JSX.Element {
  const { t } = useT();
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (progress / 100) * circumference;
  const color = progress >= 100 ? '#22c55e' : progress >= 50 ? '#f59e0b' : '#ef4444';
  // Darker shades for the text label so it meets WCAG AA contrast (the ring is a graphic, exempt).
  const textColor = progress >= 100 ? '#15803d' : progress >= 50 ? '#b45309' : '#b91c1c';

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="140" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          className="transition-all duration-500"
        />
        <text x="50" y="42" textAnchor="middle" className="fill-slate-800 text-lg font-bold">
          {formatInt(current)}
        </text>
        <text x="50" y="58" textAnchor="middle" className="fill-slate-500 text-[3px]">
          {t('an.kpi.ofTarget', { n: formatInt(target) })}
        </text>
      </svg>
      <span className="mt-2 text-sm font-medium" style={{ color: textColor }}>
        {t('an.kpi.achieved', { pct: progress.toFixed(1) })}
      </span>
    </div>
  );
}

/** Calculate total paid B2B tickets from deals */
function calcB2bPaid(deals: B2bDeal[]): number {
  return deals.filter((d) => d.stage === 'paid').reduce((sum, d) => sum + d.tickets, 0);
}

/** Calculate total B2B pipeline tickets (not yet paid) */
function calcB2bPipeline(deals: B2bDeal[]): number {
  return deals.filter((d) => d.stage !== 'paid').reduce((sum, d) => sum + d.tickets, 0);
}

/** Localised label for a B2B pipeline stage. */
function stageKey(stage: B2bDeal['stage']): DictKey {
  return `kpi.whatif.b2b.stage${stage.charAt(0).toUpperCase()}${stage.slice(1)}` as DictKey;
}

/**
 * «Что если» (ANA-50) — pace forecast + scenario card for /app/kpi. Thin UI: all math lives in
 * lib/forecast. Tab 1 «Прогноз»: linear pace from daily goal reaches → goal-achievement date vs
 * the 2×-window deadline, two levers (traffic ±%, CR +п.п.) recompute it live, EChart shows the
 * cumulative fact + dashed scenario forecast + the target line. Tab 2 «B2B»: pipeline by stage and
 * the money summary (amount_rub does not convert to tickets — shown as a separate summary table).
 */
function WhatIfForecast({
  points,
  to,
  target,
  deals,
  eventDate,
}: {
  points: DailyPoint[];
  to: string;
  target: number;
  deals: B2bDeal[];
  /** ANA-75 (БАГ-01): admin EVENT_DATE — the deadline; empty → the «+2× window» heuristic. */
  eventDate?: string;
}): JSX.Element {
  const { t, locale } = useT();
  const [trafficPct, setTrafficPct] = useState(0);
  const [crUpliftPp, setCrUpliftPp] = useState(0);
  const [tab, setTab] = useState<'forecast' | 'b2b'>('forecast');

  // Client-side, on the fly: pure math, no refetch. deadlineDate (EVENT_DATE) wins when set.
  const fc = useMemo(
    () => forecastGoal({ points, to, target, trafficPct, crUpliftPp, deadlineDate: eventDate }),
    [points, to, target, trafficPct, crUpliftPp, eventDate],
  );
  const summary = useMemo(() => pipelineSummary(deals), [deals]);

  const scenarioDateLabel = fc.scenarioDate
    ? fmtDate(fc.scenarioDate, locale)
    : fc.reached
      ? t('kpi.whatif.reached')
      : t('kpi.whatif.unreachable');
  // deviationDays: negative = ahead of the deadline (запас), positive = behind it (отставание).
  const deviation =
    fc.deviationDays === null ? (
      <span className="text-xl font-bold text-slate-400">—</span>
    ) : fc.deviationDays < 0 ? (
      <span className="text-xl font-bold text-green-700">
        {t('kpi.whatif.deviationAhead', { n: Math.abs(fc.deviationDays) })}
      </span>
    ) : fc.deviationDays === 0 ? (
      <span className="text-xl font-bold text-amber-700">{t('kpi.whatif.onTime')}</span>
    ) : (
      <span className="text-xl font-bold text-red-700">
        {t('kpi.whatif.deviationBehind', { n: fc.deviationDays })}
      </span>
    );

  const amounts = deals.filter((d) => (d.amountRub ?? 0) > 0);
  const amountSum = amounts.reduce((acc, d) => acc + (d.amountRub ?? 0), 0);

  const tabBtn = (id: 'forecast' | 'b2b', label: string): JSX.Element => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        tab === id
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Card title={t('kpi.whatif.title')} hint={t('kpi.whatif.hint')}>
      <div role="tablist" aria-label={t('kpi.whatif.title')} className="mb-4 flex gap-2">
        {tabBtn('forecast', t('kpi.whatif.tabForecast'))}
        {tabBtn('b2b', t('kpi.whatif.tabB2b'))}
      </div>

      {tab === 'forecast' ? (
        <div role="tabpanel" aria-label={t('kpi.whatif.tabForecast')}>
          {/* Forecast numbers: scenario pace, goal date, deviation vs the deadline */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded bg-slate-50 px-3 py-2 text-center">
              <div className="text-xs text-slate-500">{t('kpi.whatif.paceNow')}</div>
              <div className="text-xl font-bold">
                {fmtNum(fc.scenarioPace, locale, 1)}{' '}
                <span className="text-xs font-normal text-slate-500">{t('kpi.whatif.perDay')}</span>
              </div>
            </div>
            <div className="rounded bg-slate-50 px-3 py-2 text-center">
              <div className="text-xs text-slate-500">{t('kpi.whatif.forecastDate')}</div>
              <div className="text-xl font-bold">{scenarioDateLabel}</div>
            </div>
            <div className="rounded bg-slate-50 px-3 py-2 text-center">
              <div className="text-xs text-slate-500">
                {t('kpi.whatif.deviationLabel', { date: fmtDate(fc.horizonDate, locale) })}
              </div>
              {deviation}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t('kpi.whatif.baselineCaption', {
              pace: fmtNum(fc.pace, locale, 1),
              date: fc.baselineDate
                ? fmtDate(fc.baselineDate, locale)
                : t('kpi.whatif.unreachable'),
            })}
            {' · '}
            {t('kpi.whatif.recentPace', { pace: fmtNum(fc.recentPace, locale, 1) })}
            {' · '}
            {t('kpi.whatif.onDeadline', { n: fmtNum(fc.projectedAtHorizon, locale, 0) })}
            {fc.requiredPace !== null && (
              <>
                {' · '}
                {t('kpi.whatif.requiredPace', {
                  pace: fmtNum(fc.requiredPace, locale, 1),
                  date: fmtDate(fc.horizonDate, locale),
                })}
              </>
            )}
          </p>

          {/* Scenario sliders: traffic ±% and CR +п.п., recomputed live */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-600">{t('kpi.whatif.traffic', { pct: trafficPct })}</span>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={trafficPct}
                onChange={(e) => setTrafficPct(Number(e.target.value))}
                className="mt-1 w-full"
                aria-label={t('kpi.whatif.trafficAria')}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">{t('kpi.whatif.cr', { pp: crUpliftPp })}</span>
              <input
                type="range"
                min={0}
                max={5}
                step={0.5}
                value={crUpliftPp}
                onChange={(e) => setCrUpliftPp(Number(e.target.value))}
                className="mt-1 w-full"
                aria-label={t('kpi.whatif.crAria')}
              />
            </label>
          </div>

          {/* Cumulative fact + dashed scenario forecast + target line */}
          <div className="mt-4">
            <EChart
              height={280}
              option={forecastChartOption({
                points,
                to,
                target,
                totalNow: fc.totalNow,
                scenarioPace: fc.scenarioPace,
                scenarioDays: fc.scenarioDays,
                horizonDays: fc.horizonDays,
                labels: {
                  fact: t('kpi.whatif.chartFact'),
                  forecast: t('kpi.whatif.chartForecast'),
                  target: t('kpi.whatif.chartTarget', { n: formatInt(target) }),
                },
              })}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {eventDate
              ? t('kpi.whatif.disclaimerEventDate', { date: fmtDate(eventDate, locale) })
              : t('kpi.whatif.disclaimer')}
          </p>
        </div>
      ) : (
        <div role="tabpanel" aria-label={t('kpi.whatif.tabB2b')}>
          {/* Pipeline by stage (tickets) */}
          <h4 className="mb-2 text-sm font-semibold text-slate-700">
            {t('kpi.whatif.b2b.byStage')}
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {summary.byStage.map((s) => (
              <div key={s.stage} className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">
                  {t(stageKey(s.stage) as never)}
                </div>
                <div className="text-lg font-bold">{formatInt(s.tickets)}</div>
                <div className="text-xs text-slate-500">{s.deals}</div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-sm text-slate-600">
            {t('kpi.whatif.b2b.contribution', {
              paid: formatInt(summary.paidTickets),
              target: formatInt(target),
              pct: target > 0 ? ((summary.paidTickets / target) * 100).toFixed(1) : '0',
            })}
          </p>

          {/* Money summary — amount_rub does not convert to tickets, reported separately */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-500">
                  <th className="px-3 py-2">{t('kpi.whatif.b2b.dealsCount')}</th>
                  <th className="px-3 py-2">{t('kpi.whatif.b2b.amount')}</th>
                  <th className="px-3 py-2">{t('kpi.whatif.b2b.avgTicket')}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-bold">{formatInt(deals.length)}</td>
                  <td className="px-3 py-2 font-bold">
                    {amounts.length > 0 ? `${formatInt(amountSum)} ₽` : '—'}
                  </td>
                  <td className="px-3 py-2 font-bold">
                    {amounts.length > 0
                      ? `${formatInt(amountSum / amounts.length)} ₽`
                      : t('kpi.whatif.b2b.noAmounts')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Pure presentational Goals view. */
export function GoalsView({
  status,
  target,
  b2cApplications,
  b2bPaid,
  b2bPipeline,
  totalVisits,
  overallCR,
  deals,
  goalLabel,
  points,
  to,
  b2cPaid = 0,
  eventDate,
}: {
  status: QueryStatus;
  target: number;
  b2cApplications: number;
  b2bPaid: number;
  b2bPipeline: number;
  totalVisits: number;
  overallCR: number;
  deals: B2bDeal[];
  goalLabel?: GoalLabel;
  /** Daily fact (visits + goal reaches) — feeds the «Что если» pace forecast. */
  points: DailyPoint[];
  /** Selected period end (ISO date) — the forecast anchor. */
  to: string;
  /** ANA-75: manually entered / CSV-imported paid B2C tickets for the period (payments summary). */
  b2cPaid?: number;
  /** ANA-75 (БАГ-01): admin EVENT_DATE — the KPI deadline; empty → the heuristic disclaimer. */
  eventDate?: string;
}): JSX.Element {
  const { t } = useT();
  if (status === 'pending') return <p className="text-slate-500">{t('common.loading')}</p>;
  if (status === 'error')
    return (
      <p role="alert" className="text-red-700">
        {t('an.kpi.error')}
      </p>
    );

  // REG-03 (ANA-92), инвариант «заявка ≠ оплата»: единый расчёт «Оплачено/Осталось» через shared
  // paidAndGap — тот же, что на Обзоре и в снапшоте отчёта. В оплату входят ТОЛЬКО подтверждённые
  // деньги: B2C-платежи + B2B-paid. Заказы Метрики (b2cApplications) показываются отдельной
  // метрикой «заявки/заказы» и в оплату не входят, какой бы ни был тип цели.
  const { paid: current, gap: remaining } = paidAndGap({
    target,
    b2cPaidTickets: b2cPaid,
    b2bPaidTickets: b2bPaid,
  });
  const progress = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  // formatGoalLabel (shared) titles the goal in Russian — localise by its isPaid flag instead.
  const goalTitle = goalLabel?.isPaid ? t('an.kpi.orders') : t('an.fn.b2cAppsCount');
  const stageLabel = (stage: B2bDeal['stage']): string => t(stageKey(stage));

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">{t('an.kpi.title')}</h2>

      {/* Main goal ring */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-center">
          <GoalRing progress={progress} target={target} current={current} />
          <div className="space-y-2 text-center lg:text-left">
            <h3 className="text-lg font-semibold">
              {t('an.kpi.mainGoal', { n: formatInt(target) })}
            </h3>
            <div className="space-y-1 text-sm text-slate-600">
              <p>
                {t('an.kpi.remaining')}{' '}
                <span className="font-bold text-red-700">{formatInt(remaining)}</span>{' '}
                {t('an.kpi.tickets')}
              </p>
              <div className="rounded bg-slate-50 px-3 py-2">
                <p className="font-medium">
                  {t('an.kpi.metrikaCount', { title: goalTitle, n: formatInt(b2cApplications) })}
                </p>
                <p className="text-xs text-slate-500">
                  {goalLabel?.showApplicationsCaveat === false
                    ? t('an.kpi.paidNote')
                    : t('an.kpi.appsNote')}
                </p>
              </div>
              <div className="rounded bg-slate-50 px-3 py-2">
                <p className="font-medium">
                  {t('an.kpi.b2bPaid')} <span className="text-green-700">{formatInt(b2bPaid)}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {t('an.kpi.inPipeline', { n: formatInt(b2bPipeline), deals: deals.length })}
                </p>
              </div>
            </div>
            {progress >= 100 ? (
              <div className="rounded bg-green-100 px-3 py-2 text-sm text-green-800">
                {`✅ ${t('an.kpi.reached')}`}
              </div>
            ) : progress >= 50 ? (
              <div className="rounded bg-amber-100 px-3 py-2 text-sm text-amber-800">
                {`⚠️ ${t('an.kpi.halfway')}`}
              </div>
            ) : (
              <div className="rounded bg-red-100 px-3 py-2 text-sm text-red-800">
                {`🔴 ${t('an.kpi.speedUp')}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Funnel metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.visitsCount')}</div>
          <div className="text-2xl font-bold">{formatInt(totalVisits)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.kpi.overallCr')}</div>
          <div
            className={`text-2xl font-bold ${overallCR > 0.02 ? 'text-green-700' : overallCR > 0.01 ? 'text-amber-700' : 'text-red-700'}`}
          >
            {formatPercent(overallCR)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.kpi.b2bDeals')}</div>
          <div className="text-2xl font-bold">{deals.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">{t('an.kpi.progress')}</div>
          <div
            className={`text-2xl font-bold ${progress >= 50 ? 'text-amber-700' : 'text-red-700'}`}
          >
            {progress.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* B2B deals table */}
      {deals.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('an.kpi.dealsTitle')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-500">
                  <th className="px-3 py-2">{t('an.col.company')}</th>
                  <th className="px-3 py-2">{t('an.col.tickets')}</th>
                  <th className="px-3 py-2">{t('an.col.stage')}</th>
                  <th className="px-3 py-2">{t('an.col.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => {
                  const stageColor =
                    d.stage === 'paid'
                      ? 'text-green-700'
                      : d.stage === 'invoiced'
                        ? 'text-blue-600'
                        : d.stage === 'negotiation'
                          ? 'text-amber-700'
                          : 'text-slate-500';
                  return (
                    <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">{d.company}</td>
                      <td className="px-3 py-2">{formatInt(d.tickets)}</td>
                      <td className={`px-3 py-2 font-medium ${stageColor}`}>
                        {stageLabel(d.stage)}
                      </td>
                      <td className="px-3 py-2">
                        {d.amountRub ? `${formatInt(d.amountRub)} ₽` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Forecast */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-lg font-semibold">{t('an.kpi.forecastTitle')}</h3>
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            {t('an.kpi.forecastNow', {
              cr: formatPercent(overallCR),
              visits: formatInt(totalVisits),
              apps: formatInt(b2cApplications),
            })}
          </p>
          <p>
            {b2bPaid > 0
              ? t('an.kpi.forecastB2b', { n: formatInt(b2bPaid) })
              : t('an.kpi.forecastNoB2b')}
          </p>
          <p>
            {t('an.kpi.needPre', { target: formatInt(target) })}{' '}
            <span className="font-bold text-red-700">{formatInt(remaining)}</span>{' '}
            {t('an.kpi.needPost')}
          </p>
        </div>
      </div>

      {/* «Что если» (ANA-50): pace forecast + scenario sliders + chart, B2B pipeline tab */}
      <WhatIfForecast points={points} to={to} target={target} deals={deals} eventDate={eventDate} />

      {/* Recommendations */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-lg font-semibold">{t('an.kpi.todo')}</h3>
        <ul className="space-y-3 text-sm text-slate-600">
          {b2bPaid === 0 && (
            <li className="flex items-start gap-2">
              <span className="text-red-500">🔴</span>
              <span>
                <b>{t('an.rec.b2bZero')}</b> {t('an.kpi.rec.b2bZeroBody')}
              </span>
            </li>
          )}
          {overallCR < 0.01 && (
            <li className="flex items-start gap-2">
              <span className="text-red-500">🔴</span>
              <span>
                <b>{t('an.rec.crCritical', { cr: formatPercent(overallCR) })}</b>{' '}
                {t('an.rec.crCriticalBody')}
              </span>
            </li>
          )}
          {overallCR >= 0.01 && overallCR < 0.02 && (
            <li className="flex items-start gap-2">
              <span className="text-amber-500">🟡</span>
              <span>
                <b>{t('an.kpi.rec.crBelow', { cr: formatPercent(overallCR) })}</b>{' '}
                {t('an.kpi.rec.crBelowBody')}
              </span>
            </li>
          )}
          {overallCR >= 0.02 && (
            <li className="flex items-start gap-2">
              <span className="text-green-500">🟢</span>
              <span>
                <b>{t('an.rec.crGood', { cr: formatPercent(overallCR) })}</b>{' '}
                {t('an.rec.crGoodBody')}
              </span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <span className="text-blue-500">ℹ️</span>
            <span>
              <b>{t('an.kpi.rec.followUp')}</b> {t('an.kpi.rec.followUpBody')}
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}

/** Data wrapper. */
export function Goals(): JSX.Element {
  const { from, to } = useFilters();
  const channelsQ = useQuery({
    queryKey: ['channels', from, to],
    queryFn: () => api.channels({ from, to }),
  });
  const b2bQ = useQuery({
    queryKey: ['b2b'],
    queryFn: () => api.b2b(),
  });
  const goalQ = useQuery({ queryKey: ['primary-goal'], queryFn: api.primaryGoal, retry: false });
  const kpiTarget = useKpiTarget();
  // ANA-75 (БАГ-02): B2C-платежи (ручной ввод / CSV) входят в «Оплачено» — как на Обзоре.
  const paymentsQ = useQuery({
    queryKey: ['payments-summary', from, to],
    queryFn: () => api.paymentsSummary({ from, to }),
    retry: false,
  });
  // ANA-75 (БАГ-01): админская «Дата события» (EVENT_DATE) — единый дедлайн KPI; '' → эвристика.
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    retry: false,
    staleTime: 60_000,
  });
  const eventDate = readEventDate(settingsQ.data);

  const status: QueryStatus =
    channelsQ.status === 'pending' || b2bQ.status === 'pending'
      ? 'pending'
      : channelsQ.status === 'error' || b2bQ.status === 'error'
        ? 'error'
        : 'success';

  const data: ChannelStat[] = channelsQ.data ?? [];
  const deals: B2bDeal[] = b2bQ.data ?? [];
  // Headline Визиты/Заявки B2C/CR come from the single factsource so this page agrees with
  // Overview and Funnel. The same rows collapse into the daily series for the pace forecast.
  const totals = periodTotals(data);
  const points = useMemo(() => dailySeries(data), [data]);
  const b2bPaid = calcB2bPaid(deals);
  const b2bPipeline = calcB2bPipeline(deals);

  return (
    <GoalsView
      status={status}
      target={kpiTarget}
      b2cApplications={totals.applications}
      b2bPaid={b2bPaid}
      b2bPipeline={b2bPipeline}
      totalVisits={totals.visits}
      overallCR={totals.conversionRate}
      deals={deals}
      goalLabel={formatGoalLabel(goalQ.data)}
      points={points}
      to={to}
      b2cPaid={paymentsQ.data?.b2cPaid ?? 0}
      eventDate={eventDate}
    />
  );
}
