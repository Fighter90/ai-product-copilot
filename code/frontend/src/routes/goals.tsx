import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { B2bDeal, ChannelStat, GoalLabel } from '@pca/shared';
import { periodTotals, formatGoalLabel } from '@pca/shared';
import { api } from '../lib/api';
import { useFilters } from '../store/filters';
import { formatInt, formatPercent } from '../lib/format';
import { dailySeries, type DailyPoint } from '../lib/trends';
import { forecastGoal, forecastChartOption } from '../lib/forecast';
import { pipelineSummary } from '../lib/b2b';
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
          из {formatInt(target)}
        </text>
      </svg>
      <span className="mt-2 text-sm font-medium" style={{ color: textColor }}>
        {progress.toFixed(1)}% достигнуто
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
}: {
  points: DailyPoint[];
  to: string;
  target: number;
  deals: B2bDeal[];
}): JSX.Element {
  const { t, locale } = useT();
  const [trafficPct, setTrafficPct] = useState(0);
  const [crUpliftPp, setCrUpliftPp] = useState(0);
  const [tab, setTab] = useState<'forecast' | 'b2b'>('forecast');

  // Client-side, on the fly: pure math, no refetch.
  const fc = useMemo(
    () => forecastGoal({ points, to, target, trafficPct, crUpliftPp }),
    [points, to, target, trafficPct, crUpliftPp],
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
            {t('kpi.whatif.onDeadline', { n: fmtNum(fc.projectedAtHorizon, locale, 0) })}
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
                horizonDays: fc.windowDays * 2,
                labels: {
                  fact: t('kpi.whatif.chartFact'),
                  forecast: t('kpi.whatif.chartForecast'),
                  target: t('kpi.whatif.chartTarget', { n: formatInt(target) }),
                },
              })}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">{t('kpi.whatif.disclaimer')}</p>
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
}): JSX.Element {
  if (status === 'pending') return <p className="text-slate-500">Загрузка…</p>;
  if (status === 'error')
    return (
      <p role="alert" className="text-red-700">
        Не удалось загрузить данные о целях.
      </p>
    );

  // Progress counts confirmed payments toward the 300-ticket goal. When the primary Metrika goal
  // is a purchase/payment goal (goalLabel.isPaid), its reaches ARE payments and count too; for a
  // plain application goal we count only B2B paid (заявка ≠ оплата — applications are not payments).
  const metrikaPaid = goalLabel?.isPaid ? b2cApplications : 0;
  const current = b2bPaid + metrikaPaid;
  const progress = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const remaining = Math.max(0, target - current);

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Цели ProductCamp</h2>

      {/* Main goal ring */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-center">
          <GoalRing progress={progress} target={target} current={current} />
          <div className="space-y-2 text-center lg:text-left">
            <h3 className="text-lg font-semibold">
              Главная цель: {formatInt(target)} платных билетов
            </h3>
            <div className="space-y-1 text-sm text-slate-600">
              <p>
                Осталось: <span className="font-bold text-red-700">{formatInt(remaining)}</span>{' '}
                билетов
              </p>
              <div className="rounded bg-slate-50 px-3 py-2">
                <p className="font-medium">
                  {goalLabel?.title ?? 'Заявок B2C'} (Метрика): {formatInt(b2cApplications)}
                </p>
                <p className="text-xs text-slate-500">
                  {goalLabel?.showApplicationsCaveat === false
                    ? 'Достижения цели-покупки из Метрики (это оплаты).'
                    : 'Верхняя оценка потенциала. Это заявки, не оплаты (заявка ≠ оплата); прогресс к цели считается только по подтверждённым оплатам.'}
                </p>
              </div>
              <div className="rounded bg-slate-50 px-3 py-2">
                <p className="font-medium">
                  B2B оплачено: <span className="text-green-700">{formatInt(b2bPaid)}</span>
                </p>
                <p className="text-xs text-slate-500">
                  В воронке: {formatInt(b2bPipeline)} билетов ({deals.length} сделок)
                </p>
              </div>
            </div>
            {progress >= 100 ? (
              <div className="rounded bg-green-100 px-3 py-2 text-sm text-green-800">
                ✅ Цель достигнута!
              </div>
            ) : progress >= 50 ? (
              <div className="rounded bg-amber-100 px-3 py-2 text-sm text-amber-800">
                ⚠️ Более половины пути пройдено, но нужно ускориться
              </div>
            ) : (
              <div className="rounded bg-red-100 px-3 py-2 text-sm text-red-800">
                🔴 Нужно значительно ускорить конверсию
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Funnel metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Визитов</div>
          <div className="text-2xl font-bold">{formatInt(totalVisits)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Общий CR</div>
          <div
            className={`text-2xl font-bold ${overallCR > 0.02 ? 'text-green-700' : overallCR > 0.01 ? 'text-amber-700' : 'text-red-700'}`}
          >
            {formatPercent(overallCR)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">B2B сделок</div>
          <div className="text-2xl font-bold">{deals.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Прогресс</div>
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
          <h3 className="mb-2 text-sm font-semibold text-slate-700">B2B сделки</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-500">
                  <th className="px-3 py-2">Компания</th>
                  <th className="px-3 py-2">Билеты</th>
                  <th className="px-3 py-2">Этап</th>
                  <th className="px-3 py-2">Сумма</th>
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
                  const stageLabel =
                    d.stage === 'paid'
                      ? 'Оплачено'
                      : d.stage === 'invoiced'
                        ? 'Выставлен счёт'
                        : d.stage === 'negotiation'
                          ? 'Переговоры'
                          : 'Лид';
                  return (
                    <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">{d.company}</td>
                      <td className="px-3 py-2">{formatInt(d.tickets)}</td>
                      <td className={`px-3 py-2 font-medium ${stageColor}`}>{stageLabel}</td>
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
        <h3 className="mb-2 text-lg font-semibold">Прогноз достижения цели</h3>
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            При текущем CR {formatPercent(overallCR)} и {formatInt(totalVisits)} визитах получено{' '}
            {formatInt(b2cApplications)} заявок B2C.
          </p>
          <p>
            {b2bPaid > 0
              ? `B2B уже принесло ${formatInt(b2bPaid)} оплаченных билетов.`
              : 'B2B-направление пока не генерирует оплаты — нужно запустить активные продажи.'}
          </p>
          <p>
            Для достижения цели в {formatInt(target)} билетов необходимо ещё{' '}
            <span className="font-bold text-red-700">{formatInt(remaining)}</span> оплат.
          </p>
        </div>
      </div>

      {/* «Что если» (ANA-50): pace forecast + scenario sliders + chart, B2B pipeline tab */}
      <WhatIfForecast points={points} to={to} target={target} deals={deals} />

      {/* Recommendations */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-lg font-semibold">Что нужно сделать</h3>
        <ul className="space-y-3 text-sm text-slate-600">
          {b2bPaid === 0 && (
            <li className="flex items-start gap-2">
              <span className="text-red-500">🔴</span>
              <span>
                <b>B2B = 0 оплат.</b> Запустить активные продажи: составить список 30 целевых
                компаний, отправить персональные офферы, назначить встречи.
              </span>
            </li>
          )}
          {overallCR < 0.01 && (
            <li className="flex items-start gap-2">
              <span className="text-red-500">🔴</span>
              <span>
                <b>CR {formatPercent(overallCR)} — критически низкий.</b> Проверить посадочные
                страницы, упростить форму заявки, добавить социальное доказательство.
              </span>
            </li>
          )}
          {overallCR >= 0.01 && overallCR < 0.02 && (
            <li className="flex items-start gap-2">
              <span className="text-amber-500">🟡</span>
              <span>
                <b>CR {formatPercent(overallCR)} — ниже целевого 2%.</b> A/B-тестировать CTA,
                заголовки, формы на ключевых страницах.
              </span>
            </li>
          )}
          {overallCR >= 0.02 && (
            <li className="flex items-start gap-2">
              <span className="text-green-500">🟢</span>
              <span>
                <b>CR {formatPercent(overallCR)} — хороший уровень.</b> Масштабировать трафик на
                каналы с лучшим CR.
              </span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <span className="text-blue-500">ℹ️</span>
            <span>
              <b>Повышайте конверсию заявка→оплата.</b> Настроить follow-up: авто-письмо в течение 1
              часа, звонок менеджера в течение 24 часов.
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
      target={300}
      b2cApplications={totals.applications}
      b2bPaid={b2bPaid}
      b2bPipeline={b2bPipeline}
      totalVisits={totals.visits}
      overallCR={totals.conversionRate}
      deals={deals}
      goalLabel={formatGoalLabel(goalQ.data)}
      points={points}
      to={to}
    />
  );
}
