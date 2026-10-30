import { useEffect, useState } from 'react';
import { useT } from '../i18n';

/**
 * ANA-112 (REG-19): when the Metrika per-user API quota is exhausted, live endpoints return 429
 * and the page would silently show stale data. `lib/api.ts` dispatches `pca:metrika-quota` on
 * such responses (throttled to once per 30 s) — this banner informs the user that what they see
 * is the last saved snapshot. Auto-hides after 2 minutes or on dismiss.
 */
export function QuotaBanner(): JSX.Element | null {
  const { t } = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = (): void => setVisible(true);
    window.addEventListener('pca:metrika-quota', show);
    return () => window.removeEventListener('pca:metrika-quota', show);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 120_000);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      role="status"
      data-testid="quota-banner"
      className="flex items-center gap-2 border-b border-line bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
    >
      <span className="flex-1">{t('quota.banner')}</span>
      <button
        type="button"
        aria-label={t('quota.dismiss')}
        className="text-xs underline"
        onClick={() => setVisible(false)}
      >
        {t('quota.dismiss')}
      </button>
    </div>
  );
}
