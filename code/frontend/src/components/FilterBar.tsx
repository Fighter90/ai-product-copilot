import { useFilters, formatDateLabel, isoDaysAgo, type Segment } from '../store/filters';
import { useRef, useState } from 'react';
import { useT } from '../i18n';

const PRESETS = [7, 14, 30, 90, 365] as const;
const MAX_DAYS = 365; // Maximum allowed period: 1 year

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
  const { t } = useT();
  const { from, to, segment, showArchived, setRange, setSegment, toggleArchived, preset } =
    useFilters();
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const datesToggleRef = useRef<HTMLButtonElement>(null);
  // On <768px the controls collapse into a bottom-sheet toggled by «Фильтры».
  const [sheetOpen, setSheetOpen] = useState(false);

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
        {formatDateLabel(from)} — {formatDateLabel(to)}
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
        {/* Preset buttons */}
        {PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => applyPreset(d)}
            aria-pressed={isPresetActive(d)}
            aria-label={d === 365 ? t('flt.presetYearHint') : t('flt.presetDaysHint', { d })}
            title={d === 365 ? t('flt.presetYearHint') : t('flt.presetDaysHint', { d })}
            className={`rounded border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-indigo-600 ${
              isPresetActive(d)
                ? 'border-indigo-500 bg-indigo-100 text-indigo-800'
                : 'border-slate-300 hover:bg-slate-100'
            }`}
          >
            {d === 365 ? t('flt.presetYear') : t('flt.presetDays', { d })}
          </button>
        ))}

        {/* Custom date picker toggle */}
        <button
          ref={datesToggleRef}
          type="button"
          onClick={() => setShowCustom(!showCustom)}
          aria-expanded={showCustom}
          aria-label={t('flt.datesHint')}
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
              <b>B2C:</b> только потребительские каналы (Direct, Search, Social и др.)
            </p>
            <p className="mt-1">
              <b>B2C+B2B:</b> все каналы (по умолчанию)
            </p>
            <p className="mt-1">
              <b>B2B:</b> только B2B-каналы (если настроены)
            </p>
          </div>
        </div>

        {/* Archived goals checkbox with tooltip */}
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
