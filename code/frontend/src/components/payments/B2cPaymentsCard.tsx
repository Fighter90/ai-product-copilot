import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { B2cPayment } from '@pca/shared';
import { termHint } from '@pca/shared';
import { api } from '../../lib/api';
import { useT, type DictKey } from '../../i18n';
import { useFilters } from '../../store/filters';
import { formatInt } from '../../lib/format';
import { Card, Pill } from '../ui';

/**
 * ANA-19: manual B2C payments — Metrika only sees orders, so an admin/analyst enters the
 * CONFIRMED paid B2C tickets per day (or imports a payment-provider CSV). These rows are the
 * B2C half of «Оплачено» = B2C paid + B2B paid; the Overview KPI strip reads the same numbers
 * via GET /api/payments/summary.
 */
export function B2cPaymentsCard(): JSX.Element {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const { from, to } = useFilters();
  const q = useQuery({
    queryKey: ['b2c-payments', from, to],
    queryFn: () => api.b2cPayments({ from, to }),
  });
  const summary = useQuery({
    queryKey: ['payments-summary', from, to],
    queryFn: () => api.paymentsSummary({ from, to }),
  });

  const [date, setDate] = useState(from);
  const [tickets, setTickets] = useState('0');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [csv, setCsv] = useState('');

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['b2c-payments'] });
    void qc.invalidateQueries({ queryKey: ['payments-summary'] });
    void qc.invalidateQueries({ queryKey: ['channels'] }); // the Overview KPI strip
  };

  const save = useMutation({
    mutationFn: () =>
      api.saveB2cPayment({
        date,
        tickets: Math.max(0, Math.round(Number(tickets) || 0)),
        ...(amount !== '' && Number.isFinite(Number(amount)) ? { amountRub: Number(amount) } : {}),
      }),
    onSuccess: () => {
      setMsg(t('dh.payments.saved', { date }));
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
    mutationFn: (d: string) => api.removeB2cPayment(d),
    onSuccess: () => invalidate(),
  });

  const days: B2cPayment[] = q.data ?? [];

  return (
    <Card
      title={
        <span title={termHint('b2cPaid', locale)} className="underline decoration-dotted">
          {t('dh.payments.title' as DictKey)}
        </span>
      }
    >
      <p className="mb-3 text-sm text-muted">{t('dh.payments.help' as DictKey)}</p>

      {summary.data && (
        <p className="mb-3 text-sm" data-testid="b2c-days-count">
          {t('dh.payments.days', { n: formatInt(summary.data.days) })} ·{' '}
          <b>
            {t('dh.kpi.paidLabel' as DictKey)}: {formatInt(summary.data.paid)}
          </b>{' '}
          <span className="text-muted">
            (
            {t('dh.kpi.paidSplit', {
              b2c: formatInt(summary.data.b2cPaid),
              b2b: formatInt(summary.data.b2bPaid),
            })}
            )
          </span>
        </p>
      )}

      {/* Manual entry: one row per day */}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="block text-xs">
          <span className="label">{t('dh.payments.date' as DictKey)}</span>
          <input
            type="date"
            required
            min={from}
            max={to}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
        </label>
        <label className="block text-xs">
          <span className="label">{t('dh.payments.tickets' as DictKey)}</span>
          <input
            type="number"
            required
            min={0}
            step={1}
            value={tickets}
            onChange={(e) => setTickets(e.target.value)}
            className="input w-24"
          />
        </label>
        <label className="block text-xs">
          <span className="label">{t('dh.payments.amount' as DictKey)}</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input w-32"
          />
        </label>
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {t('dh.payments.save' as DictKey)}
        </button>
      </form>

      {msg && (
        <p className="mt-2 text-sm text-green-700" role="status" onClick={() => setMsg(null)}>
          {msg}
        </p>
      )}
      {(save.error ?? importCsv.error ?? remove.error) && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {String((save.error ?? importCsv.error ?? remove.error) as Error)}
        </p>
      )}

      {/* CSV import */}
      <div className="mt-4">
        <label className="block text-xs">
          <span className="label">{t('dh.payments.csv' as DictKey)}</span>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={3}
            className="input font-mono"
            placeholder={'2026-10-19,4,56000\n2026-10-20,6'}
          />
        </label>
        <button
          type="button"
          className="btn-ghost mt-2"
          disabled={csv.trim() === '' || importCsv.isPending}
          onClick={() => importCsv.mutate()}
        >
          {t('dh.payments.import' as DictKey)}
        </button>
      </div>

      {/* Entered days */}
      <div
        className="mt-4 overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={t('dh.payments.title' as DictKey)}
      >
        <table className="w-full sm:min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">{t('dh.payments.date' as DictKey)}</th>
              <th>{t('dh.payments.tickets' as DictKey)}</th>
              <th>{t('dh.payments.amount' as DictKey)}</th>
              <th>{t('dh.payments.note' as DictKey)}</th>
              <th>
                <span className="sr-only">{t('dh.payments.remove' as DictKey)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((p) => (
              <tr
                key={p.date}
                className="border-t border-slate-100"
                data-testid={`b2c-row-${p.date}`}
              >
                <td className="py-1 font-mono">{p.date}</td>
                <td>{formatInt(p.tickets)}</td>
                <td>{p.amountRub !== undefined ? formatInt(p.amountRub) : '—'}</td>
                <td className="max-w-[12rem] truncate">
                  {p.note} <Pill tone="neutral">{p.source}</Pill>
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={`${t('dh.payments.remove' as DictKey)}: ${p.date}`}
                    className="text-slate-400 hover:text-red-600"
                    onClick={() => remove.mutate(p.date)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {days.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-muted">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
