import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChannelStat } from '@pca/shared';
import { KpiStrip } from './KpiStrip';
import { goalPace } from './goal-pace';
import { summarizeChannels, type WeakSpot } from '../../lib/overview';

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
});
