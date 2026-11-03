import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { v3, type SettingView } from '../../lib/api-v3';
import { api } from '../../lib/api';
import { useT, type DictKey } from '../../i18n';
import { Card, ErrorBox, Modal, PageHeader, Pill, Skeleton } from '../../components/ui';
import { useFilters } from '../../store/filters';
import { GoalsManager } from '../../components/admin/goals/GoalsManager';

const FIELDS: Array<{
  key: string;
  labelKey: DictKey;
  hintKey: DictKey;
  secret?: boolean;
  number?: boolean;
  textarea?: boolean;
}> = [
  {
    key: 'COUNTER_ID',
    labelKey: 'i18n.mk.counter.label',
    hintKey: 'i18n.mk.counter.hint',
    number: true,
  },
  {
    key: 'YANDEX_OAUTH_TOKEN',
    labelKey: 'i18n.mk.token.label',
    hintKey: 'i18n.mk.token.hint',
    secret: true,
  },
  {
    key: 'YANDEX_CLIENT_ID',
    labelKey: 'i18n.mk.clientId.label',
    hintKey: 'i18n.mk.clientId.hint',
  },
  {
    key: 'YANDEX_CLIENT_SECRET',
    labelKey: 'i18n.mk.clientSecret.label',
    hintKey: 'i18n.mk.clientSecret.hint',
    secret: true,
  },
  {
    key: 'ORDER_GOAL_ID',
    labelKey: 'i18n.mk.orderGoal.label',
    hintKey: 'i18n.mk.orderGoal.hint',
    number: true,
  },
  {
    key: 'GOAL_ID',
    labelKey: 'i18n.mk.kpiGoal.label',
    hintKey: 'i18n.mk.kpiGoal.hint',
    number: true,
  },
  {
    key: 'KPI_TARGET',
    labelKey: 'i18n.mk.kpiTarget.label',
    hintKey: 'i18n.mk.kpiTarget.hint',
    number: true,
  },
  {
    // ANA-75 (БАГ-01): дата события — единый дедлайн KPI (Обзор, /app/kpi, прогноз, отчёт);
    // пусто → эвристика «конец периода + 2 длины периода» с оговоркой в UI.
    key: 'EVENT_DATE',
    labelKey: 'i18n.mk.eventDate.label',
    hintKey: 'i18n.mk.eventDate.hint',
  },
  {
    // ANA-22: the admin's test-page/UTM pattern list — excluded from every sync query.
    key: 'TEST_TRAFFIC_PATTERNS',
    labelKey: 'dh.mk.testPatterns.label',
    hintKey: 'dh.mk.testPatterns.hint',
    textarea: true,
  },
];

/** Admin: Metrika connection, KPI goals, data sync and the danger zone. */
/** ANA-107: резервный аккаунт Метрики — независимая суточная квота. При исчерпании основной
 * клиент автоматически уходит на резервный токен. Флоу: ввести ClientID/Secret → открыть
 * ссылку авторизации под резервным аккаунтом → вставить код из redirect → «Обменять». */
