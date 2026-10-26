import { useQuery } from '@tanstack/react-query';
import { v3, type AuditEntry } from '../../lib/api-v3';
import { useT, fmtDate } from '../../i18n';
import { DataGrid, type GridColumn } from '../../components/DataGrid';
import { Card, ErrorBox, PageHeader, Skeleton } from '../../components/ui';

/** Admin: audit log (sign-ins, user/role changes, settings, keys, exports). Secrets are never logged. */
export function Audit(): JSX.Element {
  const { t, locale } = useT();
  const q = useQuery({
    queryKey: ['audit'],
    queryFn: () => v3.audit(1000),
    refetchInterval: 30_000,
  });
  const cols: GridColumn<AuditEntry>[] = [
    {
      id: 'at',
      header: locale === 'ru' ? 'Когда' : 'When',
      accessor: (r) => r.at,
      cell: (r) => fmtDate(r.at, locale, true),
      minWidth: 170,
    },
    { id: 'user', header: locale === 'ru' ? 'Кто' : 'Who', accessor: (r) => r.userEmail ?? '—' },
    {
      id: 'action',
      header: locale === 'ru' ? 'Действие' : 'Action',
      accessor: (r) => r.action,
      cell: (r) => <code className="text-xs">{r.action}</code>,
    },
    {
      id: 'target',
      header: locale === 'ru' ? 'Объект' : 'Target',
      accessor: (r) => r.target ?? '',
    },
    {
      id: 'details',
      header: locale === 'ru' ? 'Детали' : 'Details',
      accessor: (r) => r.details ?? '',
      cell: (r) => (
        <span className="font-mono text-[11px] text-muted">{(r.details ?? '').slice(0, 120)}</span>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('nav.section.admin')}
        title={t('admin.audit.title')}
        subtitle={t('admin.audit.subtitle')}
      />
      <Card>
        {q.isLoading && <Skeleton className="h-64" />}
        {q.error && <ErrorBox error={q.error} />}
        {q.data && (
          <DataGrid
            columns={cols}
            rows={q.data}
            fileName="audit"
            initialSort={[{ id: 'at', desc: true }]}
          />
        )}
      </Card>
    </div>
  );
}
