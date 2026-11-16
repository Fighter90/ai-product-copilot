import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChannelStat } from '@pca/shared';
import { KpiStrip } from './KpiStrip';
import { goalPace } from './goal-pace';
import { summarizeChannels, type WeakSpot } from '../../lib/overview';
import { useFilters } from '../../store/filters';
import { setTestLocale } from '../../test/i18n-utils';

const ch = (date: string, channel: string, visits: number, goalReaches: number): ChannelStat => ({
  date,
  channel,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  visits,
  users: Math.round(visits * 0.9),
  bounceRate: 0.2,
  avgDuration: 60,
  goalReaches,
  conversionRate: goalReaches / visits,
});

const weak: WeakSpot = { channel: 'podcast', visits: 420, conversionRate: 0.0286 };

describe('KpiStrip (ANA-146 mobile no-overflow)', () => {
  it('the hero weak-spot detail line may wrap on mobile — no bare whitespace-nowrap', () => {
    // E2E mobile (iPhone 14, 390px) fell on «/app fits the viewport»: a `whitespace-nowrap`
    // chunk inside the hero text block is the only unbreakable run of that page — jsdom cannot
    // measure scrollWidth, so the structural guarantee is that the span stays wrappable
    // (same rationale as the overflow-x-auto assertions in routes/traffic.test.tsx).
    const kpi = summarizeChannels([ch('2025-01-01', 'podcast', 420, 12)], [], false, 300, 0);
    const pace = goalPace({
      points: [{ date: '2025-01-01', visits: 420, reaches: 12 }],
      to: '2025-01-01',
      target: kpi.target,
      current: kpi.paid,
      goalIsPaid: false,
    });
    render(
      <KpiStrip kpi={kpi} pace={pace} goalIsPaid={false} showApplicationsCaveat weakSpot={weak} />,
    );
    const detail = screen.getByText(/при 420 визитах/);
    // The class must not appear un-prefixed: `sm:whitespace-nowrap` (or none) keeps ≤640px wrappable.
    expect(detail.className).not.toMatch(/(^|\s)whitespace-nowrap(\s|$)/);
  });

  it('ANA-168: the target tile shows the deadline date («до {дата}»)', () => {
    setTestLocale('ru');
    const kpi = summarizeChannels([ch('2025-01-01', 'podcast', 420, 12)], [], false, 300, 0);
    const pace = goalPace({
      points: [{ date: '2025-01-01', visits: 420, reaches: 12 }],
      to: '2025-01-01',
      target: kpi.target,
      current: kpi.paid,
      goalIsPaid: false,
    });
    render(
      <KpiStrip kpi={kpi} pace={pace} goalIsPaid={false} showApplicationsCaveat weakSpot={weak} />,
    );
    // 1 fact day → deadline = 2025-01-01 + 2 = 2025-01-03; the «Цель» tile repeats the date.
    const date = new Date('2025-01-03T00:00:00').toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    });
    expect(screen.getByText(`до ${date}`)).toBeInTheDocument();
  });

  it('ANA-167: the order-goal tile hint explains «Заказ» with the period dates', () => {
    setTestLocale('ru');
    useFilters.getState().setRange('2025-01-01', '2025-01-07');
    const kpi = summarizeChannels([ch('2025-01-01', 'podcast', 420, 12)], [], true, 300, 0);
    const pace = goalPace({
      points: [{ date: '2025-01-01', visits: 420, reaches: 12 }],
      to: '2025-01-01',
      target: kpi.target,
      current: kpi.paid,
      goalIsPaid: true,
    });
    render(
      <KpiStrip kpi={kpi} pace={pace} goalIsPaid showApplicationsCaveat={false} weakSpot={weak} />,
    );
    // The InfoHint popover stays in the DOM — its text explains the order goal with the period.
    const hint = screen.getByText(/goal_reaches/);
    expect(hint.textContent).toContain('с 2025-01-01 до 2025-01-07');
    expect(hint.textContent).toContain('Заказ ≠ платный билет');
  });

  it('ANA-166: the SMART statement renders in the hero (hero-smart)', () => {
    setTestLocale('ru');
    const kpi = summarizeChannels([ch('2025-01-01', 'podcast', 420, 12)], [], false, 300, 0);
    const pace = goalPace({
      points: [{ date: '2025-01-01', visits: 420, reaches: 12 }],
      to: '2025-01-01',
      target: kpi.target,
      current: kpi.paid,
      goalIsPaid: false,
    });
    render(
      <KpiStrip
        kpi={kpi}
        pace={pace}
        goalIsPaid={false}
        showApplicationsCaveat
        weakSpot={weak}
        smart="Достичь ≥300 платных билетов к 15.01.2025 — сейчас 0, осталось 300 (~22 в день)."
      />,
    );
    expect(screen.getByTestId('hero-smart')).toHaveTextContent('Достичь ≥300 платных билетов');
  });

  it('ANA-171: a paid pace shows «Темп оплат», never the applications upper-estimate line', () => {
    setTestLocale('ru');
    const kpi = summarizeChannels([ch('2025-01-01', 'podcast', 420, 12)], [], false, 300, 0);
    const pace = goalPace({
      points: [{ date: '2025-01-01', visits: 0, reaches: 15 }],
      to: '2025-01-01',
      target: kpi.target,
      current: 15,
      goalIsPaid: true,
    });
    render(
      <KpiStrip kpi={kpi} pace={pace} goalIsPaid showApplicationsCaveat={false} weakSpot={weak} />,
    );
    expect(screen.getByText(/Темп оплат: 15/)).toBeInTheDocument();
    expect(screen.queryByText(/Темп заявок/)).toBeNull();
  });

  it('ANA-166: after the deadline the hero switches to the expired state — итог instead of forecast', () => {
    setTestLocale('ru');
    const kpi = summarizeChannels([ch('2025-01-01', 'podcast', 420, 12)], [], false, 300, 0);
    const pace = goalPace({
      points: [{ date: '2025-01-01', visits: 420, reaches: 12 }],
      to: '2025-01-01',
      target: kpi.target,
      current: kpi.paid,
      goalIsPaid: false,
    });
    render(
      <KpiStrip
        kpi={kpi}
        pace={pace}
        goalIsPaid={false}
        showApplicationsCaveat
        weakSpot={weak}
        expired
      />,
    );
    // The pill says the deadline passed (not «успеваем/не успеваем»).
    expect(screen.getByTestId('pace-status')).toHaveTextContent('Дедлайн прошёл');
    // The forecast line is replaced by the honest final count + the reset pointer.
    expect(screen.getByTestId('hero-expired-final')).toHaveTextContent('Итог: 0 из 300 билетов');
    expect(screen.queryByText(/Прогноз:/)).toBeNull();
    expect(screen.getByText(/«Сбросить цель»/)).toBeInTheDocument();
  });

  it('ANA-166: expired is ignored when the goal is reached (status pill keeps «Цель достигнута»)', () => {
    setTestLocale('ru');
    const kpi = summarizeChannels([], [], false, 300, 0);
    const pace = goalPace({
      points: [],
      to: '2025-01-01',
      target: kpi.target,
      current: 300,
      goalIsPaid: false,
    });
    render(<KpiStrip kpi={kpi} pace={pace} goalIsPaid={false} showApplicationsCaveat expired />);
    expect(screen.getByTestId('pace-status')).toHaveTextContent('Цель достигнута');
    expect(screen.queryByTestId('hero-expired-final')).toBeNull();
  });
});
