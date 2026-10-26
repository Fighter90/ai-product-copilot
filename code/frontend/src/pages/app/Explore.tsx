import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { v3, type LiveTable } from '../../lib/api-v3';
import { useT, channelName, type DictKey } from '../../i18n';
import { DataGrid, type GridColumn, type GridKind } from '../../components/DataGrid';
import { Card, ErrorBox, PageHeader, Skeleton } from '../../components/ui';
import { EChart } from '../../components/charts/EChart';
import { LiveBar, NotConfigured, isNotConfigured, useLiveParams } from './live-common';

const PRESETS: Array<[string, DictKey]> = [
  ['sources', 'explore.sources'],
  ['engines', 'explore.engines'],
  ['utm', 'explore.utm'],
  ['pages', 'explore.pages'],
  ['exits', 'explore.exits'],
  ['devices', 'explore.devices'],
  ['browsers', 'explore.browsers'],
  ['geo', 'explore.geo'],
  ['referers', 'explore.referers'],
  ['days', 'explore.days'],
  ['hours', 'explore.hours'],
];

const METRIC: Record<string, { ru: string; en: string; kind: GridKind; total?: 'sum' | 'avg' }> = {
  'ym:s:visits': { ru: 'Визиты', en: 'Visits', kind: 'int', total: 'sum' },
  'ym:s:users': { ru: 'Посетители', en: 'Users', kind: 'int', total: 'sum' },
  'ym:s:bounceRate': { ru: 'Отказы', en: 'Bounce', kind: 'pct', total: 'avg' },
  'ym:s:pageDepth': { ru: 'Глубина', en: 'Depth', kind: 'float', total: 'avg' },
  'ym:s:avgVisitDurationSeconds': { ru: 'Время, м:с', en: 'Time, m:s', kind: 'sec', total: 'avg' },
};
const DIM: Record<string, { ru: string; en: string }> = {
  'ym:s:lastsignTrafficSource': { ru: 'Источник', en: 'Source' },
  'ym:s:lastsignSearchEngine': { ru: 'Поисковая система', en: 'Search engine' },
  'ym:s:lastsignUTMSource': { ru: 'utm_source', en: 'utm_source' },
  'ym:s:lastsignUTMMedium': { ru: 'utm_medium', en: 'utm_medium' },
  'ym:s:lastsignUTMCampaign': { ru: 'utm_campaign', en: 'utm_campaign' },
  'ym:s:startURLPath': { ru: 'Страница входа', en: 'Entry page' },
  'ym:s:endURLPath': { ru: 'Страница выхода', en: 'Exit page' },
  'ym:s:deviceCategory': { ru: 'Устройство', en: 'Device' },
  'ym:s:operatingSystemRoot': { ru: 'ОС', en: 'OS' },
  'ym:s:browser': { ru: 'Браузер', en: 'Browser' },
  'ym:s:regionCountry': { ru: 'Страна', en: 'Country' },
  'ym:s:regionCity': { ru: 'Город', en: 'City' },
  'ym:s:lastsignReferalSource': { ru: 'Сайт', en: 'Site' },
  'ym:s:date': { ru: 'Дата', en: 'Date' },
  'ym:s:hour': { ru: 'Час', en: 'Hour' },
};

type Row = LiveTable['rows'][number];

