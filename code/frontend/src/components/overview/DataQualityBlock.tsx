import type { ReactNode } from 'react';
import { useT } from '../../i18n';

/**
 * ANA-48: all data-quality notices (auto-detected KPI goal, low UTM coverage, …) collapsed into one
 * «Качество данных (N)» block below the KPI strip, so they never push the KPIs below the fold.
 * Renders nothing when there are no notices.
 */
export function DataQualityBlock({
  items,
}: {
  items: ReadonlyArray<{ key: string; node: ReactNode }>;
}): JSX.Element | null {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <details
      data-testid="data-quality"
      className="group rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <summary className="cursor-pointer select-none font-medium">
        <span aria-hidden="true">⚠️ </span>
        {t('ov.quality.title', { n: items.length })}
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {items.map((i) => (
          <li key={i.key}>{i.node}</li>
        ))}
      </ul>
    </details>
  );
}
