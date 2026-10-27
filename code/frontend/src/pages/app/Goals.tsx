import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { v3, type LiveGoal, type GoalRole } from '../../lib/api-v3';
import { useT, fmtNum } from '../../i18n';
import { DataGrid, type GridColumn } from '../../components/DataGrid';
import { Card, ErrorBox, Hint, Kpi, PageHeader, Pill, Skeleton } from '../../components/ui';
import { useFilters } from '../../store/filters';
import { isArchived, visibleGoals } from '../../lib/archived-goals';
import { LiveBar, NotConfigured, isNotConfigured, useLiveParams } from './live-common';

type Status = 'all' | LiveGoal['status'] | 'dup';

/** All counter goals as a data grid — the goal-centric dashboard (live or any period). */
export function Goals(): JSX.Element {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const p = useLiveParams();
  const showArchived = useFilters((s) => s.showArchived);
  const [status, setStatus] = useState<Status>('all');
  const q = useQuery({
    queryKey: ['live', 'goals', p.from, p.to, p.test],
    queryFn: () => v3.liveGoals(p),
    refetchInterval: p.refetchInterval,
  });
  // ANA-34: pc-goals reference — the funnel role of each JS-event goal, joined by `event`.
  const rolesQ = useQuery({
    queryKey: ['goal-roles'],
    queryFn: () => v3.goalRoles(),
    staleTime: Infinity,
  });
  const roleByEvent = useMemo(
    () => new Map<string, GoalRole>((rolesQ.data?.roles ?? []).map((r) => [r.event, r])),
    [rolesQ.data],
  );

  const all = q.data?.goals ?? [];
  // The global «Архивные цели» checkbox: archived goals are hidden unless it is on.
  const goals = useMemo(() => visibleGoals(all, showArchived), [all, showArchived]);
  const hiddenArchived = all.length - goals.length;
  const counts = useMemo(
    () => ({
      live: goals.filter((g) => g.status === 'live').length,
      sleeping: goals.filter((g) => g.status === 'sleeping').length,
      dead: goals.filter((g) => g.status === 'dead').length,
      dups: goals.filter((g) => g.duplicateOf.length).length,
    }),
    [goals],
  );
  const rows = goals.filter((g) =>
    status === 'all' ? true : status === 'dup' ? g.duplicateOf.length > 0 : g.status === status,
  );

  const columns: GridColumn<LiveGoal>[] = [
    { id: 'id', header: t('goals.col.id'), kind: 'text', accessor: (g) => g.id, hidden: true },
    {
      id: 'name',
      header: t('goals.col.name'),
      accessor: (g) => g.name,
      minWidth: 280,
      cell: (g) => (
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{g.name}</span>
          {g.duplicateOf.length > 0 && <Pill tone="amber">{t('goals.duplicate')}</Pill>}
          {isArchived(g) && <Pill tone="neutral">{t('an.goals.archived')}</Pill>}
        </span>
      ),
    },
    { id: 'type', header: t('goals.col.type'), accessor: (g) => g.type },
    {
      id: 'event',
      header: t('goals.col.event'),
      accessor: (g) => g.event ?? '',
      cell: (g) =>
        g.event ? (
          <code className="rounded bg-raised px-1.5 py-0.5 text-xs">{g.event}</code>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: 'role',
      header: t('goals.col.role'),
      accessor: (g) => roleByEvent.get(g.event ?? '')?.[locale === 'ru' ? 'ru' : 'en'] ?? '',
      cell: (g) => {
        const r = roleByEvent.get(g.event ?? '');
        return r ? (
          <Pill tone="accent">{locale === 'ru' ? r.ru : r.en}</Pill>
        ) : (
          <span className="text-muted">—</span>
        );
      },
    },
    {
      id: 'reaches',
      header: t('goals.col.reaches'),
      kind: 'int',
      accessor: (g) => g.reaches,
      total: 'sum',
    },
    { id: 'cr', header: t('goals.col.cr'), kind: 'pct', accessor: (g) => g.conversionRate },
    {
      id: 'prev',
      header: t('goals.col.prev'),
      kind: 'int',
      accessor: (g) => g.previousReaches,
      total: 'sum',
    },
    {
      id: 'delta',
      header: t('goals.col.delta'),
      kind: 'pct',
      accessor: (g) => g.delta * 100,
      cell: (g) =>
        g.reaches === 0 && g.previousReaches === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className={g.delta >= 0 ? 'text-green-600' : 'text-red-600'}>
            {g.delta >= 0 ? '▲' : '▼'} {fmtNum(Math.abs(g.delta * 100), locale, 0)}%
          </span>
        ),
    },
    { id: 'r14', header: t('goals.col.r14'), kind: 'int', accessor: (g) => g.reaches14 },
    { id: 'r90', header: t('goals.col.r90'), kind: 'int', accessor: (g) => g.reaches90 },
    {
      id: 'status',
      header: t('goals.col.status'),
      accessor: (g) => g.status,
      cell: (g) => (
        <Pill tone={g.status === 'live' ? 'green' : g.status === 'sleeping' ? 'amber' : 'red'}>
          {t(`goals.status.${g.status}`)}
        </Pill>
      ),
    },
  ];

  if (q.error && isNotConfigured(q.error)) return <NotConfigured />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Metrika"
        title={t('goals.title')}
        subtitle={t('goals.subtitle')}
        actions={
          <LiveBar
            updatedAt={q.data?.updatedAt}
            onRefresh={() => void q.refetch()}
            fetching={q.isFetching}
          />
        }
      />
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {hiddenArchived > 0 && (
        <p role="note" className="text-xs text-muted">
          {t('an.goals.archivedHidden', { n: hiddenArchived })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {q.data ? (
          <>
            <Kpi label={t('live.visits')} value={q.data.visits} accent />
            <Kpi label={t('goals.status.live')} value={counts.live} />
            <Kpi label={t('goals.status.sleeping')} value={counts.sleeping} />
            <Kpi label={t('goals.status.dead')} value={counts.dead} />
            <Kpi label={t('goals.duplicate')} value={counts.dups} hint={t('an.goals.dupHint')} />
          </>
        ) : (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)
        )}
      </div>
      <Card
        title={
          <>
            {t('goals.summary', counts)}
            <Hint text={t('an.goals.statusHint')} />
          </>
        }
      >
        {q.isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <DataGrid
            columns={columns}
            rows={rows}
            fileName={`goals_${p.from}_${p.to}`}
            initialSort={[{ id: 'reaches', desc: true }]}
            onRowClick={(g) => navigate(`/app/goals/${g.id}`)}
            toolbar={
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
                aria-label={t('goals.filter.status')}
                className="input w-auto"
              >
                <option value="all">{t('common.all')}</option>
                <option value="live">{t('goals.status.live')}</option>
                <option value="sleeping">{t('goals.status.sleeping')}</option>
                <option value="dead">{t('goals.status.dead')}</option>
                <option value="dup">{t('goals.duplicate')}</option>
              </select>
            }
          />
        )}
      </Card>
    </div>
  );
}
