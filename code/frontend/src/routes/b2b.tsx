import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { B2bDeal, B2bStage, NewB2bDeal } from '@pca/shared';
import { api } from '../lib/api';
import { formatInt } from '../lib/format';
import { B2B_STAGES, pipelineSummary, type StageSummary } from '../lib/b2b';
import { ConfirmDialog } from '../components/ui';
import { useT, fmtDate, type DictKey } from '../i18n';

const STAGE_KEYS: Record<B2bStage, DictKey> = {
  lead: 'b2b.stage.lead',
  negotiation: 'b2b.stage.negotiation',
  invoiced: 'b2b.stage.invoiced',
  paid: 'b2b.stage.paid',
};

type ViewMode = 'kanban' | 'table';

/** ANA-164: read the dragged deal id out of a drop event; empty/garbage payloads are ignored. */
function draggedDealId(e: React.DragEvent<HTMLElement>): number | null {
  const raw = (e.dataTransfer?.getData('text/plain') ?? '').trim();
  if (raw === '') return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export interface B2bHandlers {
  onAdd: (deal: NewB2bDeal) => void;
  onStageChange: (input: { id: number; stage: B2bStage }) => void;
  /** ANA-50: commit an edited deal amount (null clears it). */
  onAmountChange: (input: { id: number; amountRub: number | null }) => void;
  onRemove: (id: number) => void;
}

/** One kanban card: company, contact, amount, date and the next step (notes). */
function DealCard({ deal }: { deal: B2bDeal }): JSX.Element {
  const { t, locale } = useT();
  return (
    <article
      draggable
      data-testid={`b2b-card-${deal.id}`}
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', String(deal.id));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      className="cursor-grab rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm animate-fade-up active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words font-medium leading-snug">{deal.company}</span>
        <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[11px] font-bold text-accent">
          {t('b2b.ticketsN', { n: formatInt(deal.tickets) })}
        </span>
      </div>
      {/* Round 2: null-safe — a deal cleared to `amountRub: null` (PATCH round-trip) shows no
          amount line at all; rendering formatInt(null) as «0 ₽» would invent a number. */}
      {typeof deal.amountRub === 'number' && (
        <div className="mt-1 tabular-nums">{formatInt(deal.amountRub)} ₽</div>
      )}
      <div className="mt-1 text-xs text-slate-500">{fmtDate(deal.dateAdded, locale)}</div>
      {deal.contactEmail && (
        <div className="mt-1 truncate text-xs text-slate-500">{deal.contactEmail}</div>
      )}
      {deal.notes && (
        <div className="mt-1 text-xs text-slate-600">
          <span className="font-medium text-slate-500">{t('b2b.card.nextStep')}: </span>
          {deal.notes}
        </div>
      )}
    </article>
  );
}

/** One kanban column: a stage with counters in the header and its deal cards. */
function KanbanColumn({
  summary,
  deals,
  onDropDeal,
}: {
  summary: StageSummary;
  deals: B2bDeal[];
  /** ANA-164: a card dropped here with `id`; the caller resolves it against ALL deals. */
  onDropDeal: (id: number, stage: B2bStage) => void;
}): JSX.Element {
  const { t } = useT();
  const { stage } = summary;
  return (
    <section
      data-testid={`b2b-col-${stage}`}
      aria-label={t(STAGE_KEYS[stage])}
      // HTML5 DnD: allow drops, then hand the dragged deal id to the caller.
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = draggedDealId(e);
        if (id !== null) onDropDeal(id, stage);
      }}
      // Mobile 390: fixed-width columns scroll horizontally inside the board (Trello-style);
      // from sm up the columns share the width. min-w-0 keeps long content from pushing out.
      className="flex min-w-[16rem] shrink-0 flex-col rounded-lg border border-slate-200 bg-slate-50 p-2 sm:min-w-0 sm:flex-1"
    >
      <header>
        <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-500">
          {t(STAGE_KEYS[stage])}
          <span
            data-testid={`b2b-col-${stage}-count`}
            className="rounded-full bg-white px-1.5 text-slate-700"
          >
            {summary.deals}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          <span data-testid={`b2b-col-${stage}-tickets`}>
            {t('b2b.ticketsN', { n: formatInt(summary.tickets) })}
          </span>
          {/* Anti-hallucination: no amounts in the stage → no ₽ counter (absence ≠ 0 ₽). */}
          {summary.amountRub !== null && (
            <span data-testid={`b2b-col-${stage}-amount`} className="tabular-nums">
              {' '}
              · {formatInt(summary.amountRub)} ₽
            </span>
          )}
        </div>
      </header>
      <div className="mt-2 space-y-2">
        {deals.map((d) => (
          <DealCard key={d.id} deal={d} />
        ))}
        {deals.length === 0 && <p className="px-1 text-xs text-slate-400">{t('b2b.empty')}</p>}
      </div>
    </section>
  );
}

