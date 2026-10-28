import { useFilters, isoDaysAgo, type Segment } from '../store/filters';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT, fmtDate } from '../i18n';
import { api, http } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

const PRESETS = [7, 14, 30, 90, 365] as const;
const MAX_DAYS = 365; // Maximum allowed period: 1 year

/** GET /api/metrics/coverage (ANA-49): how far back the cached data reaches. */
interface Coverage {
  from: string | null;
  to: string | null;
  days: number;
}

/** Local (UTC) calendar day before `iso`, as YYYY-MM-DD. */
function dayBefore(iso: string): string {
  return new Date(Date.parse(iso) - 86_400_000).toISOString().slice(0, 10);
}

/** Calculate days between two dates. */
function daysBetween(from: string, to: string): number {
  const d1 = new Date(from);
  const d2 = new Date(to);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Validate a custom range without mutating anything (ANA-49): both dates set,
 * from ≤ to (a single day is allowed), from not in the future — Metrika serves
 * no future data — and at most MAX_DAYS days. Returns the violation id or null.
 */
function rangeError(from: string, to: string): 'empty' | 'order' | 'future' | 'max' | null {
  if (!from || !to) return 'empty';
  if (from > to) return 'order';
  if (from > isoDaysAgo(0)) return 'future';
  if (daysBetween(from, to) > MAX_DAYS) return 'max';
  return null;
}

/** Sticky global filter header: period presets, custom date picker, segment toggle, archived toggle. */
export function FilterBar(): JSX.Element {
  const { t, locale } = useT();
  const {
    from,
    to,
    segment,
    showArchived,
    includeTest,
    setRange,
    setSegment,
    toggleArchived,
    toggleTest,
    preset,
  } = useFilters();
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const datesToggleRef = useRef<HTMLButtonElement>(null);
  // On <768px the controls collapse into a bottom-sheet toggled by «Фильтры».
  const [sheetOpen, setSheetOpen] = useState(false);
  // БАГ-06: «Архивные цели» is a client-side filter over the goals list, but the Overview page
  // has no goals list — there the toggle would silently do nothing, so it is hidden on /app.
  const { pathname } = useLocation();
  const showArchivedToggle = pathname.replace(/\/+$/, '') !== '/app';

  // ANA-49: previous period of the same length — the comparison baseline for the KPI tiles.
  const periodDays = daysBetween(from, to) + 1;
  const prevTo = dayBefore(from);
  const prevFrom = dayBefore(
    new Date(Date.parse(from) - (periodDays - 1) * 86_400_000).toISOString().slice(0, 10),
  );

  // ANA-49: cached-data coverage → «Догрузить N дней» prompt when the selected period starts
  // before the first synced day; admins trigger a range sync right from the prompt.
  const { isAdmin } = useAuth();
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [backfill, setBackfill] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  useEffect(() => {
    let alive = true;
    http<Coverage>('/metrics/coverage')
      .then((c) => {
        if (alive && c && typeof c.from === 'string') setCoverage(c);
      })
      .catch(() => {}); // coverage is advisory — a failed probe just hides the prompt
    return () => {
      alive = false;
    };
  }, [backfill]);
  const coverageFrom = typeof coverage?.from === 'string' ? coverage.from : null;
  const missingDays = coverageFrom
    ? Math.max(0, Math.round((Date.parse(coverageFrom) - Date.parse(from)) / 86_400_000))
    : 0;
  const needsBackfill = coverageFrom !== null && missingDays > 0;

  const runBackfill = async (): Promise<void> => {
    if (!coverageFrom) return;
    setBackfill('running');
    try {
      // Sync the gap [from … day before the first cached day]; when the cache starts after
      // the whole period, sync the selected range itself.
      const gapEnd = dayBefore(coverageFrom);
      await api.sync({ from, to: gapEnd >= from && gapEnd <= to ? gapEnd : to });
      setBackfill('done'); // the [backfill] effect re-probes coverage
    } catch {
      setBackfill('failed');
    }
  };

  // Live validation (ANA-49): «Применить» stays disabled with a hint while the range is invalid.
  const error = rangeError(customFrom, customTo);
  const errorText =
    error === 'max'
      ? t('flt.error.max', { n: MAX_DAYS })
      : error === 'order'
        ? t('flt.error.order')
        : error === 'future'
          ? t('flt.error.future')
          : error === 'empty'
            ? t('flt.error.empty')
            : '';

  // A preset is «active» while the store range matches it exactly (ending today).
  const isPresetActive = (d: number) => to === isoDaysAgo(0) && daysBetween(from, to) === d - 1;

  const closeCustom = () => {
    setShowCustom(false);
    datesToggleRef.current?.focus(); // return focus to the trigger (a11y)
  };

  /** Preset click: apply the range and reset the custom fields to it (ANA-49). */
  const applyPreset = (d: number) => {
    preset(d);
    setCustomFrom(isoDaysAgo(d - 1));
    setCustomTo(isoDaysAgo(0));
    setShowCustom(false);
  };

  const handleCustomApply = () => {
    if (error !== null) return;
    setRange(customFrom, customTo);
    closeCustom();
  };

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur sm:px-6 sm:py-3">
      {/* Date display */}
      <span className="hidden font-mono text-sm text-slate-600 sm:block">
        {fmtDate(from, locale)} — {fmtDate(to, locale)}
      </span>
      {/* ANA-49: comparison baseline shown next to the period */}
      <span className="hidden text-xs text-slate-400 sm:block" title={t('dq.prevPeriodHint')}>
        {t('dq.prevPeriodVs', { from: fmtDate(prevFrom, locale), to: fmtDate(prevTo, locale) })}
      </span>

      {/* Mobile trigger: opens the controls as a bottom-sheet (<768px only) */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-expanded={sheetOpen}
        aria-controls="filter-controls"
        className="ml-auto rounded border border-slate-300 px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-600 md:hidden"
      >
        {t('flt.open')}
        {/* ANA-49: the collapsed filters still indicate the current period */}
        <span className="ml-1 font-mono text-xs text-slate-500">{fmtDate(from, locale)}</span>
      </button>

      {/* Backdrop behind the mobile sheet */}
      {sheetOpen && (
        <button
          type="button"
          aria-label={t('flt.close')}
          onClick={() => setSheetOpen(false)}
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
        />
      )}

      {/* Controls: inline on ≥768px, bottom-sheet on mobile */}
      <div
        id="filter-controls"
        className={`${
          sheetOpen ? 'flex' : 'hidden'
        } fixed inset-x-0 bottom-0 z-30 max-h-[80vh] flex-col gap-2 overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-4 shadow-2xl md:static md:z-auto md:flex md:max-h-none md:flex-row md:flex-wrap md:items-center md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none`}
      >
        {/* ANA-49: mobile sheet shows the current period and its comparison baseline */}
        <p className="font-mono text-xs text-slate-500 md:hidden">
          {fmtDate(from, locale)} — {fmtDate(to, locale)}{' '}
          {t('dq.prevPeriodVs', { from: fmtDate(prevFrom, locale), to: fmtDate(prevTo, locale) })}
        </p>

        {/* ANA-49: «Догрузить N дней» when the cached data starts inside the selected period */}
        {needsBackfill && coverageFrom && (
          <div
            role="status"
            className="flex w-full flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 md:w-auto"
          >
            <span>
              {t('dq.backfillNeeded', { date: fmtDate(coverageFrom, locale), n: missingDays })}
            </span>
            <button
              type="button"
              onClick={runBackfill}
              disabled={!isAdmin || backfill === 'running'}
              title={isAdmin ? undefined : t('dq.backfillAdminOnly')}
              className="rounded bg-amber-600 px-2 py-0.5 text-xs text-white hover:bg-amber-700 focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {backfill === 'running'
                ? t('dq.backfillRunning')
                : t('dq.backfillAction', { n: missingDays })}
            </button>
            {!isAdmin && <span className="sr-only">{t('dq.backfillAdminOnly')}</span>}
            {backfill === 'done' && <span>{t('dq.backfillDone')}</span>}
            {backfill === 'failed' && (
              <span role="alert" className="text-red-700">
                {t('dq.backfillFailed')}
              </span>
            )}
          </div>
        )}

        {/* Preset buttons */}
        {PRESETS.map((d) => {
          // WCAG 2.5.3 Label in Name: the accessible name must contain the visible
          // «7д»/«1г» text, so the hint is appended to it instead of replacing it.
          const presetLabel = d === 365 ? t('flt.presetYear') : t('flt.presetDays', { d });
          const presetHint = d === 365 ? t('flt.presetYearHint') : t('flt.presetDaysHint', { d });
          return (
            <button
              key={d}
              type="button"
              onClick={() => applyPreset(d)}
              aria-pressed={isPresetActive(d)}
              aria-label={`${presetLabel} — ${presetHint}`}
              title={presetHint}
              className={`rounded border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-600 ${
                isPresetActive(d)
                  ? 'border-indigo-500 bg-indigo-100 text-indigo-800'
                  : 'border-slate-300 hover:bg-slate-100'
              }`}
            >
              {presetLabel}
            </button>
          );
        })}

        {/* Custom date picker toggle */}
        <button
          ref={datesToggleRef}
          type="button"
          onClick={() => setShowCustom(!showCustom)}
          aria-expanded={showCustom}
          aria-label={`${t('flt.dates')} — ${t('flt.datesHint')}`}
          title={t('flt.datesHint')}
          className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          📅 {t('flt.dates')}
        </button>
        {showCustom && (
          <div
            role="group"
            aria-label={t('flt.dates')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeCustom(); // Esc closes the picker (ANA-49)
            }}
            className="flex w-full flex-col gap-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 sm:w-auto sm:flex-row sm:items-center"
          >
            <div className="flex items-center gap-2">
              <label htmlFor="custom-date-from" className="text-xs text-indigo-700">
                {t('flt.from')}
              </label>
              <input
                id="custom-date-from"
                type="date"
                value={customFrom}
                max={isoDaysAgo(0)} // Metrika serves no future data
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label={t('flt.fromAria')}
                aria-invalid={
                  error === 'order' || error === 'future' || error === 'empty' ? true : undefined
                }
                className="rounded border border-indigo-300 px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-600"
              />
              <label htmlFor="custom-date-to" className="text-xs text-indigo-700">
                {t('flt.to')}
              </label>
              <input
                id="custom-date-to"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label={t('flt.toAria')}
                aria-invalid={error === 'order' || error === 'empty' ? true : undefined}
                className="rounded border border-indigo-300 px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-600"
              />
              <button
                type="button"
                onClick={handleCustomApply}
                disabled={error !== null}
                aria-describedby="flt-range-hint"
                className="rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('flt.apply')}
              </button>
            </div>
            {errorText ? (
              <p id="flt-range-hint" role="alert" className="text-xs text-red-700">
                {errorText}
              </p>
            ) : (
              <p id="flt-range-hint" className="text-xs text-indigo-600">
                {t('flt.applyHint')}
              </p>
            )}
            <button
              type="button"
              onClick={closeCustom}
              aria-label={t('common.close')}
              className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              ✕
            </button>
          </div>
        )}

        {/* Segment selector with tooltip */}
        <div className="group relative">
          <select
            aria-label={t('flt.segment')}
            value={segment}
            onChange={(e) => setSegment(e.target.value as Segment)}
            className="rounded border border-slate-300 px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <option value="b2c">B2C</option>
            <option value="b2c_b2b">B2C+B2B</option>
            <option value="b2b">B2B</option>
          </select>
          {/* Tooltip (hover and keyboard focus) */}
          <div className="absolute left-0 top-full z-20 mt-1 hidden w-64 rounded border border-slate-200 bg-white p-2 text-xs text-slate-600 shadow group-hover:block group-focus-within:block">
            <p>
              <b>B2C:</b> {t('an.flt.segB2c')}
            </p>
            <p className="mt-1">
              <b>B2C+B2B:</b> {t('an.flt.segAll')}
            </p>
            <p className="mt-1">
              <b>B2B:</b> {t('an.flt.segB2b')}
            </p>
          </div>
        </div>

        {/* Archived goals checkbox with tooltip — hidden on Обзор, where no goals list exists */}
        {showArchivedToggle && (
          <div className="group relative">
            <label className="flex cursor-pointer items-center gap-1 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={toggleArchived}
                className="focus-visible:ring-2 focus-visible:ring-indigo-600"
              />
              {t('filters.archivedGoals')}
            </label>
            {/* Tooltip (hover and keyboard focus) */}
            <div className="absolute left-0 top-full z-20 mt-1 hidden w-64 rounded border border-slate-200 bg-white p-2 text-xs text-slate-600 shadow group-hover:block group-focus-within:block">
              <p>{t('filters.archivedGoalsHint')}</p>
            </div>
          </div>
        )}

        {/* ANA-22: test/service traffic is excluded by default — the toggle brings it back */}
        <div className="group relative">
          <label className="flex cursor-pointer items-center gap-1 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeTest}
              onChange={toggleTest}
              aria-label={t('dh.flt.includeTest')}
              className="focus-visible:ring-2 focus-visible:ring-indigo-600"
            />
            {t('dh.flt.includeTest')}
          </label>
          {/* Tooltip (hover and keyboard focus) */}
          <div className="absolute left-0 top-full z-20 mt-1 hidden w-64 rounded border border-slate-200 bg-white p-2 text-xs text-slate-600 shadow group-hover:block group-focus-within:block">
            <p>{t('dh.flt.includeTestHint')}</p>
          </div>
        </div>

        {/* Mobile-only sheet close button */}
        <button
          type="button"
          onClick={() => setSheetOpen(false)}
          className="mt-2 rounded bg-indigo-600 px-3 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1 md:hidden"
        >
          {t('flt.done')}
        </button>
      </div>
    </header>
  );
}
