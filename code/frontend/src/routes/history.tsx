import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatInt } from '../lib/format';
import { snapshotDiff } from '../lib/snapshot-diff';
import { useAuth } from '../auth/AuthContext';
import { fmtDate, translate, useT, type DictKey } from '../i18n';
import type { Locale } from '../store/prefs';

type QueryStatus = 'pending' | 'error' | 'success';

/**
 * 'YYYY-MM-DD' → 'dd.MM' (или 'dd.MM.yyyy'; в EN — 'dd/MM/yyyy'). Строковый парсинг — без
 * сдвигов часовых поясов.
 */
function formatDay(iso: string, withYear = false, locale: Locale = 'ru'): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const sep = locale === 'ru' ? '.' : '/';
  return withYear ? `${d}${sep}${m}${sep}${y}` : `${d}${sep}${m}`;
}

/**
 * Человеческое имя отчёта из периода снапшота: «Отчёт 12.10–25.10.2026».
 * Год указывается один раз в конце, если годы совпадают; иначе у обеих дат —
 * «Отчёт 25.12.2025–10.01.2026».
 */
export function formatSnapshotName(
  dateFrom: string,
  dateTo: string,
  locale: Locale = 'ru',
): string {
  const sameYear = dateFrom.slice(0, 4) === dateTo.slice(0, 4);
  return translate(locale, 'hist.name', {
    range: `${formatDay(dateFrom, !sameYear, locale)}–${formatDay(dateTo, true, locale)}`,
  });
}

/** Короткий UUID для прослеживаемости к данным: 'a1b2c3d4…'. */
export function shortSnapshotId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

export interface SnapshotRow {
  id: string;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  /** ANA-39: who built the snapshot (user email in cabinet mode; null in legacy mode). */
  author?: string | null;
}

/**
 * ANA-39: фильтр истории по периоду — снапшот подходит, если его период [dateFrom, dateTo]
 * пересекается с выбранным [from, to]. Пустая граница = фильтр с этой стороны не задан.
 */
export function periodOverlaps(
  s: Pick<SnapshotRow, 'dateFrom' | 'dateTo'>,
  from: string,
  to: string,
): boolean {
  // снапшот целиком до окна
  if (from && s.dateTo < from) return false;
  // снапшот целиком после окна
  if (to && s.dateFrom > to) return false;
  return true;
}

/**
 * ANA-39: фильтр по автору — точное совпадение e-mail; пустая строка = «все авторы».
 * Снапшоты без автора (legacy-режим) остаются видимыми только при пустом фильтре.
 */
export function authorMatches(s: Pick<SnapshotRow, 'author'>, author: string): boolean {
  if (!author) return true;
  return (s.author ?? '') === author;
}

/** Длина периода [from, to] включительно в днях ('YYYY-MM-DD'; UTC-парсинг — без сдвигов TZ). */
export function periodDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** '(none)' — внутренняя метка отсутствующего UTM-значения; пользователю показываем «—». */
export function channelPart(part: string): string {
  return part === '(none)' ? '—' : part;
}

/** KPI-строка сравнения: метка + старое → новое + дельта со знаком. */
function DiffNum({ v }: { v: { from: number; to: number; delta: number } }) {
  const sign = v.delta > 0 ? '+' : '';
  const tone = v.delta > 0 ? 'text-green-700' : v.delta < 0 ? 'text-red-700' : 'text-slate-400';
  return (
    <span className="tabular-nums">
      {formatInt(v.from)} → {formatInt(v.to)}{' '}
      <b className={tone}>
        ({sign}
        {formatInt(v.delta)})
      </b>
    </span>
  );
}

/**
 * ANA-39: сравнение двух снапшотов — обе стороны выбираются списком, дельты KPI и каналов
 * считаются клиентски из полных снапшотов (api.getSnapshot) через lib/snapshot-diff.
 */
