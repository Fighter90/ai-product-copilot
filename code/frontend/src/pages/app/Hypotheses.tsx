import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpDown, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  ASSUMPTION_CATEGORIES,
  iceScore,
  validateHypothesis,
  type Hypothesis,
  type HypothesisStatus,
  type NewHypothesis,
} from '@pca/shared';
import { useT, fmtNum, type DictKey } from '../../i18n';
import {
  Card,
  ConfirmDialog,
  ErrorBox,
  Modal,
  PageHeader,
  Pill,
  Skeleton,
} from '../../components/ui';
import { EmptyState } from '../../components/EmptyState';
import { SourceBadge, UnverifiedBadge } from '../../components/hypotheses/SourceBadge';
import {
  HypothesisEditor,
  blankDraft,
  draftOf,
  type HypothesisDraft,
} from '../../components/hypotheses/HypothesisEditor';
import { KANBAN_COLUMNS, STATUS_KEY, statusTone } from '../../components/hypotheses/labels';
import { hypothesesApi } from '../../lib/hypotheses-api';
import { api } from '../../lib/api';
import { hasSeed, parseHypothesisSeed } from '../../lib/hypothesis-prefill';
import type { GeneratedHypotheses } from '@pca/shared';

/** Hypotheses workspace (ANA-37): status kanban + sortable ICE table + AI import (ANA-38). */

const STATUSES: readonly HypothesisStatus[] = [
  'draft',
  'in_progress',
  'green',
  'yellow',
  'red',
  'expired',
];

type SortKey = 'iceScore' | 'impact' | 'confidence' | 'ease' | 'deadlineDays' | 'title';
const FACTORS: ReadonlyArray<{
  id: 'impact' | 'confidence' | 'ease';
  key: 'hyp.f.impact' | 'hyp.f.confidence' | 'hyp.f.ease';
}> = [
  { id: 'impact', key: 'hyp.f.impact' },
  { id: 'confidence', key: 'hyp.f.confidence' },
  { id: 'ease', key: 'hyp.f.ease' },
];

/** Draft for the editor: a new blank/seeded one or an existing hypothesis. */
interface Editing {
  readonly id: number | null;
  readonly draft: HypothesisDraft;
}

/** ANA-129 checklist line: a take-into-work requirement and whether the hypothesis meets it. */
interface ChecklistItem {
  readonly ok: boolean;
  readonly key: DictKey;
}

/** The take-into-work checklist, computed from the stored hypothesis (ANA-129). */
function workChecklist(h: Hypothesis): ChecklistItem[] {
  const nonEmpty = (...xs: string[]): boolean => xs.every((s) => s.trim() !== '');
  return [
    { key: 'hyp.check.format', ok: nonEmpty(h.subject, h.action, h.solution, h.condition) },
    {
      key: 'hyp.check.assumptions',
      ok:
        h.hiddenAssumptions.length >= 3 &&
        new Set(h.hiddenAssumptions.map((a) => a.category)).size === ASSUMPTION_CATEGORIES.length,
    },
    {
      key: 'hyp.check.methods',
      ok:
        h.validationMethods.length >= 2 &&
        new Set(h.validationMethods.map((m) => m.type)).size >= 2,
    },
    {
      key: 'hyp.check.ice',
      ok: nonEmpty(h.impactRationale, h.confidenceRationale, h.easeRationale),
    },
    { key: 'hyp.check.traffic', ok: nonEmpty(h.greenCriteria, h.yellowCriteria, h.redCriteria) },
    { key: 'hyp.check.deadline', ok: Number.isInteger(h.deadlineDays) && h.deadlineDays >= 1 },
  ];
}

/** Turn a deep-link seed (ANA-24) into a prefilled draft: segment + evidence land in the form. */
function draftFromSeed(seed: ReturnType<typeof parseHypothesisSeed>): HypothesisDraft {
  const base = blankDraft();
  return {
    ...base,
    kind: 'problem',
    subject: seed.segment ?? '',
    action: seed.action ?? '',
    title: [seed.segment, seed.trouble].filter(Boolean).join(': '),
    evidence: seed.evidence ? [{ type: 'dashboard', note: seed.evidence }] : [],
    hiddenAssumptions:
      seed.trouble || seed.barrier
        ? [
            {
              category: 'behavior' as const,
              text: [seed.trouble, seed.barrier].filter(Boolean).join(' — '),
            },
          ]
        : [],
  };
}

