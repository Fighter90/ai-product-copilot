import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { iceScore, type Hypothesis, type HypothesisStatus } from '@pca/shared';
import { useT, fmtDate, fmtNum, type DictKey } from '../../i18n';
import { Modal, Pill } from '../ui';
import { SourceBadge, UnverifiedBadge } from './SourceBadge';
import { HypothesisAutonomyBadges } from './AutonomyBadges';
import { StatusSelect } from './StatusSelect';
import { CATEGORY_KEY, METHOD_TYPE_KEY, STATUS_KEY, statusTone } from './labels';

/**
 * ANA-152: read-only «Посмотреть» popup. The kanban card shows only a small title, so the
 * full hypothesis — format sentence, description with the AI problem formula (trouble),
 * evidence quotes from the report, ICE with the rationales that were tooltip-only before,
 * assumptions, validation methods, traffic light, deadline and provenance — opens here.
 * «Редактировать» hands over to the existing HypothesisEditor: the form is not duplicated.
 * ANA-157: AI hypotheses show the autonomy badges; with a status handler the popup carries
 * the same restricted status select as the card (verdicts disabled for AI until PM).
 */

const label = 'mb-1 block text-xs font-semibold text-muted';

/** One labeled read-only row; the fixed label column keeps values aligned on a 390px phone. */
function Row({ label: head, children }: { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
      <span className="text-xs font-semibold text-muted">{head}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function HypothesisViewModal({
  hypothesis,
  onClose,
  onEdit,
  onStatusChange,
}: {
  hypothesis: Hypothesis;
  onClose: () => void;
  /** ANA-152: «Редактировать» opens the existing editor — no form duplication. */
  onEdit: (h: Hypothesis) => void;
  /** ANA-157: when provided, the popup carries the (autonomy-restricted) status select. */
  onStatusChange?: (h: Hypothesis, status: HypothesisStatus) => void;
}): JSX.Element {
  const { t, locale } = useT();
  const h = hypothesis;
  const sentence =
    `${h.subject} ${h.action} ${h.solution}` +
    (h.condition ? `${t('hyp.sentenceIf')}${h.condition}` : '');
  const rationales = [
    { value: h.impact, key: 'hyp.f.impact' as DictKey, text: h.impactRationale },
    { value: h.confidence, key: 'hyp.f.confidence' as DictKey, text: h.confidenceRationale },
    { value: h.ease, key: 'hyp.f.ease' as DictKey, text: h.easeRationale },
  ];
  const traffic = [
    { field: h.greenCriteria, key: 'hyp.f.green' as DictKey },
    { field: h.yellowCriteria, key: 'hyp.f.yellow' as DictKey },
    { field: h.redCriteria, key: 'hyp.f.red' as DictKey },
  ];

  return (
    <Modal open size="lg" title={t('hyp.view.title')} onClose={onClose}>
      <div
        data-testid="hyp-view-modal"
        className="max-h-[70vh] space-y-3 overflow-y-auto overflow-x-hidden pr-1 text-sm"
      >
        <p
          data-testid="hyp-view-title"
          className="break-words text-base font-semibold leading-snug"
        >
          {h.title}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={h.kind === 'problem' ? 'amber' : 'accent'}>
            {t(h.kind === 'problem' ? 'hyp.kind.problem' : 'hyp.kind.solution')}
          </Pill>
          <Pill tone={statusTone(h.status)}>{t(STATUS_KEY[h.status])}</Pill>
          <SourceBadge source={h.source} aiProvider={h.aiProvider} aiModel={h.aiModel} />
          {/* ANA-157: the autonomy badges (level + escalation) on AI hypotheses. */}
          <HypothesisAutonomyBadges source={h.source} />
          <UnverifiedBadge numbers={h.unverifiedNumbers} />
        </div>

        {/* ANA-157: the popup's status select, restricted by the autonomy matrix for AI. */}
        {onStatusChange !== undefined && (
          <StatusSelect
            status={h.status}
            source={h.source}
            onChange={(status) => onStatusChange(h, status)}
          />
        )}

        {sentence.trim() !== '' && (
          <p className="rounded-md border border-line bg-raised px-3 py-2 italic text-muted">
            {sentence}
          </p>
        )}

        <div className="space-y-2">
          <Row label={t('hyp.f.subject')}>{h.subject !== '' ? h.subject : '—'}</Row>
          <Row label={t('hyp.f.action')}>{h.action !== '' ? h.action : '—'}</Row>
          <Row label={t('hyp.f.solution')}>{h.solution !== '' ? h.solution : '—'}</Row>
          <Row label={t('hyp.f.condition')}>{h.condition !== '' ? h.condition : '—'}</Row>
          {h.description !== undefined && h.description !== '' && (
            <Row label={t('hyp.view.description')}>{h.description}</Row>
          )}
        </div>

        {h.evidence !== undefined && h.evidence.length > 0 && (
          <div>
            <span className={label}>{t('hyp.f.evidence')}</span>
            <ul className="list-inside list-disc text-xs text-muted">
              {h.evidence.map((ev, i) => (
                <li key={i} className="break-words">
                  {ev.note ?? ev.slice ?? ev.type}
                </li>
              ))}
            </ul>
          </div>
        )}

        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold text-muted">
            {t('hyp.f.ice')} = {fmtNum(iceScore(h.impact, h.confidence, h.ease), locale)}
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {rationales.map((r) => (
              <div key={r.key} className="min-w-0">
                <p className="text-xs font-semibold text-muted">
                  {t(r.key)}: {r.value}
                </p>
                {r.text !== '' && (
                  <p className="mt-0.5 break-words text-xs text-muted">
                    <span className="font-semibold">{t('hyp.f.rationale')}</span>: {r.text}
                  </p>
                )}
              </div>
            ))}
          </div>
        </fieldset>

        {h.hiddenAssumptions.length > 0 && (
          <div>
            <span className={label}>{t('hyp.view.assumptions')}</span>
            <ul className="list-inside list-disc space-y-0.5">
              {h.hiddenAssumptions.map((a, i) => (
                <li key={i} className="break-words">
                  <span className="text-xs font-semibold text-muted">
                    {t(CATEGORY_KEY[a.category])}:
                  </span>{' '}
                  {a.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {h.validationMethods.length > 0 && (
          <div>
            <span className={label}>{t('hyp.view.methods')}</span>
            <ul className="list-inside list-disc space-y-0.5">
              {h.validationMethods.map((m, i) => (
                <li key={i} className="break-words">
                  <span className="text-xs font-semibold text-muted">
                    {t(METHOD_TYPE_KEY[m.type])}:
                  </span>{' '}
                  {m.plan}
                </li>
              ))}
            </ul>
          </div>
        )}

        {traffic.some((x) => x.field !== '') && (
          <div>
            <span className={label}>{t('hyp.view.traffic')}</span>
            <div className="space-y-0.5">
              {traffic
                .filter((x) => x.field !== '')
                .map((x) => (
                  <p key={x.key} className="break-words">
                    <span className="text-xs font-semibold text-muted">{t(x.key)}:</span> {x.field}
                  </p>
                ))}
            </div>
          </div>
        )}

        <Row label={t('hyp.f.deadline')}>
          {t('hyp.deadlineIn', { n: h.deadlineDays })} · {fmtDate(h.deadlineAt, locale)}
        </Row>

        {/* ANA-158: flex-wrap keeps the button row inside the popup on a 390px phone. */}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            data-testid="hyp-view-close"
            className="btn-ghost"
            onClick={onClose}
          >
            {t('hyp.view.close')}
          </button>
          <button
            type="button"
            data-testid="hyp-view-edit"
            className="btn-primary"
            onClick={() => onEdit(h)}
          >
            <Pencil className="h-4 w-4" aria-hidden /> {t('hyp.edit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
