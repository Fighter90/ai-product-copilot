import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  type DecisionFinding,
  type DecisionMethod,
  type DecisionOutcome,
  type FindingConfidence,
  type Hypothesis,
  type NewDecision,
} from '@pca/shared';
import { useT, fmtDate } from '../../i18n';
import { Card, ErrorBox, PageHeader, Pill, Skeleton } from '../../components/ui';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/ui';
import {
  CONFIDENCE_KEY,
  DECISION_METHOD_KEY,
  OUTCOME_KEY,
} from '../../components/hypotheses/labels';
import { decisionsApi, hypothesesApi } from '../../lib/hypotheses-api';
import { useAuth } from '../../auth/AuthContext';

/** Decision Log (ANA-37): every validated hypothesis ends with a data-backed decision. */

const OUTCOMES: readonly DecisionOutcome[] = ['green', 'yellow', 'red'];
const CONFIDENCES: readonly FindingConfidence[] = ['high', 'medium', 'low'];
const METHODS: readonly DecisionMethod[] = ['synthetic', 'live', 'quantitative', 'market', 'mixed'];

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
      ['scope', scope],
      ['outcomeRationale', outcomeRationale],
      ['nextStep', nextStep],
      ['decidedBy', decidedBy],
    ] as const) {
      if (v.trim() === '') e[f] = t('hyp.err.required');
    }
    if (findings.some((f) => f.text.trim() === '')) e.findings = t('hyp.err.required');
    if (
      evidence.length === 0 ||
      evidence.some((ev) => ev.quote.trim() === '' || ev.source.trim() === '')
    ) {
      e.evidence = t('dec.err.evidence');
    }
    return e;
  }, [hypothesisId, scope, outcomeRationale, nextStep, decidedBy, findings, evidence, t]);

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
                  className={`${input} min-w-0 flex-1`}
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

  const decisions = useQuery({ queryKey: ['decisions'], queryFn: decisionsApi.list });
  const hypotheses = useQuery({ queryKey: ['hypotheses'], queryFn: hypothesesApi.list });

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

  const titleOf = (id: number): string =>
    (hypotheses.data ?? []).find((h) => h.id === id)?.title ?? `#${id}`;

  if (decisions.isPending) return <Skeleton className="h-64" />;
  if (decisions.isError)
    return <ErrorBox error={decisions.error} onRetry={() => decisions.refetch()} />;

  const rows = decisions.data ?? [];

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

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            message={t('dec.empty')}
            action={{ label: t('dec.new'), onClick: () => setCreating(true) }}
          />
        ) : (
          <ul className="space-y-3" data-testid="dec-list">
            {rows.map((d) => (
              <li key={d.id} className="rounded-lg border border-line p-3 text-sm animate-fade-up">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-accent">{d.number}</span>
                  <Pill
                    tone={
                      d.outcome === 'green' ? 'green' : d.outcome === 'yellow' ? 'amber' : 'red'
                    }
                  >
                    {t(OUTCOME_KEY[d.outcome])}
                  </Pill>
                  <span className="text-xs text-muted">{fmtDate(d.date, locale)}</span>
                  <span className="ml-auto text-xs text-muted">
                    {t('dec.f.decidedBy')}: {d.decidedBy}
                  </span>
                </div>
                <p className="mt-1.5 font-medium">{titleOf(d.hypothesisId)}</p>
                <p className="mt-1 text-muted">{d.outcomeRationale}</p>
                <p className="mt-1 text-xs text-muted">
                  {t('dec.f.nextStep')}: {d.nextStep}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
