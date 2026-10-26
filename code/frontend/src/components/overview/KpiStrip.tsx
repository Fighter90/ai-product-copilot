import { channelName, fmtNum, useT } from '../../i18n';
import type { Locale } from '../../store/prefs';
import { formatInt, formatPercent } from '../../lib/format';
import type { OverviewKpi, WeakSpot } from '../../lib/overview';
import { Tooltip } from '../Tooltip';
import type { GoalPace, PaceStatus } from './goal-pace';
import { ProgressRing } from './ProgressRing';

/** «12 нояб.» / «12 Nov» — the hero is narrow, the year is implied by the selected period. */
function shortDate(iso: string, locale: Locale): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

const STATUS_TONE: Record<PaceStatus, string> = {
  reached: 'bg-green-100 text-green-800',
  onTrack: 'bg-green-100 text-green-800',
  onTime: 'bg-amber-100 text-amber-800',
  behind: 'bg-red-100 text-red-800',
  unreachable: 'bg-red-100 text-red-800',
};

/**
 * ANA-48 first screen: answers «успеваем к цели?» — progress ring (paid / target), status vs the
 * deadline, projected date at the current pace, the main weak spot — plus the compact KPI tiles.
 * Always the first block of the Overview so it stays above the fold at 1280×800 and 375×812.
 */
export function KpiStrip({
  kpi,
  pace,
  goalIsPaid,
  showApplicationsCaveat,
  weakSpot,
}: {
  kpi: OverviewKpi;
  pace: GoalPace;
  goalIsPaid: boolean;
  showApplicationsCaveat: boolean;
  weakSpot?: WeakSpot;
}): JSX.Element {
  const { t, locale } = useT();
  const target = formatInt(kpi.target);
  const statusText =
    pace.status === 'reached'
      ? t('ov.hero.reached')
      : pace.status === 'onTrack'
        ? t('ov.hero.onTrack', { n: Math.abs(pace.deviationDays ?? 0) })
        : pace.status === 'onTime'
          ? t('ov.hero.onTime')
          : pace.status === 'behind'
            ? t('ov.hero.behind', { n: pace.deviationDays ?? 0 })
            : t('ov.hero.unreachable');
  const deadline = shortDate(pace.deadline, locale);
  const paceText = fmtNum(pace.perDay, locale, 1);

  return (
    <section data-testid="kpi-strip" aria-label={t('ov.strip.aria')} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:p-4">
          <ProgressRing
            progress={pace.progress}
            label={formatInt(kpi.paid)}
            caption={t('ov.hero.ofTarget', { target })}
            ariaLabel={t('ov.hero.ringAria', { current: formatInt(kpi.paid), target })}
          />
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold lg:text-base">{t('ov.hero.title', { target })}</h2>
            <span
              data-testid="pace-status"
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[pace.status]}`}
            >
              {statusText}
            </span>
            {pace.status !== 'reached' ? (
              <>
                <p className="text-xs text-slate-600">
                  {pace.forecastDate
                    ? t('ov.hero.forecast', {
                        date: shortDate(pace.forecastDate, locale),
                        deadline,
                      })
                    : t('ov.hero.forecastNone', { deadline })}
                </p>
                <p className="hidden text-xs text-slate-500 sm:block">
                  {pace.isUpperEstimate
                    ? t('ov.hero.paceUpper', { pace: paceText })
                    : t('ov.hero.pace', { pace: paceText })}
                </p>
              </>
            ) : null}
            <p className="text-xs text-slate-600">
              <Tooltip text={t('ov.hero.weakSpotHint')}>{t('ov.hero.weakSpot')}:</Tooltip>{' '}
              {weakSpot ? (
                <>
                  <a href="#weak-spots" className="font-semibold text-red-700 hover:underline">
                    {channelName(weakSpot.channel, locale)}
                  </a>{' '}
                  <span className="whitespace-nowrap text-slate-500">
                    {t('ov.hero.weakSpotDetail', {
                      cr: formatPercent(weakSpot.conversionRate),
                      visits: formatInt(weakSpot.visits),
                    })}
                  </span>
                </>
              ) : (
                <span className="font-semibold text-green-700">{t('ov.hero.noWeakSpot')}</span>
              )}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3" data-testid="kpi-tiles">
          <Kpi label={t('kpi.ticketGoal')} value={target} />
          <Kpi
            label={goalIsPaid ? t('ov.kpi.orders') : t('ov.kpi.applications')}
            value={formatInt(kpi.applications)}
            hint={showApplicationsCaveat ? t('ov.kpi.applicationsHint') : undefined}
          />
          <Kpi label={t('ov.kpi.b2bPaid')} value={formatInt(kpi.b2bPaid)} />
          <Kpi
            label={t('ov.kpi.gap')}
            value={formatInt(kpi.gap)}
            hint={t('ov.kpi.gapHint', { paid: formatInt(kpi.paid), target })}
          />
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm lg:p-3">
      <div className="text-[11px] uppercase leading-tight tracking-wide text-slate-500 sm:text-xs">
        {label}
      </div>
      <div className="text-xl font-bold lg:text-2xl">{value}</div>
      {hint ? <div className="text-xs leading-tight text-amber-700">{hint}</div> : null}
    </div>
  );
}
