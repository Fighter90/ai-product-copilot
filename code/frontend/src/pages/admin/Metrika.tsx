import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { v3, type SettingView } from '../../lib/api-v3';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { Card, ErrorBox, Modal, PageHeader, Pill, Skeleton } from '../../components/ui';
import { useFilters } from '../../store/filters';
import { GoalsManager } from '../../components/admin/goals/GoalsManager';

const FIELDS: Array<{
  key: string;
  ru: string;
  en: string;
  hintRu: string;
  hintEn: string;
  secret?: boolean;
  number?: boolean;
}> = [
  {
    key: 'COUNTER_ID',
    ru: 'Счётчик Метрики',
    en: 'Metrika counter',
    hintRu: 'ID счётчика, например 54280963',
    hintEn: 'Counter id, e.g. 54280963',
    number: true,
  },
  {
    key: 'YANDEX_OAUTH_TOKEN',
    ru: 'OAuth-токен',
    en: 'OAuth token',
    hintRu: 'Права metrika:read (и metrika:write для управления целями)',
    hintEn: 'Scopes metrika:read (+ metrika:write to manage goals)',
    secret: true,
  },
  {
    key: 'YANDEX_CLIENT_ID',
    ru: 'Client ID приложения',
    en: 'App Client ID',
    hintRu: 'Для получения токена через pnpm auth',
    hintEn: 'Used by pnpm auth to obtain a token',
  },
  {
    key: 'YANDEX_CLIENT_SECRET',
    ru: 'Client secret',
    en: 'Client secret',
    hintRu: 'Хранится зашифрованным',
    hintEn: 'Stored encrypted',
    secret: true,
  },
  {
    key: 'ORDER_GOAL_ID',
    ru: 'Цель «Заказ»',
    en: '“Order” goal',
    hintRu: 'По умолчанию — JS-событие reg_step1',
    hintEn: 'Defaults to the reg_step1 JS event',
    number: true,
  },
  {
    key: 'GOAL_ID',
    ru: 'Цель KPI для отчёта',
    en: 'Report KPI goal',
    hintRu: '0 = автоопределение при синке',
    hintEn: '0 = auto-detect at sync',
    number: true,
  },
  {
    key: 'KPI_TARGET',
    ru: 'Цель по оплатам',
    en: 'Payments target',
    hintRu: 'Например 300 билетов',
    hintEn: 'e.g. 300 tickets',
    number: true,
  },
];

/** Admin: Metrika connection, KPI goals, data sync and the danger zone. */
export function MetrikaSettings(): JSX.Element {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const { from, to } = useFilters();
  const q = useQuery({ queryKey: ['settings'], queryFn: v3.settings });
  const [form, setForm] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState('');
  const [danger, setDanger] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (q.data)
      setForm(
        Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, (v as SettingView).value])),
      );
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      v3.saveSettings(
        Object.fromEntries(
          FIELDS.map((f) => [f.key, form[f.key] ?? '']).filter(([, v]) => v !== undefined),
        ),
      ),
    onSuccess: (r) => {
      setMsg(`${t('common.save')}: ${r.changed.join(', ') || '—'}`);
      void qc.invalidateQueries();
    },
  });
  const sync = useMutation({
    mutationFn: () => api.sync({ from, to }),
    onSuccess: (r) => {
      setMsg(`Sync: ${JSON.stringify(r)}`);
      void qc.invalidateQueries();
    },
  });
  const clear = useMutation({
    mutationFn: v3.clearMetrikaData,
    onSuccess: () => {
      setDanger(false);
      setConfirm('');
      setMsg(locale === 'ru' ? 'Кэш данных Метрики очищен' : 'Metrika cache cleared');
      void qc.invalidateQueries();
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('nav.section.admin')}
        title={t('admin.metrika.title')}
        subtitle={t('admin.metrika.subtitle')}
      />
      {msg && (
        <div className="card break-all border-accent/40 p-3 text-sm" onClick={() => setMsg(null)}>
          {msg}
        </div>
      )}
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <Card title={locale === 'ru' ? 'Подключение' : 'Connection'}>
          <p className="mb-4 text-sm text-muted">
            {t('admin.metrika.oauthHelp')}{' '}
            <a
              href="https://oauth.yandex.ru/client/new"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              oauth.yandex.ru
            </a>
            {' · '}
            <Link to="/help/admin" className="text-accent hover:underline">
              {t('admin.metrika.helpLink')}
            </Link>
          </p>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="label flex items-center gap-2">
                  {f[locale]} <Pill tone="neutral">{q.data[f.key]?.source ?? 'unset'}</Pill>
                </span>
                <input
                  className={`input ${f.secret ? 'font-mono' : ''}`}
                  type={f.secret ? 'password' : f.number ? 'number' : 'text'}
                  autoComplete="off"
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
                <span className="mt-1 block text-xs text-muted">
                  {locale === 'ru' ? f.hintRu : f.hintEn}
                </span>
              </label>
            ))}
            <div className="md:col-span-2">
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {t('common.save')}
              </button>
              <span className="ml-3 text-xs text-muted">
                {locale === 'ru'
                  ? 'Применяется сразу, без перезапуска сервера.'
                  : 'Applied immediately, no server restart.'}
              </span>
            </div>
          </form>
        </Card>
      )}
      {q.data && <GoalsManager />}
      <Card title={locale === 'ru' ? 'Синхронизация в SQLite' : 'Sync to SQLite'}>
        <p className="mb-3 text-sm text-muted">
          {locale === 'ru'
            ? `Загрузить агрегаты Метрики за период фильтра ${from} — ${to}: каналы, UTM, гео/устройства, страницы входа и выхода, цели. Нужны для отчёта и страниц аналитики.`
            : `Load Metrika aggregates for ${from} — ${to}: channels, UTM, geo/devices, entry and exit pages, goals. Used by the report and analytics pages.`}
        </p>
        <button
          type="button"
          className="btn-primary"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
          {locale === 'ru' ? 'Обновить данные из Метрики' : 'Refresh data from Metrika'}
        </button>
        {sync.error && (
          <div className="mt-3">
            <ErrorBox error={sync.error} />
          </div>
        )}
      </Card>
      <Card
        title={
          <span className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-4 w-4" /> {locale === 'ru' ? 'Опасная зона' : 'Danger zone'}
          </span>
        }
        className="border-red-300"
      >
        <p className="mb-3 text-sm text-muted">
          {locale === 'ru'
            ? 'Удаляет кэш сырых ответов и производных таблиц Метрики. Отчёты, гипотезы, сделки и пользователи сохраняются.'
            : 'Deletes cached raw Metrika responses and derived tables. Reports, hypotheses, deals and users are kept.'}
        </p>
        <button type="button" className="btn-danger" onClick={() => setDanger(true)}>
          {locale === 'ru' ? 'Очистить данные Метрики' : 'Clear Metrika data'}
        </button>
      </Card>
      <Modal
        open={danger}
        title={locale === 'ru' ? 'Подтвердите удаление' : 'Confirm deletion'}
        onClose={() => setDanger(false)}
      >
        <p className="mb-3 text-sm">
          {locale === 'ru' ? 'Введите слово' : 'Type the word'}{' '}
          <code className="rounded bg-raised px-1">УДАЛИТЬ</code>
        </p>
        <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setDanger(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={confirm !== 'УДАЛИТЬ' || clear.isPending}
            onClick={() => clear.mutate()}
          >
            OK
          </button>
        </div>
      </Modal>
    </div>
  );
}
