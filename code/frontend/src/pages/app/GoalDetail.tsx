import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { v3, type BreakdownRow } from '../../lib/api-v3';
import { useT, channelName } from '../../i18n';
import { DataGrid, type GridColumn } from '../../components/DataGrid';
import { Card, ErrorBox, Kpi, PageHeader, Skeleton } from '../../components/ui';
import { EChart } from '../../components/charts/EChart';
import { LiveBar, NotConfigured, isNotConfigured, useLiveParams } from './live-common';

/** One goal in depth: time series and breakdowns by source, UTM, entry page, device, country. */
export function GoalDetail(): JSX.Element {
  const { id } = useParams();
  const { t, locale } = useT();
  const p = useLiveParams();
  const q = useQuery({
    queryKey: ['live', 'goal', id, p.from, p.to, p.test],
    queryFn: () => v3.liveGoal(Number(id), p),
    refetchInterval: p.refetchInterval,
  });
  if (q.error && isNotConfigured(q.error)) return <NotConfigured />;
  const d = q.data;

  const cols = (head: string, mapKey?: (k: string) => string): GridColumn<BreakdownRow>[] => [
    { id: 'key', header: head, accessor: (r) => (mapKey ? mapKey(r.key) : r.key), minWidth: 200 },
    {
      id: 'visits',
      header: t('live.visits'),
      kind: 'int',
      accessor: (r) => r.visits,
      total: 'sum',
    },
    {
      id: 'reaches',
      header: t('goals.col.reaches'),
      kind: 'int',
      accessor: (r) => r.reaches,
      total: 'sum',
    },
    { id: 'cr', header: t('goals.col.cr'), kind: 'pct', accessor: (r) => r.conversionRate },
  ];

  const series = d && {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 40, right: 40, top: 32, bottom: 28 },
    xAxis: { type: 'category', data: d.series.map((x) => x.bucket) },
    yAxis: [{ type: 'value' }, { type: 'value', splitLine: { show: false } }],
    series: [
      {
        name: t('goals.col.reaches'),
        type: 'bar',
        data: d.series.map((x) => x.reaches),
        itemStyle: { color: '#FF4D14', borderRadius: [4, 4, 0, 0] },
      },
      {
        name: t('live.visits'),
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        data: d.series.map((x) => x.visits),
      },
    ],
  };

  return (
    <div className="space-y-6">
      <Link to="/app/goals" className="text-sm text-muted hover:text-accent">
        {t('goals.detail.back')}
      </Link>
      <PageHeader
        eyebrow={`#${id}${d?.goal.event ? ` · ${d.goal.event}` : ''}`}
        title={d?.goal.name ?? '…'}
        actions={
          <LiveBar
            updatedAt={d?.updatedAt}
            onRefresh={() => void q.refetch()}
            fetching={q.isFetching}
          />
        }
      />
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {d ? (
          <>
            <Kpi label={t('goals.col.reaches')} value={d.totals.reaches} accent />
            <Kpi label={t('live.visits')} value={d.totals.visits} />
            <Kpi label={t('goals.col.cr')} value={d.totals.conversionRate} digits={2} suffix="%" />
          </>
        ) : (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24" />)
        )}
      </div>
      <Card title={t('goals.detail.series')}>
        {series ? <EChart option={series} height={300} /> : <Skeleton className="h-72" />}
      </Card>
      {d && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={t('goals.detail.bySource')}>
            <DataGrid
              dense
              columns={cols(t('goals.detail.bySource'), (k) => channelName(k, locale))}
              rows={d.bySource}
              fileName={`goal_${id}_sources`}
              pageSize={10}
            />
          </Card>
          <Card title={t('goals.detail.byUtm')}>
            <DataGrid
              dense
              columns={cols('utm_source')}
              rows={d.byUtm}
              fileName={`goal_${id}_utm`}
              pageSize={10}
            />
          </Card>
          <Card title={t('goals.detail.byPage')}>
            <DataGrid
              dense
              columns={cols(t('goals.detail.byPage'))}
              rows={d.byPage}
              fileName={`goal_${id}_pages`}
              pageSize={10}
            />
          </Card>
          <Card title={t('goals.detail.byDevice')}>
            <DataGrid
              dense
              columns={cols(t('goals.detail.byDevice'))}
              rows={d.byDevice}
              fileName={`goal_${id}_devices`}
              pageSize={10}
            />
          </Card>
          <Card title={t('goals.detail.byCountry')} className="xl:col-span-2">
            <DataGrid
              dense
              columns={cols(t('goals.detail.byCountry'))}
              rows={d.byCountry}
              fileName={`goal_${id}_countries`}
              pageSize={10}
            />
          </Card>
          {d.goal.conditions.length > 0 && (
            <Card title={t('goals.detail.conditions')} className="xl:col-span-2">
              <ul className="space-y-1 text-sm">
                {d.goal.conditions.map((c, i) => (
                  <li key={i}>
                    <code className="rounded bg-raised px-1.5 py-0.5 text-xs">{c.type}</code>{' '}
                    {c.url}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
