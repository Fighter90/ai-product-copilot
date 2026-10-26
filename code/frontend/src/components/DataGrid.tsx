import { useMemo, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Search } from 'lucide-react';
import { useT, fmtNum } from '../i18n';

export type GridKind = 'text' | 'int' | 'float' | 'pct' | 'sec';

export interface GridColumn<T> {
  readonly id: string;
  readonly header: string;
  readonly kind?: GridKind;
  readonly accessor: (row: T) => string | number | null;
  readonly cell?: (row: T) => ReactNode;
  /** Sum (int/float) or weighted average (pct/sec, weighted by `weightId`) in the totals row. */
  readonly total?: 'sum' | 'avg' | 'none';
  readonly minWidth?: number;
  readonly hidden?: boolean;
}

/** CSV with BOM so Excel / DataLens read UTF-8 correctly. */
export function rowsToCsv<T>(cols: GridColumn<T>[], rows: T[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => esc(c.header)).join(',');
  const body = rows.map((r) => cols.map((c) => esc(c.accessor(r))).join(',')).join('\r\n');
  return `\uFEFF${head}\r\n${body}\r\n`;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Data grid: global search, per-column sort, column visibility, pagination, totals row and CSV export.
 * Built on TanStack Table (already in the stack).
 */
export function DataGrid<T>({
  columns,
  rows,
  fileName = 'export',
  pageSize = 50,
  initialSort,
  toolbar,
  onRowClick,
  dense,
}: {
  columns: GridColumn<T>[];
  rows: T[];
  fileName?: string;
  pageSize?: number;
  initialSort?: SortingState;
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  dense?: boolean;
}): JSX.Element {
  const { t, locale } = useT();
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  const [filter, setFilter] = useState('');
  const [showCols, setShowCols] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityState>(
    Object.fromEntries(columns.filter((c) => c.hidden).map((c) => [c.id, false])),
  );

  const fmt = (kind: GridKind | undefined, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v !== 'number') return String(v);
    switch (kind) {
      case 'int':
        return fmtNum(v, locale, 0);
      case 'float':
        return fmtNum(v, locale, 2);
      case 'pct':
        return `${fmtNum(v, locale, 2)}%`;
      case 'sec': {
        const m = Math.floor(v / 60);
        const s = Math.round(v % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
      }
      default:
        return String(v);
    }
  };

  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        accessorFn: (r: T) => c.accessor(r),
        cell: (ctx) => (c.cell ? c.cell(ctx.row.original) : fmt(c.kind, ctx.getValue())),
        sortingFn: c.kind && c.kind !== 'text' ? 'basic' : 'alphanumeric',
        size: c.minWidth,
      })),
    [columns, locale],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, globalFilter: filter, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageSize } },
  });

  const filtered = table.getFilteredRowModel().rows.map((r) => r.original);
  const totals = columns.map((c) => {
    if (!c.total || c.total === 'none') return null;
    const vals = filtered.map((r) => Number(c.accessor(r)) || 0);
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return c.total === 'sum' ? sum : sum / vals.length;
  });
  const visibleCols = columns.filter((c) => visibility[c.id] !== false);
  const pad = dense ? 'px-2 py-1.5' : 'px-3 py-2';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            className="input pl-8"
          />
        </label>
        {toolbar}
        <div className="relative">
          <button type="button" className="btn-ghost" onClick={() => setShowCols((v) => !v)}>
            <Columns3 className="h-4 w-4" /> {t('common.columns')}
          </button>
          {showCols && (
            <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-line bg-raised p-2 shadow-xl animate-fade-in">
              {columns.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface"
                >
                  <input
                    type="checkbox"
                    checked={visibility[c.id] !== false}
                    onChange={(e) => setVisibility((v) => ({ ...v, [c.id]: e.target.checked }))}
                  />
                  {c.header}
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => download(`${fileName}.csv`, rowsToCsv(visibleCols, filtered))}
        >
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-max text-sm">
          <thead className="sticky top-0 bg-raised text-left text-xs uppercase tracking-wide text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const col = columns.find((c) => c.id === h.column.id);
                  const num = col?.kind && col.kind !== 'text';
                  const dir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      className={`${pad} font-medium ${num ? 'text-right' : ''}`}
                      style={{ minWidth: col?.minWidth }}
                    >
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className={`inline-flex items-center gap-1 hover:text-ink ${num ? 'flex-row-reverse' : ''}`}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : dir === 'desc' ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30" />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr
                key={r.id}
                onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                className={`border-t border-line transition-colors ${onRowClick ? 'cursor-pointer hover:bg-accent/5' : ''}`}
              >
                {r.getVisibleCells().map((cell) => {
                  const col = columns.find((c) => c.id === cell.column.id);
                  const num = col?.kind && col.kind !== 'text';
                  return (
                    <td key={cell.id} className={`${pad} ${num ? 'text-right tabular-nums' : ''}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="px-3 py-8 text-center text-muted">
                  {t('common.noData')}
                </td>
              </tr>
            )}
          </tbody>
          {totals.some((x) => x !== null) && (
            <tfoot className="border-t-2 border-line bg-raised font-semibold">
              <tr>
                {visibleCols.map((c, i) => {
                  const idx = columns.indexOf(c);
                  const v = totals[idx];
                  return (
                    <td
                      key={c.id}
                      className={`${pad} ${c.kind && c.kind !== 'text' ? 'text-right' : ''}`}
                    >
                      {i === 0 && v === null ? t('common.total') : v === null ? '' : fmt(c.kind, v)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{t('common.rows', { n: filtered.length })}</span>
        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost px-2 py-1"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              ←
            </button>
            <span>
              {t('common.page', {
                p: table.getState().pagination.pageIndex + 1,
                n: table.getPageCount(),
              })}
            </span>
            <button
              type="button"
              className="btn-ghost px-2 py-1"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