export function Hypotheses(): JSX.Element {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<Editing | null>(null);
  // БАГ-15 removal-UX: deletion is confirmed by the styled ConfirmDialog, not window.confirm().
  const [pendingDelete, setPendingDelete] = useState<Hypothesis | null>(null);
  // ANA-129: the take-into-work checklist — a draft without the full format cannot move.
  const [checklistFor, setChecklistFor] = useState<Hypothesis | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'iceScore', dir: -1 });

  const list = useQuery({ queryKey: ['hypotheses'], queryFn: hypothesesApi.list });

  // ANA-24: «→ гипотеза» deep link (?segment=…&evidence=…) opens a prefilled editor.
  useEffect(() => {
    const seed = parseHypothesisSeed(searchParams);
    if (!hasSeed(seed)) return;
    setEditing({ id: null, draft: draftFromSeed(seed) });
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const invalidate = (): Promise<unknown> => qc.invalidateQueries({ queryKey: ['hypotheses'] });

  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: number | null; body: NewHypothesis }) =>
      id === null ? hypothesesApi.create(body) : hypothesesApi.update(id, body),
    onSuccess: () => {
      setEditing(null);
      return invalidate();
    },
  });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: HypothesisStatus }) =>
      hypothesesApi.setStatus(id, status),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => hypothesesApi.remove(id),
    onSuccess: invalidate,
  });

  const onDelete = (h: Hypothesis): void => setPendingDelete(h);

  const confirmDelete = (): void => {
    if (pendingDelete === null) return;
    const h = pendingDelete;
    setPendingDelete(null);
    deleteMut.mutate(h.id, {
      onError: (err) => window.alert(err instanceof Error ? err.message : String(err)),
    });
  };

  // ---- AI import (ANA-38): latest snapshot's generatedHypotheses -------------------------------
  const snapshots = useQuery({ queryKey: ['hypotheses-snapshots'], queryFn: api.listSnapshots });
  const latestId = snapshots.data?.[0]?.id;
  const snapshot = useQuery({
    queryKey: ['hypotheses-snapshot', latestId],
    queryFn: () => api.getSnapshot(latestId!),
    enabled: latestId !== undefined,
  });
  const generated: GeneratedHypotheses | undefined = snapshot.data?.generatedHypotheses;
  const [importedIds, setImportedIds] = useState<ReadonlySet<string>>(new Set());
  const importMut = useMutation({
    mutationFn: (s: { solution: GeneratedHypotheses['solutions'][number] }) =>
      hypothesesApi.importAi({
        problem: generated?.problems.find((p) => p.id === s.solution.problemId),
        solution: s.solution,
        provider: generated?.meta?.provider,
        model: generated?.meta?.model,
        snapshotId: snapshot.data?.id,
      }),
    onSuccess: (_data, vars) => {
      setImportedIds((prev) => new Set(prev).add(vars.solution.id));
      return invalidate();
    },
  });

  const hypotheses = list.data ?? [];
  // ANA-129: drafts are not full hypotheses yet — they stay out of ICE prioritisation.
  const work = useMemo(() => hypotheses.filter((h) => h.status !== 'draft'), [hypotheses]);
  const byStatus = (statuses: readonly HypothesisStatus[]): Hypothesis[] =>
    hypotheses.filter((h) => statuses.includes(h.status));

  /** ANA-129: moving into a work status requires the complete format; a light draft gets the checklist. */
  const onStatusChange = (h: Hypothesis, status: HypothesisStatus): void => {
    if (status !== 'draft' && status !== h.status && !validateHypothesis(h, { mode: 'work' }).ok) {
      setChecklistFor(h);
      return;
    }
    statusMut.mutate({ id: h.id, status });
  };

  // ---- Sortable ICE table ----------------------------------------------------------------------
  const sorted = useMemo(() => {
    const val = (h: Hypothesis): string | number => {
      switch (sort.key) {
        case 'title':
          return h.title.toLowerCase();
        case 'deadlineDays':
          return h.deadlineDays;
        default:
          return h[sort.key];
      }
    };
    return [...work].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return b.iceScore - a.iceScore;
    });
  }, [work, sort]);

  const toggleSort = (key: SortKey): void =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: -1 },
    );

  const sortTh = (key: SortKey, children: React.ReactNode): JSX.Element => (
    <th
      className="px-2 py-2 text-left"
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-accent"
        onClick={() => toggleSort(key)}
      >
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sort.key === key ? 'text-accent' : 'opacity-40'}`} />
      </button>
    </th>
  );

  if (list.isPending) return <Skeleton className="h-64" />;
  if (list.isError) return <ErrorBox error={list.error} onRetry={() => list.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('hyp.title')}
        subtitle={t('hyp.subtitle')}
        actions={
          <>
            <Link to="/app/decisions" className="btn-ghost">
              {t('nav.decisions')}
            </Link>
            <button
              type="button"
              data-testid="hyp-new"
              className="btn-primary"
              onClick={() => setEditing({ id: null, draft: blankDraft() })}
            >
              <Plus className="h-4 w-4" /> {t('hyp.new')}
            </button>
          </>
        }
      />

      {/* Kanban: min-w-0/overflow-hidden on lanes and cards so long titles never push a card
          past its column edge (ANA-75 / БАГ-15). */}
      <div className="grid gap-3 lg:grid-cols-6" data-testid="hyp-kanban">
        {KANBAN_COLUMNS.map((col) => {
          const cards = byStatus(col.statuses);
          return (
            <section
              key={col.id}
              aria-label={t(col.key)}
              className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface/60 p-2"
            >
              <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                {t(col.key)}
                <span className="rounded-full bg-raised px-1.5 text-[11px]">{cards.length}</span>
              </h2>
              <div className="space-y-2">
                {cards.map((h) => (
                  <article
                    key={h.id}
                    data-testid={`hyp-card-${h.id}`}
                    className="card min-w-0 overflow-hidden p-3 text-sm animate-fade-up"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-medium leading-snug">
                        {h.title}
                      </span>
                      <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[11px] font-bold text-accent">
                        {fmtNum(h.iceScore, locale)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <SourceBadge
                        source={h.source}
                        aiProvider={h.aiProvider}
                        aiModel={h.aiModel}
                      />
                      <UnverifiedBadge numbers={h.unverifiedNumbers} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-1 text-xs text-muted">
                      <select
                        aria-label={t('hyp.changeStatus')}
                        className="rounded border border-line bg-surface px-1 py-0.5 text-xs"
                        value={h.status}
                        onChange={(e) => onStatusChange(h, e.target.value as HypothesisStatus)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t(STATUS_KEY[s])}
                          </option>
                        ))}
                      </select>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={t('hyp.edit')}
                          title={t('hyp.edit')}
                          className="rounded p-1 text-muted hover:text-accent"
                          onClick={() => setEditing({ id: h.id, draft: draftOf(h) })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('hyp.delete')}
                          title={t('hyp.delete')}
                          className="rounded p-1 text-muted hover:text-red-600"
                          onClick={() => onDelete(h)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                  </article>
                ))}
                {cards.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted">{t('hyp.columnEmpty')}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* ICE table */}
      <Card title={t('hyp.table.title')} hint={t('hyp.table.hint')}>
        {work.length === 0 ? (
          <EmptyState
            message={t('hyp.empty')}
            action={{
              label: t('hyp.new'),
              onClick: () => setEditing({ id: null, draft: blankDraft() }),
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table data-testid="hyp-ice-table" className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  {sortTh('title', t('hyp.col.title'))}
                  <th className="px-2 py-2 text-left">{t('hyp.col.status')}</th>
                  {FACTORS.map((f) => (
                    <th key={f.id} className="px-2 py-2 text-left">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-accent"
                        onClick={() => toggleSort(f.id)}
                      >
                        {t(f.key)}
                        <ArrowUpDown
                          className={`h-3 w-3 ${sort.key === f.id ? 'text-accent' : 'opacity-40'}`}
                        />
                      </button>
                    </th>
                  ))}
                  {sortTh('iceScore', t('hyp.col.ice'))}
                  {sortTh('deadlineDays', t('hyp.col.deadline'))}
                  <th className="px-2 py-2 text-left">{t('hyp.col.source')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((h) => (
                  <tr key={h.id} className="border-b border-line/60 hover:bg-raised/50">
                    <td className="max-w-72 truncate px-2 py-2 font-medium" title={h.title}>
                      {h.title}
                    </td>
                    <td className="px-2 py-2">
                      <Pill tone={statusTone(h.status)}>{t(STATUS_KEY[h.status])}</Pill>
                    </td>
                    <td className="px-2 py-2">{h.impact}</td>
                    <td className="px-2 py-2">{h.confidence}</td>
                    <td className="px-2 py-2">{h.ease}</td>
                    <td className="px-2 py-2 font-bold text-accent">
                      {fmtNum(iceScore(h.impact, h.confidence, h.ease), locale)}
                    </td>
                    <td className="px-2 py-2">{t('hyp.deadlineIn', { n: h.deadlineDays })}</td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-1.5">
                        <SourceBadge
                          source={h.source}
                          aiProvider={h.aiProvider}
                          aiModel={h.aiModel}
                        />
                        <UnverifiedBadge numbers={h.unverifiedNumbers} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* AI import */}
      {generated && (generated.solutions.length > 0 || generated.problems.length > 0) && (
        <Card title={t('hyp.ai.title')} hint={t('hyp.ai.subtitle')}>
          <ul className="space-y-2" data-testid="hyp-ai-list">
            {generated.solutions.map((s) => {
              const imported = importedIds.has(s.id);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <SourceBadge
                        source="ai"
                        aiProvider={generated.meta?.provider}
                        aiModel={generated.meta?.model}
                      />
                      <UnverifiedBadge numbers={s.unverifiedNumbers} />
                    </span>
                    <span className="mt-1 block truncate font-medium" title={s.action}>
                      {s.action}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="rounded bg-raised px-1.5 py-0.5 text-[11px] font-bold text-accent">
                      ICE {s.ice.score}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={imported || importMut.isPending}
                      onClick={() => importMut.mutate({ solution: s })}
                    >
                      {imported ? t('hyp.ai.imported') : t('hyp.ai.import')}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {editing !== null && (
        <HypothesisEditor
          open
          initial={editing.draft}
          heading={editing.id === null ? t('hyp.editor.new') : t('hyp.editor.edit')}
          status={
            editing.id === null
              ? 'draft'
              : (hypotheses.find((h) => h.id === editing.id)?.status ?? 'draft')
          }
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await saveMut.mutateAsync({ id: editing.id, body });
          }}
        />
      )}

      {/* ANA-129: the take-into-work gate — the draft must carry the complete format. */}
      <Modal
        open={checklistFor !== null}
        size="md"
        title={t('hyp.check.title')}
        onClose={() => setChecklistFor(null)}
      >
        {checklistFor !== null && (
          <div data-testid="hyp-work-checklist" className="space-y-3 text-sm">
            <p className="text-muted">{t('hyp.check.blocked')}</p>
            <ul className="space-y-1.5">
              {workChecklist(checklistFor).map((item) => (
                <li key={item.key} className={item.ok ? 'text-green-700' : 'text-red-600'}>
                  <span aria-hidden>{item.ok ? '✓' : '✗'}</span> {t(item.key)}
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button type="button" className="btn-ghost" onClick={() => setChecklistFor(null)}>
                {t('hyp.check.close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* БАГ-15 removal-UX: styled confirmation instead of the native window.confirm(). */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('hyp.delete')}
        body={pendingDelete === null ? '' : t('hyp.delete.confirm', { title: pendingDelete.title })}
        confirmLabel={t('hyp.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        busy={deleteMut.isPending}
      />
    </div>
  );
}
