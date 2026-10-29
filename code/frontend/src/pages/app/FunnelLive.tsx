import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { v3 } from '../../lib/api-v3';
import { useT, fmtNum } from '../../i18n';
import { Card, ErrorBox, PageHeader, Skeleton } from '../../components/ui';
import { EChart } from '../../components/charts/EChart';
import { LiveBar, NotConfigured, isNotConfigured, useLiveParams } from './live-common';

/** pc-goals participant funnel: stages, ticket tariffs and role applications. */
export function FunnelLive(): JSX.Element {
  const { t, locale } = useT();
  const p = useLiveParams();
  const q = useQuery({
    queryKey: ['live', 'funnel', p.from, p.to, p.test],
    queryFn: () => v3.liveFunnel(p),
    refetchInterval: p.refetchInterval,
  });
  if (q.error && isNotConfigured(q.error)) return <NotConfigured />;
  const d = q.data;
  const max = d ? Math.max(1, ...d.stages.map((s) => s.value)) : 1;

  const tickets = d && {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 40, right: 16, top: 32, bottom: 28 },
    xAxis: { type: 'category', data: d.tickets.map((x) => t(`funnel.ticket.${x.type}`)) },
    yAxis: { type: 'value' },
    series: [
      {
        name: t('funnel.pick'),
        type: 'bar',
        data: d.tickets.map((x) => x.pick),
        itemStyle: { color: '#5a5a5a', borderRadius: [4, 4, 0, 0] },
      },
      {
        name: t('funnel.buy'),
        type: 'bar',
        data: d.tickets.map((x) => x.buy),
        itemStyle: { color: '#ff9e7b', borderRadius: [4, 4, 0, 0] },
      },
      {
        name: t('funnel.checkout'),
        type: 'bar',
        data: d.tickets.map((x) => x.checkout),
        itemStyle: { color: '#FF4D14', borderRadius: [4, 4, 0, 0] },
      },
    ],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="pc-goals"
        title={t('funnel.title')}
        subtitle={t('funnel.subtitle')}
        actions={
          <LiveBar
            updatedAt={d?.updatedAt}
            onRefresh={() => void q.refetch()}
            fetching={q.isFetching}
          />
        }
      />
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      <Card title={t('funnel.title')} hint={t('funnel.note')}>
        {!d ? (
          <Skeleton className="h-80" />
        ) : (
          <ol className="space-y-2">
            {d.stages.map((s, i) => {
              const w = Math.max(4, (s.value / max) * 100);
              const body = (
                <div className="group">
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">
                      {i + 1}. {locale === 'ru' ? s.ru : s.en}
                    </span>
                    <span className="tabular-nums">
                      <b className="text-lg">{fmtNum(s.value, locale)}</b>
                      {s.fromPrevious !== null && (
                        <span className="ml-2 text-xs text-muted">
                          {fmtNum(s.fromPrevious * 100, locale, 1)}% {t('funnel.fromPrev')} ·{' '}
                          {fmtNum((s.fromFirst ?? 0) * 100, locale, 2)}% {t('funnel.fromFirst')}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-8 overflow-hidden rounded-md bg-raised">
                    <div
                      className="h-full rounded-md bg-gradient-to-r from-accent to-accent/60 transition-[width] duration-700 ease-out group-hover:brightness-110"
                      style={{ width: `${w}%` }}
                    />
                  </div>
                </div>
              );
              return (
                <li key={s.key}>
                  {s.goalId ? <Link to={`/app/goals/${s.goalId}`}>{body}</Link> : body}
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-4 text-xs text-muted">{t('funnel.note')}</p>
        {d && d.missing.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">
            {t('funnel.missing', { list: d.missing.join(', ') })}
          </p>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('funnel.tickets')}>
          {tickets ? <EChart option={tickets} height={280} /> : <Skeleton className="h-64" />}
        </Card>
        <Card title={t('funnel.roles')}>
          {!d ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="space-y-4">
              {d.roleFunnels.map((f) => {
                const stepMax = Math.max(1, ...f.steps.map((s) => s.value));
                return (
                  <div key={f.key} className="rounded-lg border border-line p-4">
                    <div className="text-xs uppercase tracking-wide text-muted">
                      {locale === 'ru' ? f.ru : f.en}
                    </div>
                    <ol className="mt-2 space-y-1.5">
                      {f.steps.map((st, i) => (
                        <li key={`${f.key}-${st.key}`}>
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium">
                              {i + 1}. {locale === 'ru' ? st.ru : st.en}
                              {/* REG-06: a step without a goal in the counter has no data of its
                                  own — warn instead of showing a silent 0 in the chain. */}
                              {st.goalId === null && (
                                <span className="ml-2 text-xs text-amber-700">
                                  {t('funnel.noGoal')}
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums">
                              <b className="text-lg">{fmtNum(st.value, locale)}</b>
                              {st.fromPrevious !== null && st.fromPrevious <= 1 && (
                                <span className="ml-2 text-xs text-muted">
                                  {fmtNum(st.fromPrevious * 100, locale, 1)}% {t('funnel.fromPrev')}
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="h-6 overflow-hidden rounded-md bg-raised">
                            <div
                              className="h-full rounded-md bg-gradient-to-r from-accent to-accent/60 transition-[width] duration-700 ease-out"
                              style={{ width: `${Math.max(4, (st.value / stepMax) * 100)}%` }}
                            />
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
