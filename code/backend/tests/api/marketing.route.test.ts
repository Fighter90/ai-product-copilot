import { describe, expect, it, vi } from 'vitest';
import { buildTestApp } from './helpers';
import type { ChannelStat } from '@pca/shared';

const ch = (date: string, visits: number, goalReaches: number): ChannelStat => ({
  date,
  channel: 'Direct traffic',
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  visits,
  users: visits,
  bounceRate: 10,
  avgDuration: 40,
  goalReaches,
  conversionRate: 1,
});

describe('GET /api/marketing/weekly', () => {
  it('returns the sheet-shaped grid: months, weeks, sections, metrics, cells', async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/marketing/weekly' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.months).toHaveLength(4);
    expect(body.weeks).toHaveLength(13);
    expect(body.weeks[0]).toMatchObject({ key: '2026-08-01', end: '2026-08-07' });
    expect(body.sections.map((s: { key: string }) => s.key)).toEqual(['content', 'influence']);
    expect(body.metrics).toHaveLength(13);
    // syncable rows are marked
    const syncable = body.metrics
      .filter((m: { sync: boolean }) => m.sync)
      .map((m: { key: string }) => m.key);
    expect(syncable).toEqual(['landings_visits', 'site_goals', 'payments', 'b2b_leads']);
    expect(body.cells).toEqual([]);
    await ctx.app.close();
  });

  it('PUT enters a manual cell; GET returns it; invalid metric → 400', async () => {
    const ctx = buildTestApp();
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: '/api/marketing/weekly',
      payload: { weekStart: '2026-08-01', metricKey: 'nope', value: 1 },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await ctx.app.inject({
      method: 'PUT',
      url: '/api/marketing/weekly',
      payload: { weekStart: '2026-10-19', metricKey: 'tg_clicks', value: 120 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ source: 'manual', value: 120 });

    const grid = await ctx.app.inject({ method: 'GET', url: '/api/marketing/weekly' });
    expect(grid.json().cells).toHaveLength(1);
    await ctx.app.close();
  });

  it('DELETE clears a cell; missing → 404', async () => {
    const ctx = buildTestApp();
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/marketing/weekly',
      payload: { weekStart: '2026-10-19', metricKey: 'referrals_clicks', value: 100 },
    });
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/marketing/weekly/2026-10-19/referrals_clicks',
    });
    expect(del.statusCode).toBe(204);
    const again = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/marketing/weekly/2026-10-19/referrals_clicks',
    });
    expect(again.statusCode).toBe(404);
    await ctx.app.close();
  });
});

describe('POST /api/marketing/weekly/sync', () => {
  it('recomputes syncable cells from channel_stats/b2c/b2b; skips empty weeks; keeps manual', async () => {
    const ctx = buildTestApp();
    // Pre-launch week has no data → skipped; Sep week 2 has channel data.
    ctx.deps.metrics.upsertChannelStats([ch('2026-09-08', 829, 2), ch('2026-09-09', 100, 1)]);
    // Paid B2C + a paid B2B deal in the Oct week 4.
    ctx.db
      .prepare(
        `INSERT INTO b2c_payments (date, tickets, source, is_demo, updated_at)
         VALUES ('2026-10-20', 26, 'manual', 0, '2026-10-20T00:00:00Z')`,
      )
      .run();
    ctx.db
      .prepare(
        `INSERT INTO b2b_manual (company, tickets, stage, date_added, date_paid, is_demo)
         VALUES ('ООО «Сбер»', 5, 'paid', '2026-10-21', '2026-10-21', 0),
                ('ООО «ООО»', 2, 'lead', '2026-10-21', null, 0)`,
      )
      .run();
    // Analyst's manual value must survive the sync.
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/marketing/weekly',
      payload: { weekStart: '2026-09-07', metricKey: 'site_goals', value: 999 },
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/marketing/weekly/sync',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.weeks).toBe(13);
    expect(body.skippedWeeks).toContain('2026-08-01');
    expect(body.skippedWeeks).not.toContain('2026-09-07');

    const cells = (await ctx.app.inject({ method: 'GET', url: '/api/marketing/weekly' })).json()
      .cells;
    const byKey = (w: string, m: string) =>
      cells.find(
        (c: { weekStart: string; metricKey: string }) => c.weekStart === w && c.metricKey === m,
      );
    expect(byKey('2026-09-07', 'landings_visits')).toMatchObject({ value: 929, source: 'metrika' });
    expect(byKey('2026-09-07', 'site_goals')).toMatchObject({ value: 999, source: 'manual' });
    expect(byKey('2026-10-19', 'payments')).toMatchObject({ value: 31, source: 'metrika' });
    expect(byKey('2026-10-19', 'b2b_leads')).toMatchObject({ value: 2, source: 'metrika' });
    expect(byKey('2026-08-01', 'landings_visits')).toBeUndefined();
    await ctx.app.close();
  });

  it('with a from/to window it triggers the Metrika backfill via runSync', async () => {
    const runSync = vi.fn(async () => ({
      goals: 0,
      resolvedGoalId: undefined,
      days: 31,
      channelRows: 31,
      utmRows: 0,
      geoDeviceRows: 0,
      pageRows: 0,
      exitPageRows: 0,
    }));
    const ctx = buildTestApp(undefined, { runSync });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/marketing/weekly/sync',
      payload: { from: '2026-08-01', to: '2026-08-31' },
    });
    expect(res.statusCode).toBe(200);
    expect(runSync).toHaveBeenCalledWith({ from: '2026-08-01', to: '2026-08-31' });
    expect(res.json().pulled).toMatchObject({ days: 31 });
    await ctx.app.close();
  });

  it('rejects a one-sided window', async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/marketing/weekly/sync',
      payload: { from: '2026-08-01' },
    });
    expect(res.statusCode).toBe(400);
    await ctx.app.close();
  });
});

describe('GET /api/marketing/weekly.csv', () => {
  it('exports the sheet layout with a BOM and the week header row', async () => {
    const ctx = buildTestApp();
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/marketing/weekly',
      payload: { weekStart: '2026-08-01', metricKey: 'landings_visits', value: 486 },
    });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/marketing/weekly.csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.body;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Секция,Метрика');
    expect(text).toContain('1 неделя (1-7) (2026-08-01..2026-08-07)');
    expect(text).toContain('486');
    await ctx.app.close();
  });
});
