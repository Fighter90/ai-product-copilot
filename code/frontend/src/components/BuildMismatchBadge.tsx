import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { http } from '../lib/api';
import {
  FRONTEND_BUILD,
  buildMismatch,
  type BackendBuild,
  type BuildInfo,
} from '../lib/build-info';
import { useT } from '../i18n';

let warned = '';

/** Test hook: forget which mismatch was already logged. */
export function resetBuildMismatchWarning(): void {
  warned = '';
}

/**
 * Backend build state shared by the badge and the banner (one deduped request per query key).
 * REG-15: an open tab polls `/api/health` every 5 minutes so it learns about a new deploy
 * without a reload; `buildMismatch` treats unknown sides as a match.
 */
function useBackendBuild() {
  return useQuery({
    queryKey: ['health', 'build'],
    queryFn: () => http<BackendBuild>('/health'),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000, // REG-15
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/**
 * ANA-43: compares the frontend bundle with `GET /api/health` (version + BUILD_SHA). On a mismatch
 * (a stale cached bundle after a deploy, or a half-finished deploy) logs a console warning once and
 * shows a small badge next to the version; renders nothing otherwise.
 */
export function BuildMismatchBadge({
  frontend = FRONTEND_BUILD,
}: {
  frontend?: BuildInfo;
}): JSX.Element | null {
  const { t } = useT();
  const health = useBackendBuild();
  const mismatch = buildMismatch(frontend, health.data);

  useEffect(() => {
    if (!mismatch) return;
    const sig = `${mismatch.field}:${mismatch.frontend}:${mismatch.backend}`;
    if (warned === sig) return;
    warned = sig;
    console.warn(
      `[build] frontend ${mismatch.field} ${mismatch.frontend} != backend ${mismatch.backend} — reload the page to get the current bundle.`,
    );
  }, [mismatch]);

  if (!mismatch) return null;
  const text = t('hint.build.mismatch', { front: mismatch.frontend, back: mismatch.backend });
  return (
    <span
      role="status"
      title={text}
      data-testid="build-mismatch"
      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {t('hint.build.badge')}
      <span className="sr-only">{text}</span>
    </span>
  );
}

/**
 * REG-15: non-blocking «Доступна новая версия — обновите страницу» banner for a stale tab after a
 * deploy. Same mismatch rules as the badge; no auto-reload — the user reloads themselves.
 */
export function BuildMismatchBanner({
  frontend = FRONTEND_BUILD,
}: {
  frontend?: BuildInfo;
}): JSX.Element | null {
  const { t } = useT();
  const health = useBackendBuild();
  const mismatch = buildMismatch(frontend, health.data);
  if (!mismatch) return null;
  return (
    <div
      data-testid="build-mismatch-banner"
      role="status"
      className="fixed inset-x-0 bottom-16 z-40 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg lg:bottom-4"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{t('hint.build.banner')}</span>
      <button
        type="button"
        className="btn-ghost shrink-0 px-2 py-1 text-xs"
        onClick={() => window.location.reload()}
      >
        <RefreshCw className="h-3.5 w-3.5" /> {t('hint.build.reload')}
      </button>
    </div>
  );
}
