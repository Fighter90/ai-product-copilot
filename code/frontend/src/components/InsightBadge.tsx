export type InsightType = 'good' | 'warning' | 'info';

const COLORS: Record<InsightType, string> = {
  good: 'bg-green-100 text-green-800',
  warning: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
};
const ICONS: Record<InsightType, string> = { good: '✅', warning: '⚠️', info: 'ℹ️' };

/**
 * Insight pill (green / red / blue). The text is already localised by the caller via
 * `t('ins.…', vars)`; `icon` overrides the default emoji for the type.
 */
export function InsightBadge({
  type,
  text,
  icon,
}: {
  type: InsightType;
  text: string;
  icon?: string;
}): JSX.Element {
  return (
    // БАГ-16: длинные URL в наблюдениях переносятся, а не растягивают страницу.
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs [overflow-wrap:anywhere] ${COLORS[type]}`}
    >
      <span className="mr-1 shrink-0">{icon ?? ICONS[type]}</span> {text}
    </span>
  );
}
