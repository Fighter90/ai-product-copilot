import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useT } from '../../i18n';
import { useAuth } from '../../auth/AuthContext';
import { TOUR_RESTART_EVENT, isTourDone, markTourDone, tourSteps, type TourRole } from './tour';

/**
 * First-visit step tour, different for each role (ANA-47). Non-modal card at the bottom of the
 * screen: Next/Back walk through the cabinet sections, «Пропустить» / Escape dismiss it for good;
 * «Пройти тур заново» in Help clears the flag and restarts it.
 */
export function OnboardingTour({
  role,
}: {
  role: TourRole | null | undefined;
}): JSX.Element | null {
  const { t } = useT();
  const navigate = useNavigate();
  const titleId = useId();
  const [open, setOpen] = useState(() => !!role && !isTourDone(role));
  const [index, setIndex] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIndex(0);
    setOpen(!!role && !isTourDone(role));
  }, [role]);

  useEffect(() => {
    const onRestart = () => {
      if (!role) return;
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_RESTART_EVENT, onRestart);
    return () => window.removeEventListener(TOUR_RESTART_EVENT, onRestart);
  }, [role]);

  useEffect(() => {
    if (open) nextRef.current?.focus({ preventScroll: true });
  }, [open, index]);

  const steps = role ? tourSteps(role) : [];
  const step = steps[index];

  const finish = (): void => {
    if (role) markTourDone(role);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open || !role || !step) return null;

  const go = (i: number): void => {
    setIndex(i);
    const to = steps[i]?.to;
    if (to) navigate(to);
  };
  const last = index === steps.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="onboarding-tour"
      className="fixed inset-x-4 bottom-20 z-40 mx-auto max-w-md rounded-xl border border-accent/40 bg-raised p-4 shadow-2xl animate-fade-in lg:bottom-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            {t('hint.tour.step', { n: index + 1, total: steps.length })}
          </div>
          <h2 id={titleId} className="mt-1 text-base font-semibold">
            {t(step.title)}
          </h2>
        </div>
        <button
          type="button"
          onClick={finish}
          aria-label={t('hint.tour.skip')}
          className="shrink-0 rounded-md p-1 text-muted hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">{t(step.body)}</p>
      {last && <p className="mt-2 text-xs text-muted">{t('hint.tour.restartNote')}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" onClick={finish} className="text-xs text-muted hover:text-ink">
          {t('hint.tour.skip')}
        </button>
        <div className="flex gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={() => go(index - 1)}
              className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent"
            >
              {t('hint.tour.back')}
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={() => (last ? finish() : go(index + 1))}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            {last ? t('hint.tour.finish') : t('hint.tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The tour bound to the signed-in user's role (mounted once in the cabinet shell). */
export function CabinetTour(): JSX.Element | null {
  const { user } = useAuth();
  const role: TourRole | null = user ? (user.role === 'admin' ? 'admin' : 'analyst') : null;
  return <OnboardingTour role={role} />;
}
