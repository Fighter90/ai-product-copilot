import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, RotateCw } from 'lucide-react';
import { v3 } from '../../lib/api-v3';
import { useT, fmtDate } from '../../i18n';
import { Card, ErrorBox, PageHeader, Pill, Skeleton } from '../../components/ui';

/** Admin: DataLens webhook receiver (URL, confirmation code, events) and dashboard links. */
export function Integrations(): JSX.Element {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['datalens-admin'],
    queryFn: v3.datalensAdmin,
    refetchInterval: 5000,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: v3.settings });
  const [links, setLinks] = useState('');
  useEffect(() => setLinks(settings.data?.DATALENS_LINKS?.value ?? ''), [settings.data]);
  const rotate = useMutation({
    mutationFn: v3.rotateDatalensToken,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['datalens-admin'] }),
  });
  const saveLinks = useMutation({
    mutationFn: () => v3.saveSettings({ DATALENS_LINKS: links }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const url = q.data?.token
    ? `${window.location.origin}/api/integrations/datalens/webhook/${q.data.token}`
    : '';

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('nav.section.admin')} title={t('admin.datalens.title')} />
      {q.error && <ErrorBox error={q.error} />}
      <Card title={t('admin.datalens.webhook')}>
        {q.isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="space-y-3">
            {url ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md bg-raised px-3 py-2 text-xs">
                  {url}
                </code>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void navigator.clipboard?.writeText(url)}
                >
                  <Copy className="h-4 w-4" /> {t('common.copy')}
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {locale === 'ru' ? 'URL ещё не выпущен.' : 'No URL issued yet.'}
              </p>
            )}
            <button type="button" className="btn-primary" onClick={() => rotate.mutate()}>
              <RotateCw className="h-4 w-4" /> {t('admin.datalens.rotate')}
            </button>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>
                {locale === 'ru'
                  ? 'DataLens → Настройки → Уведомления → Вебхуки → «Добавить вебхук».'
                  : 'DataLens → Settings → Notifications → Webhooks → “Add webhook”.'}
              </li>
              <li>
                {locale === 'ru'
                  ? 'Вставьте URL выше и нажмите «Получить код».'
                  : 'Paste the URL above and click “Get code”.'}
              </li>
              <li>
                {locale === 'ru'
                  ? 'Код появится ниже через несколько секунд — введите его в DataLens.'
                  : 'The code appears below within seconds — enter it in DataLens.'}
              </li>
            </ol>
          </div>
        )}
      </Card>
      <Card title={t('admin.datalens.lastCode')}>
        {q.data?.lastCode ? (
          <div className="flex items-center gap-3">
            <code className="rounded-md bg-accent/10 px-4 py-2 font-mono text-2xl font-bold tracking-widest text-accent">
              {q.data.lastCode.code}
            </code>
            <span className="text-xs text-muted">
              {fmtDate(q.data.lastCode.receivedAt, locale, true)}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted">—</p>
        )}
      </Card>
      <Card title={t('admin.datalens.events')}>
        {(q.data?.events ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t('admin.datalens.noEvents')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {q.data!.events.map((e) => (
              <li key={e.id} className="py-2">
                <div className="flex items-center gap-2">
                  <Pill tone={e.kind === 'confirmation' ? 'accent' : 'neutral'}>{e.kind}</Pill>
                  <span className="text-xs text-muted">{fmtDate(e.receivedAt, locale, true)}</span>
                </div>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-raised p-2 text-[11px]">
                  {e.payload}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('admin.datalens.links')}>
        <textarea
          className="input min-h-[100px] font-mono text-xs"
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          placeholder="https://datalens.ru/..."
        />
        <button type="button" className="btn-primary mt-3" onClick={() => saveLinks.mutate()}>
          {t('common.save')}
        </button>
      </Card>
    </div>
  );
}
