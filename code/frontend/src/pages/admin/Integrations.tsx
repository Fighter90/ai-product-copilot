import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, PlugZap, RotateCw, XCircle } from 'lucide-react';
import { v3, type SettingView } from '../../lib/api-v3';
import { ApiError } from '../../lib/api';
import { useT, fmtDate } from '../../i18n';
import { Card, ErrorBox, PageHeader, Pill, Skeleton } from '../../components/ui';

type CheckResult = { ok: boolean; message: string; workbookTitle?: string };

/** Pull a readable message out of an ApiError whose body is the backend's JSON. */
function checkErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const j = JSON.parse(err.message) as { message?: string; error?: string };
      return j.message ?? j.error ?? err.message;
    } catch {
      return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** DataLens Public API connection: org id, workbook id, IAM token (secret) + live check. */
export function DataLensConnectionCard({
  settings,
}: {
  settings: Record<string, SettingView> | undefined;
}): JSX.Element {
  const { t } = useT();
  const qc = useQueryClient();
  const [orgId, setOrgId] = useState('');
  const [workbookId, setWorkbookId] = useState('');
  const [iam, setIam] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  useEffect(() => {
    setOrgId(settings?.DATALENS_ORG_ID?.value ?? '');
    setWorkbookId(settings?.DATALENS_WORKBOOK_ID?.value ?? '');
  }, [settings]);
  const currentIam = settings?.DATALENS_IAM_TOKEN?.value ?? '';

  const save = useMutation({
    mutationFn: () =>
      v3.saveSettings({
        DATALENS_ORG_ID: orgId.trim(),
        DATALENS_WORKBOOK_ID: workbookId.trim(),
        // Empty IAM field = keep the stored token.
        ...(iam.trim() ? { DATALENS_IAM_TOKEN: iam.trim() } : {}),
      }),
    onSuccess: (r) => {
      setIam('');
      setResult(null);
      setMsg(t('admin.datalens.conn.saved', { keys: r.changed.join(', ') || '—' }));
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const check = useMutation({
    mutationFn: v3.checkDatalens,
    onSuccess: (r) => setResult(r),
    onError: (err) => setResult({ ok: false, message: checkErrorMessage(err) }),
  });

  const source = (key: string) => <Pill tone="neutral">{settings?.[key]?.source ?? 'unset'}</Pill>;

  return (
    <Card title={t('admin.datalens.conn.title')}>
      <p className="mb-4 text-sm text-muted">
        {t('admin.datalens.conn.subtitle')}{' '}
        <Link to="/help/datalens" className="text-accent hover:underline">
          {t('admin.datalens.conn.help')}
        </Link>
      </p>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="block">
          <span className="label flex items-center gap-2">
            {t('admin.datalens.conn.orgId')} {source('DATALENS_ORG_ID')}
          </span>
          <input
            className="input font-mono"
            autoComplete="off"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted">{t('admin.datalens.conn.orgHint')}</span>
        </label>
        <label className="block">
          <span className="label flex items-center gap-2">
            {t('admin.datalens.conn.workbookId')} {source('DATALENS_WORKBOOK_ID')}
          </span>
          <input
            className="input font-mono"
            autoComplete="off"
            value={workbookId}
            onChange={(e) => setWorkbookId(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted">
            {t('admin.datalens.conn.workbookHint')}
          </span>
        </label>
        <label className="block md:col-span-2">
          <span className="label flex items-center gap-2">
            {t('admin.datalens.conn.iam')} {source('DATALENS_IAM_TOKEN')}
            {currentIam && <code className="text-xs text-muted">{currentIam}</code>}
          </span>
          <input
            className="input font-mono"
            type="password"
            autoComplete="new-password"
            placeholder={currentIam || t('admin.datalens.conn.iamKeep')}
            value={iam}
            onChange={(e) => setIam(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted">
            {t('admin.datalens.conn.iamKeep')}. {t('admin.datalens.conn.iamHint')}
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {t('common.save')}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={check.isPending}
            onClick={() => check.mutate()}
          >
            <PlugZap className="h-4 w-4" />
            {check.isPending ? t('admin.datalens.conn.checking') : t('admin.datalens.conn.check')}
          </button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
        {save.error && (
          <div className="md:col-span-2">
            <ErrorBox error={save.error} />
          </div>
        )}
        {result && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs md:col-span-2 ${result.ok ? 'border-green-300 text-green-700' : 'border-red-300 text-red-700'}`}
          >
            {result.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="break-all">
              {result.message}
              {result.workbookTitle && (
                <span className="ml-2">
                  · {t('admin.datalens.conn.workbook', { title: result.workbookTitle })}
                </span>
              )}
            </span>
          </div>
        )}
      </form>
    </Card>
  );
}

/** Admin: DataLens API connection, webhook receiver (URL, code, events) and dashboard links. */
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
      <DataLensConnectionCard settings={settings.data} />
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
