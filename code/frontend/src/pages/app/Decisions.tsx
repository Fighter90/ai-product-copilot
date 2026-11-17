import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  AUTONOMY_LEVEL_RANK,
  DECISION_TYPES,
  type AutonomyAssessment,
  type AutonomyMatrixResponse,
  type DecisionFinding,
  type DecisionMethod,
  type DecisionOutcome,
  type DecisionStatus,
  type FindingConfidence,
  type Hypothesis,
  type NewDecision,
} from '@pca/shared';
import { useT, fmtDate } from '../../i18n';
import { Card, ErrorBox, PageHeader, Pill, Skeleton } from '../../components/ui';
import { EmptyState } from '../../components/EmptyState';
import { SourceBadge } from '../../components/hypotheses/SourceBadge';
import { Modal } from '../../components/ui';
import {
  CONFIDENCE_KEY,
  DECISION_KANBAN_COLUMNS,
  DECISION_METHOD_KEY,
  DECISION_STATUS_KEY,
  DECISION_TYPE_KEY,
  OUTCOME_KEY,
} from '../../components/hypotheses/labels';
import { decisionsApi, hypothesesApi } from '../../lib/hypotheses-api';
import { useAuth } from '../../auth/AuthContext';

/** Decision Log (ANA-37): every validated hypothesis ends with a data-backed decision.
    ANA-169: decision kanban (lanes = workflow statuses, drag-and-drop moves a decision)
    next to the original list view — the switcher keeps both. */

const OUTCOMES: readonly DecisionOutcome[] = ['green', 'yellow', 'red'];
const CONFIDENCES: readonly FindingConfidence[] = ['high', 'medium', 'low'];
const METHODS: readonly DecisionMethod[] = ['synthetic', 'live', 'quantitative', 'market', 'mixed'];

type ViewMode = 'kanban' | 'list';

/** ANA-169: read the dragged decision id out of a drop event; empty/garbage payloads are ignored. */
function draggedDecisionId(e: React.DragEvent<HTMLElement>): number | null {
  const raw = (e.dataTransfer?.getData('text/plain') ?? '').trim();
  if (raw === '') return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

const input =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';
const label = 'mb-1 block text-xs font-semibold text-muted';

function FieldError({ children }: { children: React.ReactNode }): JSX.Element | null {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-red-600">
      {children}
    </p>
  );
}

type FindingRow = DecisionFinding;
interface EvidenceRow {
  quote: string;
  source: string;
}

/**
 * ANA-138: autonomy badges of an AI decision — the assessed type, the level the decision
 * runs at (tooltip = the level's meaning) and, when the verdict escalates, the
 * «требует PM-эскалации» badge with the localized reason (the API returns the raw code).
 */
function AutonomyBadges({ autonomy }: { autonomy: AutonomyAssessment }): JSX.Element | null {
  const { t } = useT();
  const reason = autonomy.escalation.reason;
  return (
    <>
      <Pill tone="neutral">{t(DECISION_TYPE_KEY[autonomy.type])}</Pill>
      <Pill tone="accent" title={t(`dec.autonomy.level.${autonomy.required}`)}>
        {autonomy.required}
      </Pill>
      {reason && (
        <Pill tone="amber" title={t(`dec.autonomy.reason.${reason}`)}>
          {t('dec.autonomy.escalation')}
        </Pill>
      )}
    </>
  );
}

/**
 * ANA-138: the «Матрица автономии» block — the static contract served by
 * GET /api/decisions/autonomy-matrix, rendered as a compact type → max-level table with
 * the derived escalation rule. The table sits in an overflow-x-auto wrapper so a 390px
 * viewport never scrolls the page horizontally (ANA-135 pattern).
 */