function SnapshotCompare({ snapshots }: { snapshots: SnapshotRow[] }): JSX.Element | null {
  const { t, locale } = useT();
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  // Defaults once there is something to pick. Список отсортирован по generated_at DESC, поэтому
  // «старый» — второй (более ранний) снапшот, «новый» — первый (БАГ-12: было наоборот).
  const a = aId ?? snapshots[1]?.id ?? null;
  const b = bId ?? snapshots[0]?.id ?? null;

  const q = useQuery({
    queryKey: ['snapshot-compare', a, b],
    enabled: Boolean(a && b && a !== b),
    queryFn: async () => {
      const [sa, sb] = await Promise.all([api.getSnapshot(a!), api.getSnapshot(b!)]);
      return snapshotDiff(sa, sb);
    },
  });

  if (!a || !b || a === b || snapshots.length < 2) return null;

  // БАГ-12: сравнение периодов разной длины (14 дн. против 7 дн.) искажает дельты —
  // предупреждаем явно, до таблицы сравнения.
  const oldSnap = snapshots.find((s) => s.id === a);
  const newSnap = snapshots.find((s) => s.id === b);
  const oldDays = oldSnap ? periodDays(oldSnap.dateFrom, oldSnap.dateTo) : 0;
  const newDays = newSnap ? periodDays(newSnap.dateFrom, newSnap.dateTo) : 0;
  const periodMismatch = oldDays !== newDays;

  const option = (id: string): JSX.Element => {
    const s = snapshots.find((x) => x.id === id)!;
    return (
      <option key={s.id} value={s.id}>
        {formatSnapshotName(s.dateFrom, s.dateTo, locale)}
      </option>
    );
  };

  const kpiLabel: Record<string, DictKey> = {
    visits: 'hist.diff.visits',
    b2cApplications: 'hist.diff.apps',
    b2bPaidTickets: 'hist.diff.paid',
    gap: 'hist.diff.gap',
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('hist.compare.title')}</h3>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label>
          <span className="mr-1 text-slate-500">{t('hist.compare.old')}</span>
          <select
            aria-label={t('hist.compare.old')}
            value={a}
            onChange={(e) => setAId(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {snapshots.map((s) => option(s.id))}
          </select>
        </label>
        <label>
          <span className="mr-1 text-slate-500">{t('hist.compare.new')}</span>
          <select
            aria-label={t('hist.compare.new')}
            value={b}
            onChange={(e) => setBId(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {snapshots.map((s) => option(s.id))}
          </select>
        </label>
      </div>

      {periodMismatch && (
        <p role="note" className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {t('hist.compare.periodMismatch', { old: oldDays, new: newDays })}
        </p>
      )}

      {a === b ? (
        <p className="mt-2 text-xs text-slate-500">{t('hist.compare.same')}</p>
      ) : q.isPending ? (
        <p className="mt-2 text-sm text-slate-500">{t('common.loading')}</p>
      ) : q.isError ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {t('hist.error')}
        </p>
      ) : q.data ? (
        <div className="mt-3 space-y-4">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('hist.compare.kpi')}</caption>
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">{t('hist.compare.kpi')}</th>
                <th>{t('hist.compare.delta')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.kpi.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="py-1">{t(kpiLabel[r.key]!)}</td>
                  <td>
                    <DiffNum v={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {q.data.channels.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('hist.compare.channels')}</caption>
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">{t('hist.compare.channel')}</th>
                    <th>{t('hist.diff.visits')}</th>
                    <th>{t('hist.diff.apps')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.channels.map((c) => (
                    <tr key={c.key} className="border-t border-slate-100">
                      <td className="py-1">
                        {channelPart(c.source)} / {channelPart(c.medium)}
                      </td>
                      <td>
                        <DiffNum v={c.visits} />
                      </td>
                      <td>
                        <DiffNum v={c.reaches} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Pure presentational History view. */
export function HistoryView({
  status,
  snapshots,
  isAdmin = false,
  onDelete,
  deleteError = false,
}: {
  status: QueryStatus;
  snapshots: SnapshotRow[];
  /** REG-10: admins get a per-row delete button (with confirm); everyone else — read-only. */
  isAdmin?: boolean;
  /** REG-10: called after the confirm dialog accepts (wired to the delete mutation). */
  onDelete?: (id: string) => void;
  deleteError?: boolean;
}): JSX.Element {
  const { t, locale } = useT();
  // ANA-39: фильтр по периоду (пересечение периодов) и по автору сборки снапшота.
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  // Distinct non-null authors of the loaded snapshots (for the select options).
  const authors = useMemo(
    () => [...new Set(snapshots.map((s) => s.author).filter((a): a is string => !!a))].sort(),
    [snapshots],
  );
  const filtered = useMemo(
    () =>
      snapshots.filter(
        (s) => periodOverlaps(s, filterFrom, filterTo) && authorMatches(s, filterAuthor),
      ),
    [snapshots, filterFrom, filterTo, filterAuthor],
  );
  if (status === 'pending') return <p className="text-slate-500">{t('common.loading')}</p>;
  if (status === 'error')
    return (
      <p role="alert" className="text-red-700">
        {t('hist.error')}
      </p>
    );

  if (snapshots.length === 0)
    return (
      <div
        role="status"
        className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
      >
        {t('hist.empty')}
      </div>
    );

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('hist.title')}</h2>

      {/* ANA-39: period filter — snapshots whose period intersects the chosen window */}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label>
          <span className="mr-1 text-slate-500">{t('hist.filter.from')}</span>
          <input
            type="date"
            aria-label={t('hist.filter.from')}
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label>
          <span className="mr-1 text-slate-500">{t('hist.filter.to')}</span>
          <input
            type="date"
            aria-label={t('hist.filter.to')}
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
        {authors.length > 0 && (
          <label>
            <span className="mr-1 text-slate-500">{t('fx.hist.author')}</span>
            <select
              aria-label={t('fx.hist.author')}
              value={filterAuthor}
              onChange={(e) => setFilterAuthor(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">{t('fx.hist.allAuthors')}</option>
              {authors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        )}
        {(filterFrom || filterTo || filterAuthor) && (
          <button
            type="button"
            onClick={() => {
              setFilterFrom('');
              setFilterTo('');
              setFilterAuthor('');
            }}
            className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
          >
            {t('hist.filter.reset')}
          </button>
        )}
        <span className="text-xs text-slate-400">
          {t('hist.filter.count', {
            n: formatInt(filtered.length),
            total: formatInt(snapshots.length),
          })}
        </span>
      </div>

      {/* REG-10: surface a failed deletion (e.g. 403 after a role change) near the table. */}
      {deleteError && (
        <p role="alert" className="text-sm text-red-700">
          {t('hist.delete.error')}
        </p>
      )}

      {filtered.length === 0 ? (
        <p role="status" className="text-sm text-slate-500">
          {t('hist.filter.none')}
        </p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('hist.title')}>
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">{t('hist.col.report')}</th>
                <th>{t('hist.col.generated')}</th>
                <th>{t('hist.col.period')}</th>
                <th>{t('fx.hist.author')}</th>
                <th>{t('hist.col.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-1">
                    <Link
                      to={`/app/report?snapshot=${s.id}`}
                      className="font-medium text-indigo-700 hover:underline"
                    >
                      {formatSnapshotName(s.dateFrom, s.dateTo, locale)}
                    </Link>
                    {/* ANA-180: the freshest snapshot (the list is generated_at DESC) is the
                        «текущий» one — without the marker the user could not tell which report
                        the main page/exports are built from. */}
                    {s.id === snapshots[0]?.id && (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-emerald-700">
                        {t('hist.current')}
                      </span>
                    )}
                    <div className="font-mono text-[10px] text-slate-400" title={s.id}>
                      {shortSnapshotId(s.id)}
                    </div>
                  </td>
                  <td>{fmtDate(s.generatedAt, locale, true)}</td>
                  <td>
                    {fmtDate(s.dateFrom, locale)} — {fmtDate(s.dateTo, locale)}
                  </td>
                  <td
                    className="max-w-[12rem] truncate text-xs text-slate-500"
                    title={s.author ?? t('fx.hist.unknownAuthor')}
                  >
                    {s.author ?? t('fx.hist.unknownAuthor')}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/app/report?snapshot=${s.id}`}
                        className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
                      >
                        {t('hist.view')}
                      </Link>
                      {isAdmin && onDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                t('hist.delete.confirm', {
                                  name: formatSnapshotName(s.dateFrom, s.dateTo, locale),
                                }),
                              )
                            ) {
                              onDelete(s.id);
                            }
                          }}
                          className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          {t('hist.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ANA-39: comparison of two snapshots (KPI / channel deltas) */}
      <SnapshotCompare snapshots={snapshots} />

      <p className="text-xs text-slate-500">
        {t('hist.total', { n: formatInt(snapshots.length) })}
      </p>
    </section>
  );
}

/** Data wrapper. */
export function History(): JSX.Element {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  // REG-10: admin deletes a snapshot (confirm lives in HistoryView) → refresh the list.
  const del = useMutation({
    mutationFn: (id: string) => api.deleteSnapshot(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['snapshots'] }),
  });
  const q = useQuery({ queryKey: ['snapshots'], queryFn: api.listSnapshots });
  return (
    <HistoryView
      status={q.status}
      snapshots={q.data ?? []}
      isAdmin={isAdmin}
      onDelete={(id) => del.mutate(id)}
      deleteError={del.isError}
    />
  );
}
