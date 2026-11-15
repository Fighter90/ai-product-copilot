import { assessHypothesisAutonomy, type HypothesisSource } from '@pca/shared';
import { useT, type DictKey } from '../../i18n';
import { Pill } from '../ui';

/**
 * ANA-157: autonomy badges of an AI hypothesis — the level it runs at (tooltip = the level's
 * meaning) and, since the verification verdict (green/yellow/red) always belongs to the PM,
 * the escalation marker. Manual hypotheses render nothing.
 */
export function HypothesisAutonomyBadges({
  source,
}: {
  source?: HypothesisSource;
}): JSX.Element | null {
  const { t } = useT();
  const autonomy = source === 'ai' ? assessHypothesisAutonomy({ source }) : null;
  if (autonomy === null) return null;
  return (
    <>
      <Pill tone="accent" title={t(`hyp.autonomy.level.${autonomy.level}` as DictKey)}>
        {autonomy.level}
      </Pill>
      <Pill tone="amber" title={t('hyp.autonomy.pmRequired', { level: autonomy.level })}>
        {t('hyp.autonomy.escalation')}
      </Pill>
    </>
  );
}
