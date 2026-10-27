import { useT } from '../../i18n';
import { InfoHint } from '../InfoHint';

/**
 * Chart explanation collapsed into a single «i» popover next to the chart title (ANA-47): what the
 * chart shows correctly, a data caveat and a recommendation. These lines describe the chart, not
 * the data, so they live behind the icon instead of a text block under every chart — only
 * data-driven insights stay visible on the screen.
 */
export interface ChartCaptionProps {
  /** What the chart correctly represents and where the numbers trace to. */
  readonly correct: string;
  /** A data caveat or known limitation. Omit when there is nothing to flag. */
  readonly caveat?: string;
  /** A concrete next action for the reader. */
  readonly advice: string;
  /** Popover alignment; use `end` for icons near the right edge of a card. */
  readonly align?: 'center' | 'start' | 'end';
}

export function ChartCaption({ correct, caveat, advice, align }: ChartCaptionProps): JSX.Element {
  const { t } = useT();
  return (
    <InfoHint
      label={t('hint.chartInfo')}
      align={align ?? 'start'}
      className="ml-1"
      text={
        <span data-testid="chart-caption" className="block space-y-1.5">
          <span className="block">
            <span className="font-medium text-green-700">{`🟢 ${t('cap.correct')}`}</span>{' '}
            <span>{correct}</span>
          </span>
          {caveat ? (
            <span className="block">
              <span className="font-medium text-red-700">{`🔴 ${t('cap.caveat')}`}</span>{' '}
              <span>{caveat}</span>
            </span>
          ) : null}
          <span className="block">
            <span className="font-medium text-indigo-700">{`💡 ${t('cap.advice')}`}</span>{' '}
            <span>{advice}</span>
          </span>
        </span>
      }
    />
  );
}
