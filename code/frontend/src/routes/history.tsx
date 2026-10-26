import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatInt } from '../lib/format';

type QueryStatus = 'pending' | 'error' | 'success';

/** 'YYYY-MM-DD' → 'dd.MM' (или 'dd.MM.yyyy'). Строковый парсинг — без сдвигов часовых поясов. */
function formatDay(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return withYear ? `${d}.${m}.${y}` : `${d}.${m}`;
}

/**
 * Человеческое имя отчёта из периода снапшота: «Отчёт 12.10–25.10.2026».
 * Год указывается один раз в конце, если годы совпадают; иначе у обеих дат —
 * «Отчёт 25.12.2025–10.01.2026».
 */
export function formatSnapshotName(dateFrom: string, dateTo: string): string {
  const sameYear = dateFrom.slice(0, 4) === dateTo.slice(0, 4);
  return `Отчёт ${formatDay(dateFrom, !sameYear)}–${formatDay(dateTo, true)}`;
}

/** Короткий UUID для прослеживаемости к данным: 'a1b2c3d4…'. */
export function shortSnapshotId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

/** Pure presentational History view. */
export function HistoryView({
  status,
  snapshots,
}: {
  status: QueryStatus;
  snapshots: Array<{ id: string; generatedAt: string; dateFrom: string; dateTo: string }>;
}): JSX.Element {
  if (status === 'pending') return <p className="text-slate-500">Загрузка…</p>;
  if (status === 'error')
    return (
      <p role="alert" className="text-red-700">
        Не удалось загрузить историю отчётов.
      </p>
    );

  if (snapshots.length === 0)
    return (
      <div
        role="status"
        className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
      >
        Отчётов пока нет. Сформируйте срез данных на странице Report.
      </div>
    );

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">История отчётов</h2>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="История отчётов">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">Отчёт</th>
              <th>Сформирован</th>
              <th>Период</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-1">
                  <Link
                    to={`/app/report?snapshot=${s.id}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {formatSnapshotName(s.dateFrom, s.dateTo)}
                  </Link>
                  <div className="font-mono text-[10px] text-slate-400" title={s.id}>
                    {shortSnapshotId(s.id)}
                  </div>
                </td>
                <td>{new Date(s.generatedAt).toLocaleString('ru-RU')}</td>
                <td>
                  {s.dateFrom} — {s.dateTo}
                </td>
                <td>
                  <Link
                    to={`/app/report?snapshot=${s.id}`}
                    className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
                  >
                    Просмотреть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Всего отчётов: {formatInt(snapshots.length)}</p>
    </section>
  );
}

/** Data wrapper. */
export function History(): JSX.Element {
  const q = useQuery({ queryKey: ['snapshots'], queryFn: api.listSnapshots });
  return <HistoryView status={q.status} snapshots={q.data ?? []} />;
}
