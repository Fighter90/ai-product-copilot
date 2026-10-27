import { AlertTriangle, Sparkles } from 'lucide-react';
import { useT } from '../../i18n';

/**
 * Provenance badges of a hypothesis (ANA-38): «AI» + provider/model for imported hypotheses, and
 * a warning badge listing the AI-cited numbers that are absent from the snapshot facts.
 */
export function SourceBadge({
  source,
  aiProvider,
  aiModel,
}: {
  source?: 'manual' | 'ai';
  aiProvider?: string;
  aiModel?: string;
}): JSX.Element {
  const { t } = useT();
  if (source !== 'ai') return <span />;
  const label = [aiProvider, aiModel].filter(Boolean).join(' · ');
  return (
    <span
      title={label || undefined}
      className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent"
    >
      <Sparkles className="h-3 w-3" aria-hidden />
      {t('hyp.source.ai')}
    </span>
  );
}

/** Warning badge for AI-cited numbers that do not exist in the data slice (ANA-38). */
export function UnverifiedBadge({ numbers }: { numbers?: readonly string[] }): JSX.Element | null {
  const { t } = useT();
  if (!numbers || numbers.length === 0) return null;
  return (
    <span
      role="status"
      title={t('hyp.ai.unverified', { numbers: numbers.join(', ') })}
      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden />
      {t('hyp.ai.unverifiedBadge')}
    </span>
  );
}
