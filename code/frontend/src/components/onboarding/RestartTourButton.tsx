import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n';
import { restartTour } from './tour';

/** «Пройти тур заново» (Help): clears the tour flag and opens the cabinet where the tour starts. */
export function RestartTourButton({ className = '' }: { className?: string }): JSX.Element {
  const { t } = useT();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        restartTour();
        navigate('/app');
      }}
      className={`rounded-md border border-accent/50 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10 ${className}`}
    >
      {t('hint.tour.restart')}
    </button>
  );
}
