import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { RefreshCw } from 'lucide-react';
import { useFilters } from '../../store/filters';
import { useT, ago } from '../../i18n';
import { LiveDot } from '../../components/ui';
import { ApiError } from '../../lib/api';

/** Live-mode controls shared by the real-time pages: auto-refresh and test-traffic toggle. */
export const useLiveCtl = create<{
  paused: boolean;
  includeTest: boolean;
  togglePaused: () => void;
  toggleTest: () => void;
}>((set) => ({
  paused: false,
  includeTest: false,
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  toggleTest: () => set((s) => ({ includeTest: !s.includeTest })),
}));

/** Query params for live endpoints from the global period filter. */
export function useLiveParams(): {
  from: string;
  to: string;
  test: boolean;
  refetchInterval: number | false;
} {
  const { from, to } = useFilters();
  const { paused, includeTest } = useLiveCtl();
  return { from, to, test: includeTest, refetchInterval: paused ? false : 60_000 };
}

/** Header strip: live dot, "updated N s ago", pause/resume, test-traffic switch, manual refresh. */
export function LiveBar({
  updatedAt,
  onRefresh,
  fetching,
}: {
  updatedAt?: string;
  onRefresh: () => void;
  fetching?: boolean;
}): JSX.Element {
  const { t, locale } = useT();
  const { paused, togglePaused, includeTest, toggleTest } = useLiveCtl();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span className="inline-flex items-center gap-2">
        <LiveDot paused={paused} />
        {updatedAt ? t('common.updated', { ago: ago(updatedAt, locale) }) : t('common.loading')}
      </span>
      <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={togglePaused}>
        {paused ? t('live.resume') : t('live.pause')}
      </button>
      <button
        type="button"
        className="btn-ghost px-2.5 py-1 text-xs"
        onClick={onRefresh}
        aria-label="refresh"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${fetching ? 'animate-spin' : ''}`} />
      </button>
      <label className="inline-flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" checked={includeTest} onChange={toggleTest} />
        {t('live.testTraffic')}
      </label>
    </div>
  );
}

/** True when the API says Metrika is not configured yet (409 METRIKA_NOT_CONFIGURED). */
export function isNotConfigured(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

export function NotConfigured(): JSX.Element {
  const { t } = useT();
  return <div className="card p-6 text-sm text-muted">{t('live.notConfigured')}</div>;
}