function AutonomyMatrixCard({ data }: { data: AutonomyMatrixResponse }): JSX.Element {
  const { t } = useT();
  const requiredRank = AUTONOMY_LEVEL_RANK[data.required];
  return (
    <Card>
      <h2 className="text-sm font-bold">{t('dec.autonomy.matrix.title')}</h2>
      <p className="mt-1 text-xs text-muted">
        {t('dec.autonomy.matrix.subtitle', { required: data.required })}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table data-testid="autonomy-matrix" className="w-full text-left text-xs">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3 font-medium">{t('dec.autonomy.matrix.col.type')}</th>
              <th className="py-1.5 pr-3 font-medium">{t('dec.autonomy.matrix.col.max')}</th>
              <th className="py-1.5 font-medium">{t('dec.autonomy.matrix.col.rule')}</th>
            </tr>
          </thead>
          <tbody>
            {DECISION_TYPES.map((type) => {
              const max = data.matrix[type].maxAutonomy;
              const escalates = AUTONOMY_LEVEL_RANK[max] < requiredRank;
              return (
                <tr key={type} className="border-t border-line">
                  <td className="py-1.5 pr-3">{t(DECISION_TYPE_KEY[type])}</td>
                  <td className="py-1.5 pr-3 font-mono">{max}</td>
                  <td className="py-1.5">
                    {escalates
                      ? t('dec.autonomy.matrix.rule.escalate')
                      : t('dec.autonomy.matrix.rule.ok')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DecisionEditor({
  hypotheses,
  onClose,
  onSave,
}: {
  hypotheses: Hypothesis[];
  onClose: () => void;
  onSave: (d: NewDecision) => Promise<void>;
}): JSX.Element {
  const { t } = useT();
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [hypothesisId, setHypothesisId] = useState<number | ''>('');
  const [date, setDate] = useState(today);
  // ANA-169: the formulation «что делаем» — the decision itself, required like the evidence.
  const [decision, setDecision] = useState('');
  const [method, setMethod] = useState<DecisionMethod>('quantitative');
  const [scope, setScope] = useState('');
  const [periodDays, setPeriodDays] = useState(14);
  const [findings, setFindings] = useState<FindingRow[]>([{ text: '', confidence: 'high' }]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([{ quote: '', source: '' }]);
  const [outcome, setOutcome] = useState<DecisionOutcome>('green');
  const [outcomeRationale, setOutcomeRationale] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [responsible, setResponsible] = useState('');
  const [decidedBy, setDecidedBy] = useState(user?.name ?? '');
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // БАГ-14: «Заполните поле» stays hidden until the user touches the form (dirty tracking).
  const [dirty, setDirty] = useState(false);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (hypothesisId === '') e.hypothesisId = t('hyp.err.required');
    for (const [f, v] of [
      ['decision', decision],
      ['scope', scope],
      ['outcomeRationale', outcomeRationale],
      ['nextStep', nextStep],
      ['decidedBy', decidedBy],
    ] as const) {
      if (v.trim() === '') e[f] = t('hyp.err.required');
    }
    if (findings.some((f) => f.text.trim() === '')) e.findings = t('dec.err.findingsText');
    if (
      evidence.length === 0 ||
      evidence.some((ev) => ev.quote.trim() === '' || ev.source.trim() === '')
    ) {
      e.evidence = t('dec.err.evidence');
    }
    return e;
  }, [hypothesisId, decision, scope, outcomeRationale, nextStep, decidedBy, findings, evidence, t]);

  const valid = Object.keys(errors).length === 0 && !busy;
  /** Per-field errors as displayed: gated behind the first user input (БАГ-14 dirty tracking). */
  const shownErrors = dirty ? errors : {};

  const save = async (): Promise<void> => {
    if (!valid || typeof hypothesisId !== 'number') return;
    setBusy(true);
    setApiError(null);
    try {
      await onSave({
        hypothesisId,
        date,
        decision: decision.trim(),
        method,
        scope: scope.trim(),
        periodDays,
        findings: findings.map((f) => ({ ...f, text: f.text.trim() })),
        evidence: evidence.map((ev) => ({ quote: ev.quote.trim(), source: ev.source.trim() })),
        outcome,
        outcomeRationale: outcomeRationale.trim(),
        nextStep: nextStep.trim(),
        ...(responsible.trim() ? { responsible: responsible.trim() } : {}),
        decidedBy: decidedBy.trim(),
      });
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open size="xl" title={t('dec.new')} onClose={busy ? () => {} : onClose}>
      <div
        data-testid="decision-editor"
        className="max-h-[70vh] space-y-4 overflow-y-auto overflow-x-hidden pr-1"
        onChangeCapture={() => setDirty(true)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="dec-hypothesis">
              {t('dec.f.hypothesis')}
            </label>
            <select
              id="dec-hypothesis"
              className={input}
              value={hypothesisId}
              onChange={(e) => setHypothesisId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">—</option>
              {hypotheses.map((h) => (
                <option key={h.id} value={h.id}>
                  #{h.id} {h.title}
                </option>
              ))}
            </select>
            <FieldError>{shownErrors.hypothesisId}</FieldError>
          </div>
          <div>
            <label className={label} htmlFor="dec-date">
              {t('dec.f.date')}
            </label>
            <input
              id="dec-date"
              type="date"
              className={input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="dec-decision">
              {t('dec.f.decision')}
            </label>
            <textarea
              id="dec-decision"
              rows={2}
              className={`${input} min-h-16 resize-none`}
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            />
            <FieldError>{shownErrors.decision}</FieldError>
          </div>
          <div>
            <label className={label} htmlFor="dec-method">
              {t('dec.f.method')}
            </label>
            <select
              id="dec-method"
              className={input}
              value={method}
              onChange={(e) => setMethod(e.target.value as DecisionMethod)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(DECISION_METHOD_KEY[m])}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="dec-period">
              {t('dec.f.periodDays')}
            </label>
            <input
              id="dec-period"
              type="number"
              min={1}
              className={input}
              value={periodDays}
              onChange={(e) => setPeriodDays(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div>
            <label className={label} htmlFor="dec-scope">
              {t('dec.f.scope')}
            </label>
            <input
              id="dec-scope"
              className={input}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
            <FieldError>{shownErrors.scope}</FieldError>
          </div>
        </div>

        <div>
          <span className={label}>{t('dec.f.findings')}</span>
          <div className="space-y-2">
            {findings.map((f, i) => (
              <div key={i} className="flex gap-2">
                <select
                  aria-label={t('dec.f.findingConfidence')}
                  className={`${input} w-36 shrink-0`}
                  value={f.confidence}
                  onChange={(e) =>
                    setFindings(
                      findings.map((x, j) =>
                        j === i ? { ...x, confidence: e.target.value as FindingConfidence } : x,
                      ),
                    )
                  }
                >
                  {CONFIDENCES.map((c) => (
                    <option key={c} value={c}>
                      {t(CONFIDENCE_KEY[c])}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('dec.finding')}
                  className={`${input} min-w-0 flex-1 ${
                    dirty && shownErrors.findings && !f.text.trim() ? 'border-red-400' : ''
                  }`}
                  value={f.text}
                  onChange={(e) =>
                    setFindings(
                      findings.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={t('hyp.remove')}
                  className="shrink-0 rounded-md px-2 text-muted hover:text-red-600"
                  onClick={() => setFindings(findings.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost mt-2"
            onClick={() => setFindings([...findings, { text: '', confidence: 'medium' }])}
          >
            <Plus className="h-4 w-4" /> {t('hyp.add')}
          </button>
          <FieldError>{shownErrors.findings}</FieldError>
        </div>

        <div>
          <span className={label}>{t('dec.f.evidence')}</span>
          <div className="space-y-2">
            {evidence.map((ev, i) => (
              <div key={i} className="flex gap-2">
                <input
                  aria-label={t('dec.f.quote')}
                  placeholder={t('dec.f.quote')}
                  className={`${input} min-w-0 flex-1`}
                  value={ev.quote}
                  onChange={(e) =>
                    setEvidence(
                      evidence.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)),
                    )
                  }
                />
                <input
                  aria-label={t('dec.f.source')}
                  placeholder={t('dec.f.source')}
                  className={`${input} min-w-0 flex-1`}
                  value={ev.source}
                  onChange={(e) =>
                    setEvidence(
                      evidence.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={t('hyp.remove')}
                  className="shrink-0 rounded-md px-2 text-muted hover:text-red-600"
                  onClick={() => setEvidence(evidence.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost mt-2"
            onClick={() => setEvidence([...evidence, { quote: '', source: '' }])}
          >
            <Plus className="h-4 w-4" /> {t('hyp.add')}
          </button>
          <FieldError>{shownErrors.evidence}</FieldError>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="dec-outcome">
              {t('dec.f.outcome')}
            </label>
            <select
              id="dec-outcome"
              className={input}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as DecisionOutcome)}
            >
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {t(OUTCOME_KEY[o])}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="dec-responsible">
              {t('dec.f.responsible')}
            </label>
            <input
              id="dec-responsible"
              className={input}
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={label} htmlFor="dec-rationale">
            {t('dec.f.outcomeRationale')}
          </label>
          <textarea
            id="dec-rationale"
            rows={2}
            className={`${input} min-h-16 resize-none`}
            value={outcomeRationale}
            onChange={(e) => setOutcomeRationale(e.target.value)}
          />
          <FieldError>{shownErrors.outcomeRationale}</FieldError>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="dec-next">
              {t('dec.f.nextStep')}
            </label>
            <input
              id="dec-next"
              className={input}
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
            />
            <FieldError>{shownErrors.nextStep}</FieldError>
          </div>
          <div>
            <label className={label} htmlFor="dec-by">
              {t('dec.f.decidedBy')}
            </label>
            <input
              id="dec-by"
              className={input}
              value={decidedBy}
              onChange={(e) => setDecidedBy(e.target.value)}
            />
            <FieldError>{shownErrors.decidedBy}</FieldError>
          </div>
        </div>

        {apiError && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700"
          >
            {apiError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            {t('hyp.cancel')}
          </button>
          <button
            type="button"
            data-testid="dec-save"
            className="btn-primary"
            disabled={!valid}
            onClick={() => void save()}
          >
            {busy ? t('hyp.saving') : t('hyp.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Decisions(): JSX.Element {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  // ANA-169: kanban is the default view; the original list lives behind the switcher.
  const [view, setView] = useState<ViewMode>('kanban');

  const decisions = useQuery({ queryKey: ['decisions'], queryFn: decisionsApi.list });
  const hypotheses = useQuery({ queryKey: ['hypotheses'], queryFn: hypothesesApi.list });
  // ANA-138: the read-only autonomy contract — when it fails the page still works, the
  // matrix block just stays hidden.
  const matrix = useQuery({
    queryKey: ['decisions-autonomy-matrix'],
    queryFn: decisionsApi.autonomyMatrix,
  });

  const createMut = useMutation({
    mutationFn: (d: NewDecision) => decisionsApi.create(d),
    onSuccess: () => {
      setCreating(false);
      return Promise.all([
        qc.invalidateQueries({ queryKey: ['decisions'] }),
        qc.invalidateQueries({ queryKey: ['hypotheses'] }),
      ]);
    },
  });
  // ANA-169: a drop on another lane (or a status change) patches the decision status.
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: DecisionStatus }) =>
      decisionsApi.setStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions'] }),
  });

  const titleOf = (id: number): string =>
    (hypotheses.data ?? []).find((h) => h.id === id)?.title ?? `#${id}`;

  if (decisions.isPending) return <Skeleton className="h-64" />;
  if (decisions.isError)
    return <ErrorBox error={decisions.error} onRetry={() => decisions.refetch()} />;

  const rows = decisions.data ?? [];
  const byStatus = (status: DecisionStatus): typeof rows => rows.filter((d) => d.status === status);

  const viewBtn = (mode: ViewMode): JSX.Element => (
    <button
      key={mode}
      type="button"
      data-testid={`dec-view-${mode}`}
      aria-pressed={view === mode}
      onClick={() => setView(mode)}
      className={
        view === mode
          ? 'bg-accent px-3 py-1 text-sm text-onaccent'
          : 'bg-surface px-3 py-1 text-sm text-muted hover:text-ink'
      }
    >
      {t(mode === 'kanban' ? 'dec.view.kanban' : 'dec.view.list')}
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dec.title')}
        subtitle={t('dec.subtitle')}
        actions={
          <button
            type="button"
            data-testid="dec-new"
            className="btn-primary"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-4 w-4" /> {t('dec.new')}
          </button>
        }
      />

      {/* ANA-169: «Канбан / Список» switcher — the list is the pre-ANA-169 view. */}
      <div
        role="group"
        aria-label={t('dec.viewSwitch')}
        className="inline-flex overflow-hidden rounded-lg border border-line"
      >
        {viewBtn('kanban')}
        {viewBtn('list')}
      </div>

      {/* ANA-169: one empty state for both views — no decisions yet. */}
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            message={t('dec.empty')}
            action={{ label: t('dec.new'), onClick: () => setCreating(true) }}
          />
        </Card>
      ) : view === 'kanban' ? (
        /* Mobile 390: the board scrolls horizontally inside this container — the page
           itself never overflows (ANA-135 regression-guard pattern). */
        <div data-testid="dec-kanban" className="flex gap-3 overflow-x-auto pb-2">
          {DECISION_KANBAN_COLUMNS.map((col) => {
            const cards = byStatus(col.id);
            return (
              <section
                key={col.id}
                data-testid={`dec-col-${col.id}`}
                aria-label={t(col.key)}
                // HTML5 DnD: allow drops, then hand the dragged decision id to the caller.
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = draggedDecisionId(e);
                  const target = rows.find((d) => d.id === id);
                  if (target && target.status !== col.id) {
                    statusMut.mutate({ id: target.id, status: col.id });
                  }
                }}
                // Mobile 390: fixed-width lanes scroll horizontally inside the board
                // (Trello-style, same as the b2b pipeline); from sm up they share the width.
                className="min-w-[16rem] shrink-0 rounded-xl border border-line bg-surface/60 p-2 sm:min-w-0 sm:flex-1"
              >
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t(col.key)}
                  <span
                    data-testid={`dec-col-${col.id}-count`}
                    className="rounded-full bg-raised px-1.5 text-[11px]"
                  >
                    {cards.length}
                  </span>
                </h2>
                <div className="space-y-2">
                  {cards.map((d) => (
                    <article
                      key={d.id}
                      draggable
                      data-testid={`dec-card-${d.id}`}
                      onDragStart={(e) => {
                        e.dataTransfer?.setData('text/plain', String(d.id));
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                      }}
                      className="card min-w-0 overflow-hidden p-3 text-sm animate-fade-up active:cursor-grabbing"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-accent">{d.number}</span>
                        <SourceBadge source={d.source} />
                        <Pill
                          tone={
                            d.outcome === 'green'
                              ? 'green'
                              : d.outcome === 'yellow'
                                ? 'amber'
                                : 'red'
                          }
                        >
                          {t(OUTCOME_KEY[d.outcome])}
                        </Pill>
                      </div>
                      {/* ANA-169: the formulation «что делаем» is the card's main line. */}
                      <p className="mt-1.5 min-w-0 break-words font-medium leading-snug">
                        {d.decision}
                      </p>
                      <p className="mt-1 min-w-0 break-words text-xs text-muted">
                        {titleOf(d.hypothesisId)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-xs text-muted">
                        <span>{fmtDate(d.date, locale)}</span>
                        <span className="min-w-0 max-w-full truncate">
                          {t('dec.f.decidedBy')}: {d.decidedBy}
                        </span>
                      </div>
                    </article>
                  ))}
                  {cards.length === 0 && (
                    <p className="px-1 py-2 text-xs text-muted">{t('dec.columnEmpty')}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card>
          <ul className="space-y-3" data-testid="dec-list">
            {rows.map((d) => (
              <li key={d.id} className="rounded-lg border border-line p-3 text-sm animate-fade-up">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-accent">{d.number}</span>
                  {/* ANA-128: auto-populated AI proposals carry the «AI» provenance badge. */}
                  <SourceBadge source={d.source} />
                  {/* ANA-138: type / level / escalation badges on AI decisions only. */}
                  {d.source === 'ai' && d.autonomy && <AutonomyBadges autonomy={d.autonomy} />}
                  <Pill
                    tone={
                      d.outcome === 'green' ? 'green' : d.outcome === 'yellow' ? 'amber' : 'red'
                    }
                  >
                    {t(OUTCOME_KEY[d.outcome])}
                  </Pill>
                  {/* ANA-169: the kanban lane next to the outcome светофор. */}
                  <Pill tone={d.status === 'rejected' ? 'red' : 'neutral'}>
                    {t(DECISION_STATUS_KEY[d.status])}
                  </Pill>
                  <span className="text-xs text-muted">{fmtDate(d.date, locale)}</span>
                  <span className="ml-auto text-xs text-muted">
                    {t('dec.f.decidedBy')}: {d.decidedBy}
                  </span>
                </div>
                {/* ANA-169: the formulation leads, the conclusion (rationale) follows. */}
                <p className="mt-1.5 font-medium">{d.decision}</p>
                <p className="mt-1">{titleOf(d.hypothesisId)}</p>
                <p className="mt-1 text-muted">{d.outcomeRationale}</p>
                <p className="mt-1 text-xs text-muted">
                  {t('dec.f.nextStep')}: {d.nextStep}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {matrix.data && <AutonomyMatrixCard data={matrix.data} />}

      {creating && (
        <DecisionEditor
          hypotheses={hypotheses.data ?? []}
          onClose={() => setCreating(false)}
          onSave={async (d) => {
            await createMut.mutateAsync(d);
          }}
        />
      )}
    </div>
  );
}
