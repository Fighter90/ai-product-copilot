import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Card, ErrorBox, Pill, Skeleton } from '../../ui';
import { useT } from '../../../i18n';
import {
  goalsApi,
  type GoalCondition,
  type GoalCreateInput,
  type GoalPreview,
  type GoalRefView,
  type GoalsAuditView,
} from '../../../lib/api-v3';
import { ArchiveConfirmModal, GoalPreviewModal, RestoreConfirmModal } from './GoalModals';

const COND_TYPES: GoalCondition['type'][] = ['exact', 'contain', 'start', 'regexp'];
const STATUS_TONE = { present: 'green', missing: 'red', mismatch: 'amber' } as const;

/**
 * Admin «Цели счётчика»: audit of the counter vs the pc-goals reference, bulk archive of dead
 * goals / duplicates (typed АРХИВ), custom goal creation and restore. Every write goes through a
 * confirmation modal; creation first shows the exact JSON from the server-side preview.
 */
export function GoalsManager(): JSX.Element {
  const { t } = useT();
  const qc = useQueryClient();
  const audit = useQuery({ queryKey: ['admin', 'goals-audit'], queryFn: () => goalsApi.audit() });
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingInput, setPendingInput] = useState<GoalCreateInput | null>(null);
  const [preview, setPreview] = useState<GoalPreview | null>(null);
  const [archiveList, setArchiveList] = useState<GoalRefView[] | null>(null);
  const [restoreId, setRestoreId] = useState<number | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'goals-audit'] });

  const previewM = useMutation({
    mutationFn: (input: GoalCreateInput) => goalsApi.preview(input),
    onSuccess: (p, input) => {
      setPendingInput(input);
      setPreview(p);
    },
  });
  const createM = useMutation({
    mutationFn: (input: GoalCreateInput) => goalsApi.create(input),
    onSuccess: (r) => {
      setPreview(null);
      setPendingInput(null);
      setMsg(t('admin.goals.created', { name: r.goal.name, id: r.goal.id }));
      refresh();
    },
  });
  const archiveM = useMutation({
    mutationFn: ({ ids, word }: { ids: number[]; word: string }) => goalsApi.archiveBulk(ids, word),
    onSuccess: (r) => {
      setArchiveList(null);
      setSelected(new Set());
      setMsg(
        t('admin.goals.result', {
          ok: r.archived.length,
          failed: r.failed.length,
          skipped: r.skipped.length,
        }) +
          (r.failed.length ? ` — ${r.failed.map((f) => `#${f.id}: ${f.error}`).join('; ')}` : ''),
      );
      refresh();
    },
  });
  const restoreM = useMutation({
    mutationFn: (id: number) => goalsApi.restore(id),
    onSuccess: (_r, id) => {
      setRestoreId(null);
      setMsg(t('admin.goals.restored', { id }));
      refresh();
    },
  });

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const byId = useMemo(() => {
    const m = new Map<number, GoalRefView>();
    for (const g of audit.data?.goals ?? []) m.set(g.id, g);
    return m;
  }, [audit.data]);

  const openArchive = () =>
    setArchiveList(
      [...selected].map((id) => byId.get(id) ?? { id, name: `#${id}`, type: '', reference: null }),
    );

  return (
    <Card
      title={t('admin.goals.title')}
      actions={
        <button type="button" className="btn-ghost" onClick={refresh} disabled={audit.isFetching}>
          <RefreshCw className={`h-4 w-4 ${audit.isFetching ? 'animate-spin' : ''}`} />
          {t('admin.goals.refresh')}
        </button>
      }
    >
      <p className="mb-4 text-sm text-muted">{t('admin.goals.subtitle')}</p>
      {msg && (
        <div
          className="card mb-3 break-words border-accent/40 p-3 text-sm"
          onClick={() => setMsg(null)}
        >
          {msg}
        </div>
      )}
      {audit.isLoading && <Skeleton className="h-48" />}
      {audit.error && <ErrorBox error={audit.error} onRetry={refresh} />}
      {audit.data && (
        <div className="space-y-6">
          {audit.data.canWrite === false && (
            <div role="alert" className="card border-amber-300 p-3 text-sm text-amber-700">
              {t('admin.goals.readonly')}
            </div>
          )}
          {audit.data.warnings.length > 0 && (
            <p className="text-xs text-muted">{audit.data.warnings.join(' · ')}</p>
          )}
          <ExpectedTable
            data={audit.data}
            onCreate={(code) => previewM.mutate({ ref: code })}
            onRestore={setRestoreId}
            busy={previewM.isPending}
          />
          {previewM.error && !preview && <ErrorBox error={previewM.error} />}
          <CleanupLists data={audit.data} selected={selected} toggle={toggle} />
          <button
            type="button"
            className="btn-danger"
            disabled={selected.size === 0}
            onClick={openArchive}
          >
            {t('admin.goals.archiveSelected', { n: selected.size })}
          </button>
          <CustomGoalForm onPreview={(spec) => previewM.mutate(spec)} busy={previewM.isPending} />
          <ArchivedGoals data={audit.data} onRestore={setRestoreId} />
        </div>
      )}
      <GoalPreviewModal
        preview={preview}
        pending={createM.isPending}
        error={createM.error}
        onConfirm={() => pendingInput && createM.mutate(pendingInput)}
        onClose={() => {
          setPreview(null);
          createM.reset();
        }}
      />
      <ArchiveConfirmModal
        goals={archiveList}
        pending={archiveM.isPending}
        error={archiveM.error}
        onConfirm={(word) =>
          archiveList && archiveM.mutate({ ids: archiveList.map((g) => g.id), word })
        }
        onClose={() => {
          setArchiveList(null);
          archiveM.reset();
        }}
      />
      <RestoreConfirmModal
        goalId={restoreId}
        pending={restoreM.isPending}
        error={restoreM.error}
        onConfirm={() => restoreId !== null && restoreM.mutate(restoreId)}
        onClose={() => {
          setRestoreId(null);
          restoreM.reset();
        }}
      />
    </Card>
  );
}

