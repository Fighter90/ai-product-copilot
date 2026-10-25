import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Plug, XCircle } from 'lucide-react';
import { v3, type ProviderView } from '../../lib/api-v3';
import { useT, fmtDate } from '../../i18n';
import { Card, ErrorBox, PageHeader, Pill, Skeleton } from '../../components/ui';

function ProviderCard({ p }: { p: ProviderView }): JSX.Element {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [secret, setSecret] = useState('');
  const [model, setModel] = useState(p.model);
  const [priority, setPriority] = useState(p.priority);
  const [extras, setExtras] = useState<Record<string, string>>(
    Object.fromEntries(p.extras.map((e) => [e.key, e.value])),
  );
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(p.lastTest);
  const refresh = () => qc.invalidateQueries({ queryKey: ['providers'] });

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof v3.updateProvider>[1]) => v3.updateProvider(p.id, patch),
    onSuccess: () => {
      setSecret('');
      void refresh();
    },
  });
  const run = useMutation({
    mutationFn: () => v3.testProvider(p.id),
    onSuccess: (r) => {
      setTest(r);
      void refresh();
    },
  });

  return (
    <Card
      className={p.enabled ? 'border-accent/40' : ''}
      title={
        <span className="flex items-center gap-2">
          {p.name}
          {p.enabled ? <Pill tone="green">on</Pill> : <Pill tone="neutral">off</Pill>}
          {p.hasSecret && <Pill tone="neutral">{p.secretMask}</Pill>}
        </span>
      }
      actions={
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) => save.mutate({ enabled: e.target.checked })}
          />
          {t('admin.ai.enabled')}
        </label>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ model, priority, extra: extras, ...(secret ? { secret } : {}) });
        }}
      >
        <label className="block sm:col-span-2">
          <span className="label">
            {t('admin.ai.secret')} · {p.secretLabel}
          </span>
          <input
            type="password"
            autoComplete="off"
            className="input font-mono"
            placeholder={p.hasSecret ? `${p.secretMask} — ${t('admin.ai.secretKeep')}` : '…'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">{t('admin.ai.model')}</span>
          <input
            className="input"
            list={`models-${p.id}`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <datalist id={`models-${p.id}`}>
            {p.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="label">{t('admin.ai.priority')}</span>
          <input
            className="input"
            type="number"
            min={0}
            max={1000}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </label>
        {p.extras.map((ex) => (
          <label key={ex.key} className="block sm:col-span-2">
            <span className="label">{ex.label}</span>
            <input
              className="input"
              value={extras[ex.key] ?? ''}
              onChange={(e) => setExtras({ ...extras, [ex.key]: e.target.value })}
            />
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {t('common.save')}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={run.isPending || !p.hasSecret}
            onClick={() => run.mutate()}
          >
            <Plug className="h-4 w-4" />{' '}
            {run.isPending ? t('admin.ai.testing') : t('admin.ai.test')}
          </button>
          <a
            href={p.docs}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
          >
            docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {test && (
          <div
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs sm:col-span-2 ${test.ok ? 'border-green-300 text-green-700' : 'border-red-300 text-red-700'}`}
          >
            {test.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="break-all">
              {test.message}
              {p.lastTest?.at && (
                <span className="ml-2 text-muted">· {fmtDate(p.lastTest.at, locale, true)}</span>
              )}
            </span>
          </div>
        )}
      </form>
    </Card>
  );
}

/** Admin: AI providers (OpenRouter, Anthropic, YandexGPT, GigaChat) — keys, models, fallback order. */
export function AiProviders(): JSX.Element {
  const { t } = useT();
  const q = useQuery({ queryKey: ['providers'], queryFn: v3.providers });
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: v3.aiUsage });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('nav.section.admin')}
        title={t('admin.ai.title')}
        subtitle={t('admin.ai.subtitle')}
      />
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <ErrorBox error={q.error} />}
      <div className="grid gap-4 xl:grid-cols-2">
        {q.data?.map((p) => (
          <ProviderCard key={`${p.id}-${p.updatedAt}`} p={p} />
        ))}
      </div>
      <Card title={t('admin.ai.usage')}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(usage.data ?? []).map((u) => (
            <div key={u.provider} className="rounded-lg border border-line p-3">
              <div className="text-xs uppercase tracking-wide text-muted">{u.provider}</div>
              <div className="mt-1 text-2xl font-bold">{u.calls}</div>
              <div className="text-xs text-muted">
                {t('admin.ai.calls')} · {u.failures} {t('admin.ai.failures')}
              </div>
            </div>
          ))}
          {(usage.data ?? []).length === 0 && <div className="text-sm text-muted">—</div>}
        </div>
      </Card>
    </div>
  );
}
