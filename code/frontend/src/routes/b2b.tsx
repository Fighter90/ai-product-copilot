import { useState } from 'react';
import { Dialog } from '@headlessui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { B2bDeal, B2bStage, NewB2bDeal } from '@pca/shared';
import { api } from '../lib/api';
import { formatInt } from '../lib/format';
import { B2B_STAGES, pipelineSummary } from '../lib/b2b';
import { useT, type DictKey } from '../i18n';

const STAGE_KEYS: Record<B2bStage, DictKey> = {
  lead: 'b2b.stage.lead',
  negotiation: 'b2b.stage.negotiation',
  invoiced: 'b2b.stage.invoiced',
  paid: 'b2b.stage.paid',
};

export interface B2bHandlers {
  onAdd: (deal: NewB2bDeal) => void;
  onStageChange: (input: { id: number; stage: B2bStage }) => void;
  /** ANA-50: commit an edited deal amount (null clears it). */
  onAmountChange: (input: { id: number; amountRub: number | null }) => void;
  onRemove: (id: number) => void;
}

/** Pure presentational B2B pipeline page. */
export function B2bView({
  deals,
  onAdd,
  onStageChange,
  onAmountChange,
  onRemove,
}: { deals: B2bDeal[] } & B2bHandlers): JSX.Element {
  const { t } = useT();
  const summary = pipelineSummary(deals);
  const [company, setCompany] = useState('');
  const [tickets, setTickets] = useState('');
  // ANA-50: сумма сделки в ₽ — optional, the goals page and B2B summary report it as «Сумма».
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState<B2bStage>('lead');
  const [tableOpen, setTableOpen] = useState(false);
  // БАГ-03: явная ошибка формы вместо молчаливого игнора.
  const [formError, setFormError] = useState('');

  // Per-stage totals for the kanban — every stage shown (0 if empty).
  const byStage = B2B_STAGES.map((s) => {
    const ds = deals.filter((d) => d.stage === s);
    return { stage: s, tickets: ds.reduce((a, d) => a + d.tickets, 0), deals: ds.length };
  });

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const n = Number(tickets);
    // БАГ-03: раньше пустая/невалидная форма молча ничего не делала, а отрицательные билеты
    // сохранялись и ломали KPI (−5 из 300).
    if (!company.trim()) {
      setFormError(t('b2b.errCompany'));
      return;
    }
    if (!Number.isInteger(n) || n < 1) {
      setFormError(t('b2b.errTickets'));
      return;
    }
    setFormError('');
    onAdd({
      company: company.trim(),
      tickets: n,
      stage,
      ...(amount ? { amountRub: Number(amount) } : {}),
      dateAdded: new Date().toISOString().slice(0, 10),
    });
    setCompany('');
    setTickets('');
    setAmount('');
  };

  return (
    <section className="space-y-4">
      {/* Kanban — all 4 stages always shown */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {byStage.map((s) => (
          <div key={s.stage} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase text-slate-500">
              {t(STAGE_KEYS[s.stage])}
            </div>
            <div className="text-lg font-bold">
              {t('b2b.ticketsN', { n: formatInt(s.tickets) })}
            </div>
            <div className="text-xs text-slate-500">{t('b2b.dealsN', { n: s.deals })}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-600">
        {t('b2b.pipelineTotal')} <b>{formatInt(summary.totalTickets)}</b> · {t('b2b.pipelinePaid')}{' '}
        <b>{formatInt(summary.paidTickets)}</b>
      </p>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          {t('b2b.col.company')}
          <input
            aria-label={t('b2b.col.company')}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="block rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          {t('b2b.col.tickets')}
          <input
            aria-label={t('b2b.col.tickets')}
            type="number"
            value={tickets}
            onChange={(e) => setTickets(e.target.value)}
            className="block w-24 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          {t('b2b.col.amount')}
          <input
            aria-label={t('b2b.col.amount')}
            type="number"
            min={0}
            placeholder="₽"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="block w-32 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          {t('b2b.col.stage')}
          <select
            aria-label={t('b2b.newStage')}
            value={stage}
            onChange={(e) => setStage(e.target.value as B2bStage)}
            className="block rounded border border-slate-300 px-2 py-1"
          >
            {B2B_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(STAGE_KEYS[s])}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded bg-indigo-600 px-3 py-1 text-sm text-white">
          {t('b2b.add')}
        </button>
        {formError && (
          <p role="alert" className="basis-full text-xs text-red-600">
            {formError}
          </p>
        )}
      </form>

      <button
        type="button"
        onClick={() => setTableOpen(true)}
        className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
      >
        {t('b2b.expand', { n: deals.length })}
      </button>

      <Dialog open={tableOpen} onClose={() => setTableOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-y-0 right-0 flex max-w-full">
          <Dialog.Panel className="w-screen max-w-lg overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold">{t('b2b.title')}</Dialog.Title>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setTableOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">{t('b2b.col.company')}</th>
                  <th>{t('b2b.col.tickets')}</th>
                  <th>{t('b2b.col.amount')}</th>
                  <th>{t('b2b.col.stage')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="py-1">{d.company}</td>
                    <td>{formatInt(d.tickets)}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {/* ANA-50: the amount is editable inline — commits on blur/Enter, empty
                          input clears it. Keeps older «—» deals fillable without leaving the page. */}
                      <input
                        type="number"
                        min={0}
                        placeholder="₽"
                        aria-label={t('b2b.amountOf', { company: d.company })}
                        defaultValue={d.amountRub ?? ''}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const next = raw === '' ? null : Number(raw);
                          if (next === (d.amountRub ?? null) || Number.isNaN(next)) return;
                          onAmountChange({ id: d.id, amountRub: next });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        className="w-28 rounded border border-slate-300 px-1 py-0.5 text-right"
                      />
                    </td>
                    <td>
                      <select
                        aria-label={t('b2b.stageOf', { company: d.company })}
                        value={d.stage}
                        onChange={(e) =>
                          onStageChange({ id: d.id, stage: e.target.value as B2bStage })
                        }
                        className="rounded border border-slate-300 px-1"
                      >
                        {B2B_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {t(STAGE_KEYS[s])}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={t('b2b.removeOf', { company: d.company })}
                        onClick={() => {
                          // БАГ-03: удаление сделки — с подтверждением (как у гипотез).
                          if (window.confirm(t('b2b.confirmRemove', { company: d.company })))
                            onRemove(d.id);
                        }}
                        className="text-red-700"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Dialog.Panel>
        </div>
      </Dialog>
    </section>
  );
}

/** Data + mutations wrapper. */
export function B2b(): JSX.Element {
  const qc = useQueryClient();
  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['b2b'] });
  };
  const q = useQuery({ queryKey: ['b2b'], queryFn: () => api.b2b() });
  const addMut = useMutation({ mutationFn: api.createB2b, onSuccess: invalidate });
  const stageMut = useMutation({ mutationFn: api.updateB2bStage, onSuccess: invalidate });
  const amountMut = useMutation({ mutationFn: api.updateB2bAmount, onSuccess: invalidate });
  const removeMut = useMutation({ mutationFn: api.removeB2b, onSuccess: invalidate });

  return (
    <B2bView
      deals={q.data ?? []}
      onAdd={addMut.mutate}
      onStageChange={stageMut.mutate}
      onAmountChange={amountMut.mutate}
      onRemove={removeMut.mutate}
    />
  );
}
