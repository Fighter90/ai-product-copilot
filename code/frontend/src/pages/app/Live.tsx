import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { v3 } from '../../lib/api-v3';
import { useT, fmtNum } from '../../i18n';
import { Card, ErrorBox, Kpi, PageHeader, Skeleton } from '../../components/ui';
import { EChart } from '../../components/charts/EChart';
import { LiveBar, NotConfigured, isNotConfigured, useLiveParams } from './live-common';

/** "Live" — real-time totals and the hourly/daily visit curve, plus top goals and funnel. */
export function Live(): JSX.Element {
  const { t, locale } = useT();
  const p = useLiveParams();
  const summary = useQuery({
    queryKey: ['live', 'summary', p.from, p.to, p.test],
    queryFn: () => v3.liveSummary(p),
    refetchInterval: p.refetchInterval,
  });
  const funnel = useQuery({
    queryKey: ['live', 'funnel', p.from, p.to, p.test],
    queryFn: () => v3.liveFunnel(p),
    refetchInterval: p.refetchInterval,
  });

  if (summary.error && isNotConfigured(summary.error)) return <NotConfigured />;
  const s = summary.data;
  const single = p.from === p.to;
  const option = s && {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: s.series.map((x) => x.bucket), boundaryGap: false },
    yAxis: { type: 'value' },
    series: [
      {
        name: t('live.visits'),
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: s.series.map((x) => x.visits),
        lineStyle: { width: 3, color: '#FF4D14' },
        itemStyle: { color: '#FF4D14' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255,77,20,.35)' },
              { offset: 1, color: 'rgba(255,77,20,0)' },
            ],
          },
        },
      },
      {
        name: t('live.users'),
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: s.series.map((x) => x.users),
      },
    ],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Live"
        title={t('live.title')}
        subtitle={t('live.subtitle')}
        actions={
          <LiveBar
            updatedAt={s?.updatedAt}
            onRefresh={() => void summary.refetch()}
            fetching={summary.isFetching}
          />
        }
      />
      {summary.error && !isNotConfigured(summary.error) && (
        <ErrorBox error={summary.error} onRetry={() => void summary.refetch()} />
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {s ? (
          <>
            <Kpi label={t('live.visits')} value={s.totals.visits} accent />
            <Kpi label={t('live.users')} value={s.totals.users} />
            <Kpi label={t('live.pageviews')} value={s.totals.pageviews} />
            <Kpi label={t('live.bounce')} value={s.totals.bounceRate} digits={1} suffix="%" />
            <Kpi
              label={t('live.duration')}
              value={s.totals.avgDurationSec / 60}
              digits={1}
              suffix={` ${t('an.live.min')}`}
            />
          </>
        ) : (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)
        )}
      </div>
      <Card title={single ? t('live.byHour') : t('live.byDay')}>
        {option ? <EChart option={option} height={300} /> : <Skeleton className="h-72" />}
      </Card>
      <Card
        title={t('funnel.title')}
        actions={
          <Link to="/app/funnel-live" className="text-xs text-accent hover:underline">
            {t('common.open')} →
          </Link>
        }
      >
        {funnel.data ? (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {funnel.data.stages.map((st, i) => (
              <div
                key={st.key}
                className="rounded-lg border border-line p-3"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="truncate text-[11px] uppercase tracking-wide text-muted">
                  {locale === 'ru' ? st.ru : st.en}
                </div>
                <div className="mt-1 text-2xl font-bold">{fmtNum(st.value, locale)}</div>
                {st.fromPrevious !== null && (
                  <div className="text-[11px] text-muted">
                    {fmtNum(st.fromPrevious * 100, locale, 1)}% ↘
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : funnel.error ? (
          <ErrorBox error={funnel.error} />
        ) : (
          <Skeleton className="h-24" />
        )}
      </Card>
    </div>
  );
}
