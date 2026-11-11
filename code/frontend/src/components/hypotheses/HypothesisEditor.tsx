import { useMemo, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  ASSUMPTION_CATEGORIES,
  VALIDATION_METHOD_TYPES,
  iceScore,
  validateHypothesis,
  type AssumptionCategory,
  type Hypothesis,
  type HypothesisEvidence,
  type HypothesisStatus,
  type NewHypothesis,
  type ValidationMethodType,
} from '@pca/shared';
import { useT } from '../../i18n';
import { Modal } from '../ui';
import { CATEGORY_KEY, METHOD_TYPE_KEY } from './labels';

/**
 * Structured hypothesis editor (ANA-37). Format «{ЦА} {действие} {решение}, если {условие}»,
 * ≥3 hidden assumptions covering all categories, ≥2 validation methods of distinct types,
 * ICE sliders (1–10) with rationales, traffic-light criteria and a deadline.
 * ANA-129 two-status model: editing/creating a DRAFT requires only the title (light draft,
 * a hint points at the take-into-work gate); a work-status hypothesis keeps the full format.
 * Validation runs on every render, but per-field errors are shown only after the first user
 * input (dirty tracking).
 */

/** Editable form state (camelCase, arrays mutable). Built from a seed, a blank template or an existing hypothesis. */
export interface HypothesisDraft {
  readonly kind: 'problem' | 'solution';
  readonly subject: string;
  readonly action: string;
  readonly solution: string;
  readonly condition: string;
  readonly title: string;
  readonly hiddenAssumptions: Array<{ category: AssumptionCategory; text: string }>;
  readonly validationMethods: Array<{ type: ValidationMethodType; plan: string }>;
  readonly impact: number;
  readonly confidence: number;
  readonly ease: number;
  readonly impactRationale: string;
  readonly confidenceRationale: string;
  readonly easeRationale: string;
  readonly greenCriteria: string;
  readonly yellowCriteria: string;
  readonly redCriteria: string;
  readonly deadlineDays: number;
  readonly evidence: HypothesisEvidence[];
}

/** Blank valid-shaped draft (passes structure, fails completeness — by design). */
export function blankDraft(): HypothesisDraft {
  return {
    kind: 'solution',
    subject: '',
    action: '',
    solution: '',
    condition: '',
    title: '',
    hiddenAssumptions: [],
    validationMethods: [],
    impact: 5,
    confidence: 5,
    ease: 5,
    impactRationale: '',
    confidenceRationale: '',
    easeRationale: '',
    greenCriteria: '',
    yellowCriteria: '',
    redCriteria: '',
    deadlineDays: 14,
    evidence: [],
  };
}

/** Existing hypothesis → editable draft (drops server-owned fields). */
export function draftOf(h: Hypothesis): HypothesisDraft {
  return {
    kind: h.kind,
    subject: h.subject,
    action: h.action,
    solution: h.solution,
    condition: h.condition,
    title: h.title,
    hiddenAssumptions: h.hiddenAssumptions.map((a) => ({ ...a })),
    validationMethods: h.validationMethods.map((m) => ({ ...m })),
    impact: h.impact,
    confidence: h.confidence,
    ease: h.ease,
    impactRationale: h.impactRationale,
    confidenceRationale: h.confidenceRationale,
    easeRationale: h.easeRationale,
    greenCriteria: h.greenCriteria,
    yellowCriteria: h.yellowCriteria,
    redCriteria: h.redCriteria,
    deadlineDays: h.deadlineDays,
    evidence: [...(h.evidence ?? [])],
  };
}

function draftToNew(d: HypothesisDraft): NewHypothesis {
  return {
    diamondPhase: 'develop',
    kind: d.kind,
    subject: d.subject.trim(),
    action: d.action.trim(),
    solution: d.solution.trim(),
    condition: d.condition.trim(),
    title: d.title.trim(),
    // Blank rows the user added but never filled are dropped — the API rejects empty items.
    hiddenAssumptions: d.hiddenAssumptions
      .filter((a) => a.text.trim() !== '')
      .map((a) => ({ ...a, text: a.text.trim() })),
    validationMethods: d.validationMethods
      .filter((m) => m.plan.trim() !== '')
      .map((m) => ({ ...m, plan: m.plan.trim() })),
    impact: d.impact,
    confidence: d.confidence,
    ease: d.ease,
    impactRationale: d.impactRationale.trim(),
    confidenceRationale: d.confidenceRationale.trim(),
    easeRationale: d.easeRationale.trim(),
    greenCriteria: d.greenCriteria.trim(),
    yellowCriteria: d.yellowCriteria.trim(),
    redCriteria: d.redCriteria.trim(),
    deadlineDays: d.deadlineDays,
    ...(d.evidence.length > 0 ? { evidence: d.evidence } : {}),
  };
}

