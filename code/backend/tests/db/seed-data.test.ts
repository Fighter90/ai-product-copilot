import { describe, it, expect } from 'vitest';
import { buildSeedData } from '../../src/db/seed-data';

describe('buildSeedData', () => {
  it('is deterministic — same output every call', () => {
    expect(buildSeedData()).toEqual(buildSeedData());
  });

  it('populates every dataset the dashboard pages read', () => {
    const d = buildSeedData();
    expect(d.channels.length).toBeGreaterThan(0);
    expect(d.utm.length).toBeGreaterThan(0);
    expect(d.geoDevice.length).toBeGreaterThan(0);
    expect(d.pages.length).toBeGreaterThan(0);
    expect(d.exitPages.length).toBeGreaterThan(0);
    expect(d.b2b.length).toBeGreaterThan(0);
    expect(d.goals.length).toBeGreaterThan(0);
  });

  it('keeps «заявка ≠ оплата» realistic: exactly one paid B2B deal, several applications', () => {
    const d = buildSeedData();
    const paid = d.b2b.filter((b) => b.stage === 'paid');
    expect(paid).toHaveLength(1);
    expect(paid[0]?.datePaid).toBeDefined();
    const totalReaches = d.channels.reduce((acc, c) => acc + c.goalReaches, 0);
    expect(totalReaches).toBeGreaterThan(paid[0]?.tickets ?? 0);
  });

  it('produces consistent ChannelStat rows (conversionRate = reaches / visits, archived goal flagged)', () => {
    const d = buildSeedData();
    for (const c of d.channels) {
      expect(c.conversionRate).toBeCloseTo(c.goalReaches / c.visits);
      expect(c.users).toBe(Math.round(c.visits * 0.9));
    }
    expect(d.goals.some((g) => g.isArchived)).toBe(true);
  });

  // ANA-18 (appended): dates are RELATIVE to «now» and every row carries the demo mark, so the
  // dataset lands inside the default 14-day filter window and can never mix with live data.
  it('generates RELATIVE dates: the last 30 days ending today (ANA-18)', () => {
    const now = new Date('2026-10-27T12:00:00.000Z');
    const d = buildSeedData(now);
    const dates = [...d.channels.map((c) => c.date), ...d.b2b.map((b) => b.dateAdded)];
    const today = now.toISOString().slice(0, 10);
    const earliest = new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
    expect(dates.every((date) => date <= today && date >= earliest)).toBe(true);
    expect(d.channels.some((c) => c.date === today)).toBe(true); // peak on «today»
    // The old bug: fixed 2025-01-01..05 rows fell outside the 365-day max filter.
    expect(d.channels.some((c) => c.date.startsWith('2025-01-0'))).toBe(false);
  });

  it('marks EVERY row isDemo (incl. b2b_manual and b2c payments) so a sync can wipe it (ANA-18)', () => {
    const d = buildSeedData();
    expect(d.channels.every((c) => c.isDemo === true)).toBe(true);
    expect(d.utm.every((u) => u.isDemo === true)).toBe(true);
    expect(d.geoDevice.every((g) => g.isDemo === true)).toBe(true);
    expect(d.pages.every((p) => p.isDemo === true)).toBe(true);
    expect(d.exitPages.every((p) => p.isDemo === true)).toBe(true);
    expect(d.b2b.every((b) => b.isDemo === true)).toBe(true); // b2b_manual.is_demo (migration 015)
    expect(d.b2c.length).toBeGreaterThan(0);
    expect(d.goals.every((g) => g.isDemo === true)).toBe(true);
  });

  it('seeds paid B2C days so «Оплачено» is non-zero out of the box (ANA-19)', () => {
    const d = buildSeedData();
    expect(d.b2c.reduce((acc, p) => acc + p.tickets, 0)).toBeGreaterThan(0);
    expect(d.b2b.filter((b) => b.stage === 'paid')).toHaveLength(1);
  });
});
