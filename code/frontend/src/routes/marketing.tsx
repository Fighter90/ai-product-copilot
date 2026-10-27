import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, FileDown } from 'lucide-react';
import type { MarketingCell, MarketingGrid } from '@pca/shared';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useT, fmtDate } from '../i18n';
import { Card, ErrorBox, PageHeader, Skeleton } from '../components/ui';
import { PageHelpLink } from '../components/PageHelpLink';

/**
 * ANA-73: «Маркетинг и инфопартнёры» — the dashboard replacement for the Google Sheet
 * «Инфопартнеры ProductCamp | лето 2026» (лист «стата»). The grid copies the sheet 1-to-1:
 * campaign weeks (irregular splits kept as in the source) × metric rows. Metrika-derived rows
 * are refreshed by the admin sync; every cell can be entered/corrected by hand — a manual edit
 * is never overwritten by the sync, and each cell shows its source and last editor.
 */

interface MarketingViewProps {
  grid: MarketingGrid;
  isAdmin: boolean;
  syncing?: boolean;
  syncMessage?: string;
  onCellSave: (input: { weekStart: string; metricKey: string; value: number }) => void;
  onSync: () => void;
}

/** Source → legend colour (also the cell's left border). */
const SOURCE_STYLE: Record<MarketingCell['source'], string> = {
  manual: 'border-l-accent',
  metrika: 'border-l-emerald-500',
  import: 'border-l-sky-500',
};

/** One editable grid cell: type a number, Enter/blur saves, Esc cancels. */
function EditableCell({
  cell,
  onSave,
}: {
  cell: MarketingCell | undefined;
  onSave: (value: number) => void;
}): JSX.Element {
  const { t, locale } = useT();
  const [draft, setDraft] = useState(cell ? String(cell.value) : '');
  const [invalid, setInvalid] = useState(false);

  // Re-sync the draft when the cell changes underneath (sync, another editor).
  useEffect(() => {
    setDraft(cell ? String(cell.value) : '');
    setInvalid(false);
  }, [cell]);

  const dirty = draft !== (cell ? String(cell.value) : '');

  const save = (): void => {
    if (!dirty) return;
    const value = Number(draft.replace(',', '.').trim());
    if (draft.trim() === '' || !Number.isFinite(value) || value < 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSave(value);
  };

  const hint = cell
    ? t('mk.cellHint', {
        source: t(`mk.source.${cell.source}`),
        by: cell.updatedBy ?? '—',
        date: fmtDate(cell.updatedAt, locale, true),
      })
    : t('mk.empty');

  return (
    <td className="border-l border-line p-0 align-middle">
      <input
        aria-label={hint}
        title={hint}
        inputMode="decimal"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(cell ? String(cell.value) : '');
            setInvalid(false);
          }
        }}
        className={`w-full bg-transparent px-2 py-1.5 text-right text-sm tabular-nums outline-none transition focus:bg-raised ${
          cell ? `border-l-2 ${SOURCE_STYLE[cell.source]}` : ''
        } ${invalid ? 'text-red-500' : ''} ${dirty ? 'font-semibold' : ''}`}
        placeholder="—"
      />
    </td>
  );
}

export function MarketingView(props: MarketingViewProps): JSX.Element {
  const { grid, isAdmin, syncing, syncMessage, onCellSave, onSync } = props;
  const { t, locale } = useT();
  const cellKey = (w: string, m: string): string => `${w}|${m}`;
  const byKey = new Map(grid.cells.map((c) => [cellKey(c.weekStart, c.metricKey), c]));

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        title={t('mk.title')}
        subtitle={t('mk.subtitle')}
        actions={
          <>
            {isAdmin && (
              <button className="btn btn-primary" onClick={onSync} disabled={syncing}>
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? t('mk.syncing') : t('mk.sync')}
              </button>
            )}
            <a className="btn btn-ghost" href="/api/marketing/weekly.csv">
              <FileDown className="h-4 w-4" />
              CSV
            </a>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        {(['manual', 'metrika', 'import'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full border-l-2 ${SOURCE_STYLE[s]} bg-raised`}
            />
            {t(`mk.source.${s}`)}
          </span>
        ))}
      </div>

      {syncMessage && <p className="mb-3 text-sm text-emerald-500">{syncMessage}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-2 text-left font-semibold"
              >
                {t('mk.metric')}
              </th>
              {grid.months
                .filter((m) => grid.weeks.some((w) => w.month === m.key))
                .map((m) => (
                  <th
                    key={m.key}
                    colSpan={grid.weeks.filter((w) => w.month === m.key).length}
                    className="border-b border-line px-3 py-2 text-center text-xs font-bold uppercase tracking-wider text-muted"
                  >
                    {locale === 'ru' ? m.ru : m.en}
                  </th>
                ))}
            </tr>
            <tr>
              {grid.weeks.map((w) => (
                <th
                  key={w.key}
                  title={`${w.start} … ${w.end}`}
                  className="border-b border-line px-2 py-1.5 text-center text-[11px] font-medium text-muted"
                >
                  {locale === 'ru' ? w.labelRu : w.labelEn}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.sections.map((s) => (
              <Fragment key={s.key}>
                <tr>
                  <td
                    colSpan={grid.weeks.length + 1}
                    className="border-b border-line bg-raised px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted"
                  >
                    {locale === 'ru' ? s.ru : s.en}
                  </td>
                </tr>
                {grid.metrics
                  .filter((m) => m.section === s.key)
                  .map((m) => (
                    <tr key={m.key} className="hover:bg-canvas/50">
                      <td className="sticky left-0 z-10 border-r border-line bg-surface px-3 py-1.5 font-medium">
                        {locale === 'ru' ? m.ru : m.en}
                        {m.sync && (
                          <span
                            className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle"
                            title={t('mk.syncable')}
                          />
                        )}
                      </td>
                      {grid.weeks.map((w) => (
                        <EditableCell
                          key={cellKey(w.key, m.key)}
                          cell={byKey.get(cellKey(w.key, m.key))}
                          onSave={(value) =>
                            onCellSave({ weekStart: w.key, metricKey: m.key, value })
                          }
                        />
                      ))}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function Marketing(): JSX.Element {
  const { t } = useT();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marketing-weekly'], queryFn: api.marketingWeekly });
  const [syncMessage, setSyncMessage] = useState<string | undefined>();

  const saveCell = useMutation({
    mutationFn: api.saveMarketingCell,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing-weekly'] }),
  });
  const sync = useMutation({
    mutationFn: () => api.marketingSync(),
    onSuccess: (res) => {
      const written = Object.values(res.updated).reduce((a, b) => a + b, 0);
      setSyncMessage(
        t('mk.syncDone', { written: String(written), skipped: String(res.skippedWeeks.length) }),
      );
      qc.invalidateQueries({ queryKey: ['marketing-weekly'] });
    },
  });

  return (
    <>
      <PageHelpLink />
      {q.isError && <ErrorBox error={q.error} />}
      {q.data ? (
        <MarketingView
          grid={q.data}
          isAdmin={isAdmin}
          syncing={sync.isPending}
          syncMessage={syncMessage}
          onCellSave={(input) => saveCell.mutate(input)}
          onSync={() => sync.mutate()}
        />
      ) : (
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
          <Skeleton className="h-96" />
        </div>
      )}
    </>
  );
}
