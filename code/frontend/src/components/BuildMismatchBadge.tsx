import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
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
  const health = useQuery({
    queryKey: ['health', 'build'],
    queryFn: () => http<BackendBuild>('/health'),
    staleTime: 5 * 60_000,
    retry: false,
  });
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