/** Pure presentational B2B pipeline page. */
export function B2bView({
  deals,
  onAdd,
  onStageChange,
  onAmountChange,
  onRemove,
  stageError = null,
}: { deals: B2bDeal[]; stageError?: string | null } & B2bHandlers): JSX.Element {
  const { t } = useT();
  const summary = pipelineSummary(deals);
  const [company, setCompany] = useState('');
  const [tickets, setTickets] = useState('');
  // ANA-50: сумма сделки в ₽ — optional, the goals page and B2B summary report it as «Сумма».
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState<B2bStage>('lead');
  // ANA-164: kanban is the default view; the full deal table lives behind the switcher.
  const [view, setView] = useState<ViewMode>('kanban');
  // БАГ-03: явная ошибка формы вместо молчаливого игнора.
  const [formError, setFormError] = useState('');
  // ANA-120 (хвост БАГ-15): удаление сделки — через styled ConfirmDialog, не window.confirm().
  const [pendingDelete, setPendingDelete] = useState<B2bDeal | null>(null);

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

  const viewBtn = (mode: ViewMode): JSX.Element => (
    <button
      key={mode}
      type="button"
      data-testid={`b2b-view-${mode}`}
      aria-pressed={view === mode}
      onClick={() => setView(mode)}
      className={
        view === mode
          ? 'bg-indigo-600 px-3 py-1 text-sm text-white'
          : 'bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50'
      }
    >
      {t(mode === 'kanban' ? 'b2b.view.kanban' : 'b2b.view.table')}
    </button>
  );

  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">
        {t('b2b.pipelineTotal')} <b>{formatInt(summary.totalTickets)}</b> · {t('b2b.pipelinePaid')}{' '}
        <b>{formatInt(summary.paidTickets)}</b>
      </p>

      {/* ANA-164: «Канбан / Таблица» switcher. */}
      <div
        role="group"
        aria-label={t('b2b.viewSwitch')}
        className="inline-flex overflow-hidden rounded-lg border border-slate-300"
      >
        {viewBtn('kanban')}
        {viewBtn('table')}
      </div>

      {/* ANA-164 round 2: a failed stage PATCH explains itself inline — the same styled-alert
          convention as the form error above; never a blocking native window.alert(). */}
      {stageError && (
        <p role="alert" data-testid="b2b-stage-error" className="text-xs text-red-600">
          {stageError}
        </p>
      )}

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

      {view === 'kanban' ? (
        /* Mobile 390: the board scrolls horizontally inside this container — the page itself
           never overflows (checked by e2e/mobile.spec.ts, no document overflow). */
        <div data-testid="b2b-kanban" className="flex gap-3 overflow-x-auto pb-2">
          {summary.byStage.map((s) => (
            <KanbanColumn
              key={s.stage}
              summary={s}
              deals={deals.filter((d) => d.stage === s.stage)}
              onDropDeal={(id, target) => {
                const deal = deals.find((d) => d.id === id);
                if (!deal || deal.stage === target) return;
                onStageChange({ id: deal.id, stage: target });
              }}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid="b2b-table" className="w-full text-sm">
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
                      onClick={() => setPendingDelete(d)}
                      className="text-red-700"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* БАГ-03 / ANA-120: styled confirmation instead of the native window.confirm()
          — the same dialog chrome as the hypotheses kanban (БАГ-15). */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('b2b.removeTitle')}
        body={
          pendingDelete === null
            ? ''
            : t('b2b.confirmRemove', {
                company: pendingDelete.company,
                tickets: t('b2b.ticketsN', { n: formatInt(pendingDelete.tickets) }),
              })
        }
        confirmLabel={t('b2b.remove')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (pendingDelete === null) return;
          onRemove(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

/** Data + mutations wrapper. */
export function B2b(): JSX.Element {
  const { t } = useT();
  const qc = useQueryClient();
  // ANA-164 round 2: a failed stage PATCH surfaces inline (role=alert) instead of the native
  // window.alert() — same convention as the form error and the ANA-120 ConfirmDialog.
  const [stageError, setStageError] = useState<string | null>(null);
  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['b2b'] });
  };
  const q = useQuery({ queryKey: ['b2b'], queryFn: () => api.b2b() });
  const addMut = useMutation({ mutationFn: api.createB2b, onSuccess: invalidate });
  // ANA-164: kanban drop — the stage PATCH fires on drop with an optimistic move; a failed
  // PATCH rolls the card back to its stage and explains the jump-back inline.
  const stageMut = useMutation({
    mutationFn: api.updateB2bStage,
    onMutate: async (input) => {
      // A new attempt clears the previous failure message.
      setStageError(null);
      await qc.cancelQueries({ queryKey: ['b2b'] });
      const prev = qc.getQueryData<B2bDeal[]>(['b2b']);
      qc.setQueryData<B2bDeal[]>(['b2b'], (old) =>
        (old ?? []).map((d) => (d.id === input.id ? { ...d, stage: input.stage } : d)),
      );
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(['b2b'], ctx.prev);
      setStageError(`${t('b2b.stageError')}: ${err instanceof Error ? err.message : String(err)}`);
    },
    onSettled: invalidate,
  });
  const amountMut = useMutation({ mutationFn: api.updateB2bAmount, onSuccess: invalidate });
  const removeMut = useMutation({ mutationFn: api.removeB2b, onSuccess: invalidate });

  return (
    <B2bView
      deals={q.data ?? []}
      stageError={stageError}
      onAdd={addMut.mutate}
      onStageChange={stageMut.mutate}
      onAmountChange={amountMut.mutate}
      onRemove={removeMut.mutate}
    />
  );
}