export function MetrikaBackupAccount(): JSX.Element {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => v3.settings(),
    retry: false,
  });
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) {
      setClientId(q.data.METRIKA_BACKUP_CLIENT_ID?.value ?? '');
    }
  }, [q.data]);

  const savedSecret = Boolean(q.data?.METRIKA_BACKUP_CLIENT_SECRET?.value);
  const savedToken = Boolean(q.data?.METRIKA_BACKUP_OAUTH_TOKEN?.value);

  const saveCreds = useMutation({
    mutationFn: () =>
      v3.saveSettings({
        METRIKA_BACKUP_CLIENT_ID: clientId.trim(),
        METRIKA_BACKUP_CLIENT_SECRET: clientSecret.trim(),
      }),
    onSuccess: (r) => {
      setMsg(`${t('common.save')}: ${r.changed.join(', ')}`);
      setClientSecret('');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const exchange = useMutation({
    mutationFn: () => v3.exchangeBackupToken(code.trim()),
    onSuccess: (r) => {
      setMsg(`${t('i18n.mk.backup.exchanged')} (${r.tokenLength} ${t('i18n.mk.backup.chars')})`);
      setCode('');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => setMsg(err.message),
  });

  const authorizeHref =
    'https://oauth.yandex.ru/authorize?response_type=code' +
    `&client_id=${encodeURIComponent(clientId.trim())}` +
    '&redirect_uri=https://oauth.yandex.ru/verification_code';

  const input = 'w-full rounded border border-line bg-raised px-3 py-2 text-sm';

  return (
    <Card title={t('i18n.mk.backup.title')}>
      <p className="mb-4 text-sm text-muted">{t('i18n.mk.backup.subtitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">{t('i18n.mk.backup.clientId')}</span>
          <input
            className={input}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">{t('i18n.mk.backup.clientSecret')}</span>
          <input
            className={input}
            type="password"
            value={clientSecret}
            placeholder={savedSecret ? t('i18n.mk.backup.stored') : ''}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="new-password"
          />
        </label>
      </div>
      <button
        type="button"
        className="btn-ghost mt-3 text-sm"
        disabled={!clientId.trim()}
        onClick={() => saveCreds.mutate()}
      >
        {t('common.save')}
      </button>

      <ol className="mb-3 mt-4 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>{t('i18n.mk.backup.stepSave')}</li>
        <li>
          <a href={authorizeHref} target="_blank" rel="noreferrer" className="underline">
            {t('i18n.mk.backup.stepAuthorize')}
          </a>
        </li>
        <li>{t('i18n.mk.backup.stepCode')}</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${input} max-w-xs`}
          value={code}
          placeholder={t('i18n.mk.backup.codePlaceholder')}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={!code.trim()}
          onClick={() => exchange.mutate()}
        >
          {t('i18n.mk.backup.exchange')}
        </button>
        {savedToken && <Pill tone="accent">{t('i18n.mk.backup.tokenSet')}</Pill>}
      </div>
      {msg && (
        <p className="mt-2 text-sm text-muted" role="status">
          {msg}
        </p>
      )}
    </Card>
  );
}

export function MetrikaSettings(): JSX.Element {
  const { t } = useT();
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
      void qc.invalidateQueries({ queryKey: ['sync-status'] });
      void qc.invalidateQueries();
    },
  });
  // ANA-15: the last sync outcome (status + per-step errors) — errors are never console-only.
  const syncStatusQ = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.syncStatus(),
    retry: false,
  });
  // ANA-68 style: { run: null } = ещё не запускался — нормальное состояние, без 404 в консоли.
  const lastRun = syncStatusQ.data?.run ?? null;
  const clear = useMutation({
    mutationFn: v3.clearMetrikaData,
    onSuccess: () => {
      setDanger(false);
      setConfirm('');
      setMsg(t('i18n.mk.cleared'));
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
        <Card title={t('i18n.mk.connection')}>
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
              <label key={f.key} className={f.textarea ? 'block md:col-span-2' : 'block'}>
                <span className="label flex items-center gap-2">
                  {t(f.labelKey)} <Pill tone="neutral">{q.data[f.key]?.source ?? 'unset'}</Pill>
                </span>
                {f.textarea ? (
                  <textarea
                    className="input min-h-20 font-mono"
                    rows={3}
                    autoComplete="off"
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                ) : (
                  <input
                    className={`input ${f.secret ? 'font-mono' : ''}`}
                    type={f.secret ? 'password' : f.number ? 'number' : 'text'}
                    autoComplete="off"
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                )}
                <span className="mt-1 block text-xs text-muted">{t(f.hintKey)}</span>
              </label>
            ))}
            <div className="md:col-span-2">
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {t('common.save')}
              </button>
              <span className="ml-3 text-xs text-muted">{t('i18n.mk.appliedAtOnce')}</span>
            </div>
          </form>
        </Card>
      )}
      {q.data && <GoalsManager />}
      <Card title={t('i18n.mk.syncTitle')}>
        <p className="mb-3 text-sm text-muted">{t('i18n.mk.syncHelp', { from, to })}</p>
        <button
          type="button"
          className="btn-primary"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
          {t('i18n.mk.syncBtn')}
        </button>
        {sync.error && (
          <div className="mt-3">
            <ErrorBox error={sync.error} />
          </div>
        )}
        {/* ANA-15: the last sync result is visible in the UI, not only in the console. */}
        <div className="mt-4 border-t border-line pt-3 text-sm" data-testid="sync-status">
          <p className="mb-1 font-medium">{t('dh.sync.title')}</p>
          {syncStatusQ.isLoading ? null : !lastRun ? (
            <p className="text-muted">{t('dh.sync.none')}</p>
          ) : (
            <div className="space-y-1">
              <p>
                <span
                  className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    lastRun.status === 'ok'
                      ? 'bg-green-100 text-green-800'
                      : lastRun.status === 'partial'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                  }`}
                >
                  {t(`dh.sync.status.${lastRun.status}` as DictKey)}
                </span>
                <span className="text-muted">
                  {t('dh.sync.range', { from: lastRun.from, to: lastRun.to })}
                  {lastRun.finishedAt
                    ? ` · ${t('dh.sync.finished', { at: lastRun.finishedAt })}`
                    : ''}
                </span>
              </p>
              {lastRun.errors.length > 0 ? (
                <div>
                  <p className="text-amber-700">{t('dh.sync.errors')}</p>
                  <ul className="list-disc pl-5 text-xs text-muted">
                    {lastRun.errors.map((e, i) => (
                      <li key={i}>
                        <code>{e.step}</code>: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted">{t('dh.sync.noErrors')}</p>
              )}
            </div>
          )}
        </div>
      </Card>
      <B2cPaymentsCard />
      <Card
        title={
          <span className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-4 w-4" /> {t('i18n.mk.danger')}
          </span>
        }
        className="border-red-300"
      >
        <p className="mb-3 text-sm text-muted">{t('i18n.mk.dangerHelp')}</p>
        <button type="button" className="btn-danger" onClick={() => setDanger(true)}>
          {t('i18n.mk.clearBtn')}
        </button>
      </Card>
      <Modal open={danger} title={t('i18n.mk.confirmTitle')} onClose={() => setDanger(false)}>
        <p className="mb-3 text-sm">
          {t('i18n.mk.typeWord')}{' '}
          {/* i18n: ignore — protocol word validated server-side (z.literal('УДАЛИТЬ')) */}
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
            // i18n: ignore — protocol word validated server-side (z.literal('УДАЛИТЬ'))
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

/**
 * ANA-19: manual B2C payments — Metrika only sees orders, so an admin enters the paid B2C
 * tickets per day (or imports a payment-provider CSV). These rows are the «Оплачено» KPI
 * factsource together with paid B2B deals («Оплачено» = B2C paid + B2B paid).
 */
export function B2cPaymentsCard(): JSX.Element {
  const { t } = useT();
  const qc = useQueryClient();
  const { from, to } = useFilters();
  const list = useQuery({
    queryKey: ['b2c-payments', from, to],
    queryFn: () => api.b2cPayments({ from, to }),
  });
  const summary = useQuery({
    queryKey: ['payments-summary', from, to],
    queryFn: () => api.paymentsSummary({ from, to }),
    retry: false,
  });
  const [day, setDay] = useState({ date: from, tickets: '', amountRub: '', note: '' });
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['b2c-payments'] });
    void qc.invalidateQueries({ queryKey: ['payments-summary'] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.saveB2cPayment({
        date: day.date,
        tickets: Number(day.tickets || 0),
        amountRub: day.amountRub === '' ? undefined : Number(day.amountRub),
        note: day.note === '' ? undefined : day.note,
      }),
    onSuccess: (p) => {
      setMsg(t('dh.payments.saved', { date: p.date }));
      setDay({ date: day.date, tickets: '', amountRub: '', note: '' });
      invalidate();
    },
  });
  const importCsv = useMutation({
    mutationFn: () => api.importB2cPayments(csv),
    onSuccess: (r) => {
      setMsg(t('dh.payments.imported', { n: r.imported, skipped: r.skipped }));
      setCsv('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (date: string) => api.removeB2cPayment(date),
    onSuccess: invalidate,
  });

  return (
    <Card title={t('dh.payments.title')}>
      <p className="mb-3 text-sm text-muted">{t('dh.payments.help')}</p>
      {msg && (
        <div
          className="mb-3 cursor-pointer rounded border border-accent/40 p-2 text-sm"
          onClick={() => setMsg(null)}
        >
          {msg}
        </div>
      )}
      {summary.data && (
        <p className="mb-3 text-sm" data-testid="b2c-summary">
          {t('dh.payments.days', { n: summary.data.days })} · B2C: {summary.data.b2cPaid} · B2B:{' '}
          {summary.data.b2bPaid} = <b>{summary.data.paid}</b>
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">{t('dh.payments.date')}</span>
          <input
            type="date"
            className="input"
            value={day.date}
            max={to}
            onChange={(e) => setDay({ ...day, date: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">{t('dh.payments.tickets')}</span>
          <input
            type="number"
            min={0}
            className="input w-24"
            value={day.tickets}
            onChange={(e) => setDay({ ...day, tickets: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">{t('dh.payments.amount')}</span>
          <input
            type="number"
            min={0}
            className="input w-32"
            value={day.amountRub}
            onChange={(e) => setDay({ ...day, amountRub: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="label">{t('dh.payments.note')}</span>
          <input
            type="text"
            className="input w-48"
            value={day.note}
            onChange={(e) => setDay({ ...day, note: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={save.isPending || !day.date || day.tickets === ''}
          onClick={() => save.mutate()}
        >
          {t('dh.payments.save')}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block min-w-64 flex-1">
          <span className="label">{t('dh.payments.csv')}</span>
          <textarea
            className="input min-h-16 font-mono"
            rows={2}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-ghost"
          disabled={importCsv.isPending || csv.trim() === ''}
          onClick={() => importCsv.mutate()}
        >
          {t('dh.payments.import')}
        </button>
      </div>
      {(save.error || importCsv.error) && (
        <div className="mt-3">
          <ErrorBox error={save.error ?? importCsv.error} />
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1">{t('dh.payments.date')}</th>
              <th>{t('dh.payments.tickets')}</th>
              <th>{t('dh.payments.note')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((p) => (
              <tr key={p.date} className="border-t border-line">
                <td className="py-1 font-mono">{p.date}</td>
                <td>{p.tickets}</td>
                <td className="text-muted">{p.note ?? ''}</td>
                <td className="text-right">
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    aria-label={`${t('dh.payments.remove')} ${p.date}`}
                    onClick={() => remove.mutate(p.date)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
