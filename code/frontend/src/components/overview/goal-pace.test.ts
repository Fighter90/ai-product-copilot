import { describe, it, expect } from 'vitest';
import { goalPace } from './goal-pace';

const pts = (n: number, reaches: number) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2025-01-${String(i + 1).padStart(2, '0')}`,
    visits: 100,
    reaches,
  }));

describe('goalPace', () => {
  it('is on track when the projected date lands before the deadline', () => {
    // 10 days × 10/day; 100 paid of 300 → 20 days more; deadline = to + 20 → exactly on time.
    const onTime = goalPace({
      points: pts(10, 10),
      to: '2025-01-10',
      target: 300,
      current: 100,
      goalIsPaid: true,
    });
    expect(onTime.status).toBe('onTime');
    expect(onTime.forecastDate).toBe('2025-01-30');
    expect(onTime.deadline).toBe('2025-01-30');
    const ahead = goalPace({
      points: pts(10, 20),
      to: '2025-01-10',
      target: 300,
      current: 100,
      goalIsPaid: true,
    });
    expect(ahead.status).toBe('onTrack');
    expect(ahead.deviationDays).toBe(-10);
    expect(ahead.isUpperEstimate).toBe(false);
  });

  it('is behind when the pace is too slow, unreachable at zero pace', () => {
    const behind = goalPace({ points: pts(10, 1), target: 300, current: 0, goalIsPaid: false });
    expect(behind.status).toBe('behind');
    expect(behind.isUpperEstimate).toBe(true);
    // `to` defaults to the last fact date.
    expect(behind.deadline).toBe('2025-01-30');
    const none = goalPace({ points: pts(5, 0), target: 300, current: 10, goalIsPaid: true });
    expect(none.status).toBe('unreachable');
    expect(none.forecastDate).toBeNull();
    expect(none.progress).toBeCloseTo(10 / 300);
  });

  it('reports reached and clamps progress at 100%', () => {
    const r = goalPace({ points: pts(3, 1), target: 300, current: 320, goalIsPaid: true });
    expect(r.status).toBe('reached');
    expect(r.progress).toBe(1);
  });

  it('ANA-171: a paid daily series forecasts the PAID goal; zero paid pace → honest unreachable', () => {
    // The Overview hero input after ANA-171: dense paid series (B2C payments + B2B paid deals)
    // over the Metrika window — the same money the progress ring counts.
    const paidSeries = [
      { date: '2025-01-01', visits: 0, reaches: 15 },
      { date: '2025-01-02', visits: 0, reaches: 15 },
    ];
    const pace = goalPace({
      points: paidSeries,
      to: '2025-01-02',
      target: 300,
      current: 30,
      goalIsPaid: true,
    });
    expect(pace.isUpperEstimate).toBe(false);
    expect(pace.perDay).toBeCloseTo(15);
    // 15 paid/day → 270 left → 18 days → 2025-01-20.
    expect(pace.forecastDate).toBe('2025-01-20');
    // Zero paid pace must NOT leak applications into the forecast: no date, honest unreachable.
    const none = goalPace({
      points: paidSeries.map((p) => ({ ...p, reaches: 0 })),
      to: '2025-01-02',
      target: 300,
      current: 0,
      goalIsPaid: true,
    });
    expect(none.status).toBe('unreachable');
    expect(none.forecastDate).toBeNull();
  });
});
