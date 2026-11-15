import {
  assessHypothesisAutonomy,
  HYPOTHESIS_STATUSES,
  HYPOTHESIS_VERDICT_STATUSES,
  type HypothesisSource,
  type HypothesisStatus,
} from '@pca/shared';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { STATUS_KEY } from './labels';

/**
 * ANA-157: the hypothesis status select, restricted by the AI-autonomy matrix — for AI
 * hypotheses (level A1) the options above the level's maximum («В проверке») are disabled
 * with the «Требуется подтверждение PM» tooltip; manual hypotheses keep every option enabled.
 * ANA-157 (review): the cap is a PM-confirmation gate, not a dead end — the PM (admin) sees
 * every option enabled, and in the legacy single-user mode (no signed-in user) the single
 * human owner owns the verdict as well.
 * ANA-157 (review round 3): while an AI hypothesis carries a PM verdict (green/yellow/red),
 * a non-PM cannot leave it — erasing the светофор decision is itself a PM decision, so every
 * other option is blocked too (the backend refuses the transition with the same escalation).
 */
export function StatusSelect({
  status,
  source,
  onChange,
}: {
  status: HypothesisStatus;
  source?: HypothesisSource;
  onChange: (status: HypothesisStatus) => void;
}): JSX.Element {
  const { t } = useT();
  const { user, isAdmin } = useAuth();
  const mayVerdict = user === null || isAdmin;
  const autonomy = source === 'ai' && !mayVerdict ? assessHypothesisAutonomy({ source }) : null;
  return (
    <select
      aria-label={t('hyp.changeStatus')}
      className="min-w-0 max-w-full rounded border border-line bg-surface px-1 py-0.5 text-xs"
      value={status}
      onChange={(e) => onChange(e.target.value as HypothesisStatus)}
    >
      {HYPOTHESIS_STATUSES.map((s) => {
        // The currently selected option stays selectable (re-selecting it fires no change);
        // for a non-PM an AI hypothesis blocked above the cap, and — while it carries a PM
        // verdict (green/yellow/red) — every OTHER option: erasing the светофор decision is
        // itself a PM decision (the backend refuses the transition with the same escalation).
        const blocked =
          autonomy !== null &&
          s !== status &&
          (!autonomy.allowedStatuses.includes(s) || HYPOTHESIS_VERDICT_STATUSES.includes(status));
        return (
          <option
            key={s}
            value={s}
            disabled={blocked}
            title={blocked ? t('hyp.autonomy.pmRequired', { level: autonomy.level }) : undefined}
          >
            {t(STATUS_KEY[s])}
          </option>
        );
      })}
    </select>
  );
}