/** "Data" — whitelisted Metrika reports as data grids (sort, search, columns, totals, CSV). */
export function Explore(): JSX.Element {
  const { preset = 'sources' } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useT();
  const p = useLiveParams();
  const [goal, setGoal] = useState<number | undefined>(undefined);
  const goals = useQuery({
    queryKey: ['live', 'goals', p.from, p.to, p.test],
    queryFn: () => v3.liveGoals(p),
    staleTime: 300_000,
  });
  const q = useQuery({
    queryKey: ['live', 'table', preset, p.from, p.to, p.test, goal],
    queryFn: () => v3.liveTable(preset, { ...p, goal }),
    refetchInterval: p.refetchInterval,
  });
  if (q.error && isNotConfigured(q.error)) return <NotConfigured />;
  const d = q.data;

  const columns: GridColumn<Row>[] = d
    ? d.columns.map((c, i) => {
        const nd = d.columns.filter((x) => !x.startsWith('ym:s:goal') && !METRIC[x]).length;
        if (i < nd) {
          const label = DIM[c]?.[locale] ?? c;
          return {
            id: `d${i}`,
            header: label,
            minWidth: i === 0 ? 220 : 140,
            accessor: (r: Row) =>
              c === 'ym:s:lastsignTrafficSource'
                ? channelName(r.dims[i] ?? '', locale)
                : (r.dims[i] ?? ''),
          };
        }
        const vi = i - nd;
        const isGoalReaches = /goal\d+reaches/.test(c);
        const isGoalCr = /goal\d+conversionRate/.test(c);
        const m = METRIC[c];
        return {
          id: `m${vi}`,
          header: isGoalReaches
            ? locale === 'ru'
              ? 'Цель: достижения'
              : 'Goal: reaches'
            : isGoalCr
              ? locale === 'ru'
                ? 'Цель: конверсия'
                : 'Goal: conversion'
              : (m?.[locale] ?? c),
          kind: isGoalReaches ? 'int' : isGoalCr ? 'pct' : (m?.kind ?? 'float'),
          total: isGoalReaches ? 'sum' : m?.total,
          accessor: (r: Row) => r.values[vi] ?? 0,
        } satisfies GridColumn<Row>;
      })
    : [];

  const chart =
    d && d.rows.length > 0 && (preset === 'days' || preset === 'hours')
      ? {
          tooltip: { trigger: 'axis' },
          grid: { left: 40, right: 16, top: 16, bottom: 28 },
          xAxis: { type: 'category', data: d.rows.map((r) => r.dims[0]) },
          yAxis: { type: 'value' },
          series: [
            {
              type: 'bar',
              data: d.rows.map((r) => r.values[0]),
              itemStyle: { color: '#FF4D14', borderRadius: [3, 3, 0, 0] },
            },
          ],
        }
      : d && d.rows.length > 0
        ? {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
            xAxis: { type: 'value' },
            yAxis: {
              type: 'category',
              inverse: true,
              data: d.rows.slice(0, 10).map((r) => {
                const k =
                  preset === 'sources' ? channelName(r.dims[0] ?? '', locale) : r.dims.join(' / ');
                return k.length > 38 ? `${k.slice(0, 36)}…` : k;
              }),
            },
            series: [
              {
                type: 'bar',
                data: d.rows.slice(0, 10).map((r) => r.values[0]),
                itemStyle: { color: '#FF4D14', borderRadius: [0, 3, 3, 0] },
              },
            ],
          }
        : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting API"
        title={t('explore.title')}
        subtitle={t('explore.subtitle')}
        actions={
          <LiveBar
            updatedAt={d?.updatedAt}
            onRefresh={() => void q.refetch()}
            fetching={q.isFetching}
          />
        }
      />
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {PRESETS.map(([id, key]) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(`/app/explore/${id}`)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
              id === preset
                ? 'border-accent bg-accent text-onaccent'
                : 'border-line text-muted hover:text-ink'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      <Card>
        {chart ? (
          <EChart option={chart} height={preset === 'days' || preset === 'hours' ? 260 : 320} />
        ) : (
          <Skeleton className="h-64" />
        )}
      </Card>
      <Card>
        {!d ? (
          <Skeleton className="h-96" />
        ) : (
          <DataGrid
            columns={columns}
            rows={d.rows}
            fileName={`${preset}_${p.from}_${p.to}`}
            toolbar={
              <select
                aria-label={t('explore.goalColumn')}
                value={goal ?? ''}
                onChange={(e) => setGoal(e.target.value ? Number(e.target.value) : undefined)}
                className="input w-auto max-w-[260px]"
              >
                <option value="">{t('explore.goalColumn')}: reg_step1</option>
                {(goals.data?.goals ?? [])
                  .filter((g) => g.status !== 'dead')
                  .sort((a, b) => b.reaches - a.reaches)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            }
          />
        )}
      </Card>
    </div>
  );
}
