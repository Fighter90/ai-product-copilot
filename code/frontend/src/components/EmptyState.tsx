import { useT } from '../i18n';

/** Informative empty state for pages with no data in the selected period. */
export function EmptyState({ message }: { message?: string }): JSX.Element {
  const { t } = useT();
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
    >
      {message ?? t('an.empty')}
    </div>
  );
}
