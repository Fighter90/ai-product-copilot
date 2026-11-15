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
});
