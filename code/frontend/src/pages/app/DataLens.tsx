import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Send } from 'lucide-react';
import { v3 } from '../../lib/api-v3';
import { useT } from '../../i18n';
import { useFilters } from '../../store/filters';
import { useAuth } from '../../auth/AuthContext';
import { Card, ErrorBox, PageHeader, Skeleton } from '../../components/ui';

/** DataLens for everyone: download typed CSV datasets, open team dashboards, ask an admin to connect. */
export function DataLens(): JSX.Element {
  const { t, locale } = useT();
  const { from, to } = useFilters();
  const { isAdmin } = useAuth();
  const ds = useQuery({ queryKey: ['datasets'], queryFn: v3.datasets });
  const settings = useQuery({ queryKey: ['settings'], queryFn: v3.settings });
  const [note, setNote] = useState('');
  const req = useMutation({ mutationFn: () => v3.requestDatalens(note) });
  const links = (settings.data?.DATALENS_LINKS?.value ?? '')
    .split(/\s+/)
    .filter((s) => /^https?:\/\//.test(s));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Yandex DataLens"
        title={t('datalens.title')}
        subtitle={t('datalens.subtitle')}
      />
      <Card title={locale === 'ru' ? 'Наборы данных (CSV)' : 'Datasets (CSV)'}>
        <p className="mb-4 text-sm text-muted">
          {locale === 'ru'
            ? `Период: ${from} — ${to}. Файл UTF-8, разделитель — запятая, первая строка — заголовки. В DataLens: «Подключения» → «Файлы» → загрузить CSV → создать датасет.`
            : `Period: ${from} — ${to}. UTF-8, comma-separated, header row. In DataLens: Connections → Files → upload CSV → create a dataset.`}
        </p>
        {ds.isLoading && <Skeleton className="h-40" />}
        {ds.error && <ErrorBox error={ds.error} />}
        <div className="grid gap-3 md:grid-cols-2">
          {(ds.data ?? []).map((d) => (
            <div key={d.id} className="rounded-lg border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{locale === 'ru' ? d.ru : d.en}</div>
                  <code className="text-xs text-muted">{d.id}.csv</code>
                </div>
                <a
                  className="btn-primary px-3 py-1.5 text-xs"
                  href={`/api/integrations/datalens/export/${d.id}?from=${from}&to=${to}&lang=${locale}`}
                >
                  <Download className="h-3.5 w-3.5" /> {t('datalens.download')}
                </a>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {d.columns.map((c) => (
                  <span key={c.name} className="chip text-[10px]" title={c.type}>
                    {locale === 'ru' ? c.ru : c.en} · <span className="text-muted">{c.type}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title={locale === 'ru' ? 'Сырые данные Метрики напрямую' : 'Raw Metrika data directly'}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            {locale === 'ru'
              ? 'DataLens → «Подключения» → «Яндекс Метрика».'
              : 'DataLens → Connections → “Yandex Metrica”.'}
          </li>
          <li>
            {locale === 'ru'
              ? 'Авторизуйтесь аккаунтом с доступом к счётчику 54280963.'
              : 'Sign in with an account that can read counter 54280963.'}
          </li>
          <li>
            {locale === 'ru'
              ? 'Создайте датасеты «Визиты» и «Цели»; цели pc-goals — по названиям G-01…G-18.'
              : 'Create “Visits” and “Goals” datasets; pc-goals goals are named G-01…G-18.'}
          </li>
        </ol>
      </Card>
      {links.length > 0 && (
        <Card title={t('datalens.dashboards')}>
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l}>
                <a
                  href={l}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                >
                  {l} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!isAdmin && (
        <Card title={t('datalens.request')}>
          {req.isSuccess ? (
            <p className="text-sm text-green-700">{t('datalens.requested')}</p>
          ) : (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                req.mutate();
              }}
            >
              <input
                className="input flex-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  locale === 'ru'
                    ? 'Что нужно: какой дашборд, какие данные…'
                    : 'What you need: which dashboard, which data…'
                }
              />
              <button type="submit" className="btn-primary" disabled={req.isPending}>
                <Send className="h-4 w-4" /> {t('assistant.send')}
              </button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