function ExpectedTable({
  data,
  onCreate,
  onRestore,
  busy,
}: {
  data: GoalsAuditView;
  onCreate: (code: string) => void;
  onRestore: (id: number) => void;
  busy: boolean;
}): JSX.Element {
  const { t, locale } = useT();
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{t('admin.goals.expected')}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 pr-2">{t('admin.goals.col.code')}</th>
              <th className="py-1 pr-2">{t('admin.goals.col.event')}</th>
              <th className="py-1 pr-2">{t('admin.goals.col.stage')}</th>
              <th className="py-1 pr-2">{t('admin.goals.col.status')}</th>
              <th className="py-1 pr-2">{t('admin.goals.col.goal')}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {data.expected.map((row) => (
              <tr key={row.ref.code} className="border-t border-line align-top">
                <td className="py-1 pr-2 font-mono text-xs">{row.ref.code}</td>
                <td className="py-1 pr-2 font-mono text-xs">{row.ref.event}</td>
                <td className="py-1 pr-2">{locale === 'ru' ? row.ref.ru : row.ref.en}</td>
                <td className="py-1 pr-2">
                  <Pill tone={STATUS_TONE[row.status]}>
                    {t(`admin.goals.status.${row.status}`)}
                  </Pill>
                </td>
                <td className="py-1 pr-2 text-xs">
                  {row.goalId !== undefined && (
                    <span>
                      #{row.goalId} {row.goalName}
                    </span>
                  )}
                  {row.issues?.map((i) => (
                    <div key={i} className="text-amber-700">
                      {i}
                    </div>
                  ))}
                </td>
                <td className="py-1 text-right">
                  {row.status === 'missing' && row.archivedGoalId !== undefined && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onRestore(row.archivedGoalId!)}
                    >
                      {t('admin.goals.restore')}
                    </button>
                  )}
                  {row.status === 'missing' && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy || data.canWrite === false}
                      onClick={() => onCreate(row.ref.code)}
                      aria-label={`${t('admin.goals.create')} ${row.ref.code}`}
                    >
                      {t('admin.goals.create')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GoalCheck({
  g,
  selected,
  toggle,
  extra,
}: {
  g: GoalRefView;
  selected: Set<number>;
  toggle: (id: number) => void;
  extra?: string;
}): JSX.Element {
  const { t } = useT();
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={selected.has(g.id)}
        onChange={() => toggle(g.id)}
        aria-label={`#${g.id} ${g.name}`}
      />
      <span className="font-mono text-xs text-muted">#{g.id}</span>
      <span>{g.name}</span>
      <span className="text-xs text-muted">{g.type}</span>
      {extra && <span className="text-xs text-muted">{extra}</span>}
      {g.reference && (
        <Pill tone="amber">
          {g.reference} · {t('admin.goals.refWarn')}
        </Pill>
      )}
    </label>
  );
}

function CleanupLists({
  data,
  selected,
  toggle,
}: {
  data: GoalsAuditView;
  selected: Set<number>;
  toggle: (id: number) => void;
}): JSX.Element {
  const { t } = useT();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('admin.goals.dead', { days: data.days })}</h3>
        {data.dead.length === 0 ? (
          <p className="text-sm text-muted">{t('admin.goals.deadEmpty')}</p>
        ) : (
          <div className="space-y-1">
            {data.dead.map((g) => (
              <GoalCheck key={g.id} g={g} selected={selected} toggle={toggle} />
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('admin.goals.duplicates')}</h3>
        {data.duplicates.length === 0 ? (
          <p className="text-sm text-muted">{t('admin.goals.dupEmpty')}</p>
        ) : (
          <div className="space-y-3">
            {data.duplicates.map((grp) => (
              <div key={`${grp.reason}:${grp.key}`} className="rounded border border-line p-2">
                <div className="mb-1 text-xs text-muted">
                  {grp.reason === 'conditions'
                    ? t('admin.goals.dupConditions')
                    : t('admin.goals.dupName')}
                  : <span className="font-mono">{grp.key}</span>
                </div>
                {grp.goals.map((g) => (
                  <GoalCheck key={g.id} g={g} selected={selected} toggle={toggle} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomGoalForm({
  onPreview,
  busy,
}: {
  onPreview: (spec: GoalCreateInput) => void;
  busy: boolean;
}): JSX.Element {
  const { t } = useT();
  const [name, setName] = useState('');
  const [type, setType] = useState<'url' | 'action'>('url');
  const [cond, setCond] = useState<GoalCondition['type']>('contain');
  const [value, setValue] = useState('');
  return (
    <form
      className="rounded border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onPreview({ name: name.trim(), type, conditions: [{ type: cond, url: value.trim() }] });
      }}
    >
      <h3 className="mb-2 text-sm font-semibold">{t('admin.goals.custom')}</h3>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block">
          <span className="label">{t('admin.goals.name')}</span>
          <input
            className="input"
            value={name}
            maxLength={255}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">{t('admin.goals.type')}</span>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as 'url' | 'action')}
          >
            <option value="url">{t('admin.goals.typeUrl')}</option>
            <option value="action">{t('admin.goals.typeAction')}</option>
          </select>
        </label>
        <label className="block">
          <span className="label">{t('admin.goals.condType')}</span>
          <select
            className="input"
            value={cond}
            onChange={(e) => setCond(e.target.value as GoalCondition['type'])}
          >
            {COND_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`admin.goals.cond.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('admin.goals.value')}</span>
          <input
            className="input font-mono"
            value={value}
            placeholder={type === 'action' ? 'reg_step1' : '/cart'}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      </div>
      <button
        type="submit"
        className="btn-primary mt-3"
        disabled={busy || !name.trim() || !value.trim()}
      >
        {t('admin.goals.preview')}
      </button>
    </form>
  );
}

function ArchivedGoals({
  data,
  onRestore,
}: {
  data: GoalsAuditView;
  onRestore: (id: number) => void;
}): JSX.Element {
  const { t } = useT();
  const [manual, setManual] = useState('');
  const archived = data.goals.filter((g) => g.archived);
  const manualId = Number(manual);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{t('admin.goals.archived')}</h3>
      {archived.length === 0 ? (
        <p className="mb-2 text-sm text-muted">{t('admin.goals.archivedEmpty')}</p>
      ) : (
        <ul className="mb-2 space-y-1 text-sm">
          {archived.map((g) => (
            <li key={g.id} className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted">#{g.id}</span> {g.name}
              <button type="button" className="btn-ghost" onClick={() => onRestore(g.id)}>
                {t('admin.goals.restore')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <label className="block">
          <span className="label">{t('admin.goals.goalId')}</span>
          <input
            className="input w-40"
            type="number"
            min={1}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-ghost"
          disabled={!Number.isInteger(manualId) || manualId <= 0}
          onClick={() => onRestore(manualId)}
        >
          {t('admin.goals.restore')}
        </button>
      </div>
    </div>
  );
}