const input =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';
const label = 'mb-1 block text-xs font-semibold text-muted';

function FieldError({ children }: { children: ReactNode }): JSX.Element | null {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-red-600">
      {children}
    </p>
  );
}

export function HypothesisEditor({
  open,
  initial,
  heading,
  status = 'draft',
  onClose,
  onSave,
}: {
  open: boolean;
  initial: HypothesisDraft;
  heading: string;
  /** ANA-129: 'draft' (default, new) edits the light rules; a work status keeps the full format. */
  status?: HypothesisStatus;
  onClose: () => void;
  /** Persist the draft; throw to keep the modal open (the error is shown inside). */
  onSave: (draft: NewHypothesis) => Promise<void>;
}): JSX.Element {
  const { t } = useT();
  const [d, setD] = useState<HypothesisDraft>(initial);
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isDraft = status === 'draft';
  // БАГ-14: validation errors stay hidden until the user touches the form (dirty tracking) —
  // a freshly opened editor must not greet the user with a wall of «Заполните поле».
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof HypothesisDraft>(key: K, value: HypothesisDraft[K]): void => {
    setDirty(true);
    setD((prev) => ({ ...prev, [key]: value }));
  };

  /** Per-field errors, localised. The shared validator stays the source of truth for the counts. */
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (isDraft) {
      // ANA-129 light draft: the title is the only required field — no format wall.
      if (d.title.trim() === '') e.title = t('hyp.err.required');
      return e;
    }
    for (const f of ['subject', 'action', 'solution', 'condition', 'title'] as const) {
      if (d[f].trim() === '') e[f] = t('hyp.err.required');
    }
    for (const f of [
      'impactRationale',
      'confidenceRationale',
      'easeRationale',
      'greenCriteria',
      'yellowCriteria',
      'redCriteria',
    ] as const) {
      if (d[f].trim() === '') e[f] = t('hyp.err.required');
    }
    const assumptions = d.hiddenAssumptions.filter((a) => a.text.trim() !== '');
    if (assumptions.length < 3) e.hiddenAssumptions = t('hyp.err.assumptions');
    else if (new Set(assumptions.map((a) => a.category)).size < ASSUMPTION_CATEGORIES.length) {
      e.hiddenAssumptions = t('hyp.err.assumptionCategories');
    }
    if (assumptions.some((a) => a.text.trim() === '')) e.hiddenAssumptions = t('hyp.err.required');
    const methods = d.validationMethods.filter((m) => m.plan.trim() !== '');
    if (methods.length < 2) e.validationMethods = t('hyp.err.methods');
    else if (new Set(methods.map((m) => m.type)).size < 2) {
      e.validationMethods = t('hyp.err.methodTypes');
    }
    if (methods.some((m) => m.plan.trim() === '')) e.validationMethods = t('hyp.err.required');
    if (!Number.isInteger(d.deadlineDays) || d.deadlineDays < 1) {
      e.deadlineDays = t('hyp.err.deadline');
    }
    return e;
  }, [d, t, isDraft]);

  const shared = useMemo(
    () => validateHypothesis(draftToNew(d), { mode: isDraft ? 'draft' : 'work' }),
    [d, isDraft],
  );
  const valid = Object.keys(errors).length === 0 && shared.ok;
  /** Per-field errors as displayed: gated behind the first user input (БАГ-14 dirty tracking). */
  const shownErrors = dirty ? errors : {};
  const sentence = `${d.subject} ${d.action} ${d.solution}${
    d.condition ? `${t('hyp.sentenceIf')}${d.condition}` : ''
  }`.trim();

  const save = async (): Promise<void> => {
    if (!valid || busy) return;
    setBusy(true);
    setApiError(null);
    try {
      await onSave(draftToNew(d));
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} size="xl" title={heading} onClose={busy ? () => {} : onClose}>
      <div
        data-testid="hypothesis-editor"
        className="max-h-[70vh] space-y-4 overflow-y-auto overflow-x-hidden pr-1"
      >
        {/* Format sentence */}
        <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm italic text-muted">
          {sentence || '…'}
        </p>

        {/* ANA-129: light-draft hint — the full format is enforced at take-into-work. */}
        {isDraft && (
          <p data-testid="hyp-draft-hint" className="text-xs font-medium text-muted">
            {t('hyp.draftHint')}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="hyp-subject">
              {t('hyp.f.subject')}
            </label>
            <input
              id="hyp-subject"
              className={input}
              value={d.subject}
              onChange={(e) => set('subject', e.target.value)}
            />
            <FieldError>{shownErrors.subject}</FieldError>
          </div>
          <div>
            <label className={label} htmlFor="hyp-action">
              {t('hyp.f.action')}
            </label>
            <input
              id="hyp-action"
              className={input}
              value={d.action}
              onChange={(e) => set('action', e.target.value)}
            />
            <FieldError>{shownErrors.action}</FieldError>
          </div>
          <div>
            <label className={label} htmlFor="hyp-solution">
              {t('hyp.f.solution')}
            </label>
            <input
              id="hyp-solution"
              className={input}
              value={d.solution}
              onChange={(e) => set('solution', e.target.value)}
            />
            <FieldError>{shownErrors.solution}</FieldError>
          </div>
          <div>
            <label className={label} htmlFor="hyp-condition">
              {t('hyp.f.condition')}
            </label>
            <input
              id="hyp-condition"
              className={input}
              value={d.condition}
              onChange={(e) => set('condition', e.target.value)}
            />
            <FieldError>{shownErrors.condition}</FieldError>
          </div>
        </div>

        <div>
          <label className={label} htmlFor="hyp-title">
            {t('hyp.f.title')}
          </label>
          <input
            id="hyp-title"
            className={input}
            value={d.title}
            onChange={(e) => set('title', e.target.value)}
          />
          <FieldError>{shownErrors.title}</FieldError>
        </div>

        {/* Hidden assumptions */}
        <div>
          <span className={label}>{t('hyp.f.assumptions')}</span>
          <div className="space-y-2">
            {d.hiddenAssumptions.map((a, i) => (
              <div key={i} className="flex gap-2">
                <select
                  aria-label={t('hyp.f.assumptionCategory')}
                  className={`${input} w-36 shrink-0`}
                  value={a.category}
                  onChange={(e) =>
                    set(
                      'hiddenAssumptions',
                      d.hiddenAssumptions.map((x, j) =>
                        j === i ? { ...x, category: e.target.value as AssumptionCategory } : x,
                      ),
                    )
                  }
                >
                  {ASSUMPTION_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(CATEGORY_KEY[c])}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('hyp.f.assumptionText')}
                  className={`${input} min-w-0 flex-1`}
                  value={a.text}
                  onChange={(e) =>
                    set(
                      'hiddenAssumptions',
                      d.hiddenAssumptions.map((x, j) =>
                        j === i ? { ...x, text: e.target.value } : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={t('hyp.remove')}
                  className="shrink-0 rounded-md px-2 text-muted hover:text-red-600"
                  onClick={() =>
                    set(
                      'hiddenAssumptions',
                      d.hiddenAssumptions.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost mt-2"
            onClick={() =>
              set('hiddenAssumptions', [...d.hiddenAssumptions, { category: 'behavior', text: '' }])
            }
          >
            <Plus className="h-4 w-4" /> {t('hyp.add')}
          </button>
          <FieldError>{shownErrors.hiddenAssumptions}</FieldError>
        </div>

        {/* Validation methods */}
        <div>
          <span className={label}>{t('hyp.f.methods')}</span>
          <div className="space-y-2">
            {d.validationMethods.map((m, i) => (
              <div key={i} className="flex gap-2">
                <select
                  aria-label={t('hyp.f.methodType')}
                  className={`${input} w-40 shrink-0`}
                  value={m.type}
                  onChange={(e) =>
                    set(
                      'validationMethods',
                      d.validationMethods.map((x, j) =>
                        j === i ? { ...x, type: e.target.value as ValidationMethodType } : x,
                      ),
                    )
                  }
                >
                  {VALIDATION_METHOD_TYPES.map((mt) => (
                    <option key={mt} value={mt}>
                      {t(METHOD_TYPE_KEY[mt])}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('hyp.f.methodPlan')}
                  className={`${input} min-w-0 flex-1`}
                  value={m.plan}
                  onChange={(e) =>
                    set(
                      'validationMethods',
                      d.validationMethods.map((x, j) =>
                        j === i ? { ...x, plan: e.target.value } : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={t('hyp.remove')}
                  className="shrink-0 rounded-md px-2 text-muted hover:text-red-600"
                  onClick={() =>
                    set(
                      'validationMethods',
                      d.validationMethods.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost mt-2"
            onClick={() =>
              set('validationMethods', [...d.validationMethods, { type: 'quantitative', plan: '' }])
            }
          >
            <Plus className="h-4 w-4" /> {t('hyp.add')}
          </button>
          <FieldError>{shownErrors.validationMethods}</FieldError>
        </div>

        {/* ICE */}
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold text-muted">
            {t('hyp.f.ice')} = {iceScore(d.impact, d.confidence, d.ease)}
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['impact', 'hyp.f.impact', 'impactRationale'],
                ['confidence', 'hyp.f.confidence', 'confidenceRationale'],
                ['ease', 'hyp.f.ease', 'easeRationale'],
              ] as const
            ).map(([factor, key, rationale]) => (
              <div key={factor}>
                <label className={label} htmlFor={`hyp-${factor}`}>
                  {t(key)}: {d[factor]}
                </label>
                <input
                  id={`hyp-${factor}`}
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={d[factor]}
                  onChange={(e) => set(factor, Number(e.target.value))}
                  className="w-full accent-[color:var(--color-accent,theme(colors.indigo.600))]"
                />
                <label className={`${label} mt-1`} htmlFor={`hyp-${rationale}`}>
                  {t('hyp.f.rationale')}
                </label>
                <textarea
                  id={`hyp-${rationale}`}
                  rows={2}
                  className={`${input} min-h-14 resize-none`}
                  value={d[rationale]}
                  onChange={(e) => set(rationale, e.target.value)}
                />
                <FieldError>{shownErrors[rationale]}</FieldError>
              </div>
            ))}
          </div>
        </fieldset>

        {/* Traffic light + deadline */}
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['greenCriteria', 'hyp.f.green'],
              ['yellowCriteria', 'hyp.f.yellow'],
              ['redCriteria', 'hyp.f.red'],
            ] as const
          ).map(([field, key]) => (
            <div key={field}>
              <label className={label} htmlFor={`hyp-${field}`}>
                {t(key)}
              </label>
              <textarea
                id={`hyp-${field}`}
                rows={2}
                className={`${input} min-h-14 resize-none`}
                value={d[field]}
                onChange={(e) => set(field, e.target.value)}
              />
              <FieldError>{shownErrors[field]}</FieldError>
            </div>
          ))}
        </div>
        <div className="max-w-40">
          <label className={label} htmlFor="hyp-deadline">
            {t('hyp.f.deadline')}
          </label>
          <input
            id="hyp-deadline"
            type="number"
            min={1}
            className={input}
            value={d.deadlineDays}
            onChange={(e) => set('deadlineDays', Number(e.target.value))}
          />
          <FieldError>{shownErrors.deadlineDays}</FieldError>
        </div>

        {/* Evidence */}
        {d.evidence.length > 0 && (
          <div>
            <span className={label}>{t('hyp.f.evidence')}</span>
            <ul className="list-inside list-disc text-xs text-muted">
              {d.evidence.map((ev, i) => (
                <li key={i}>{ev.note ?? ev.slice ?? ev.type}</li>
              ))}
            </ul>
          </div>
        )}

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
            data-testid="hyp-save"
            className="btn-primary"
            disabled={!valid || busy}
            onClick={() => void save()}
          >
            {busy ? t('hyp.saving') : t('hyp.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
