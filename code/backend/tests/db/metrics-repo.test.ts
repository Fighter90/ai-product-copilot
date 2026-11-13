import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../../src/db/connection';
import { MetricsRepo, STAT_CACHE_TTL_MS } from '../../src/db/repositories/metrics-repo';
import { B2bRepo } from '../../src/db/repositories/b2b-repo';
import { B2cPaymentsRepo } from '../../src/db/repositories/b2c-payments-repo';
import { freshDb } from './helpers';
import type { ChannelStat, GeoDeviceStat, Goal, PageStat, UtmStat } from '@pca/shared';

let db: DB;
let repo: MetricsRepo;

beforeEach(() => {
  db = freshDb();
  repo = new MetricsRepo(db);
});
afterEach(() => db.close());

const goal = (id: number, over: Partial<Goal> = {}): Goal => ({
  id,
  name: `goal ${id}`,
  type: 'form',
  isB2b: false,
  isArchived: false,
  syncedAt: '2025-01-01T00:00:00.000Z',
  ...over,
});

const stat = (date: string, over: Partial<ChannelStat> = {}): ChannelStat => ({
  date,
  channel: 'podcast',
  utmSource: 'podcast',
  utmMedium: 'audio',
  utmCampaign: 'ep1',
  visits: 100,
  users: 90,
  bounceRate: 0.2,
  avgDuration: 65,
  goalReaches: 5,
  conversionRate: 0.05,
  ...over,
});

describe('MetricsRepo — goals', () => {
  it('upserts and lists goals, hiding archived by default', () => {
    repo.upsertGoals([goal(80), goal(10, { isArchived: true, isB2b: true })]);
    expect(repo.listGoals().map((g) => g.id)).toEqual([80]);
    const all = repo.listGoals(true);
    expect(all.map((g) => g.id)).toEqual([10, 80]);
    expect(all.find((g) => g.id === 10)?.isB2b).toBe(true);
    expect(all.find((g) => g.id === 10)?.isArchived).toBe(true);
  });
});

describe('MetricsRepo — raw responses', () => {
  it('saves and reads back a raw response', () => {
    const id = repo.saveRawResponse({
      endpoint: '/stat/v1/data',
      queryHash: 'h1',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-01',
      payload: { rows: [1, 2, 3] },
      fetchedAt: '2025-01-02T00:00:00.000Z',
    });
    const got = repo.getRawResponse(id);
    expect(got?.payload).toEqual({ rows: [1, 2, 3] });
    expect(got?.queryHash).toBe('h1');
  });

  it('upserts on the (query_hash, date_from, date_to) conflict, keeping the same id', () => {
    const base = { endpoint: '/x', queryHash: 'h', dateFrom: '2025-01-01', dateTo: '2025-01-01' };
    const id1 = repo.saveRawResponse({ ...base, payload: { v: 1 }, fetchedAt: 't1' });
    const id2 = repo.saveRawResponse({ ...base, payload: { v: 2 }, fetchedAt: 't2' });
    expect(id2).toBe(id1);
    expect(repo.getRawResponse(id1)?.payload).toEqual({ v: 2 });
  });

  it('returns undefined for a missing raw response', () => {
    expect(repo.getRawResponse(999)).toBeUndefined();
  });
});

describe('MetricsRepo — channel stats', () => {
  it('upserts and lists channel stats, optionally filtered by date range', () => {
    repo.upsertChannelStats([
      stat('2025-01-01'),
      stat('2025-01-02', {
        channel: 'direct',
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
      }),
      stat('2025-01-03'),
    ]);
    expect(repo.listChannelStats()).toHaveLength(3);
    const ranged = repo.listChannelStats({ from: '2025-01-02', to: '2025-01-03' });
    expect(ranged.map((c) => c.date)).toEqual(['2025-01-02', '2025-01-03']);
    expect(ranged[0]?.utmSource).toBeNull();
  });
});

const utm = (date: string, over: Partial<UtmStat> = {}): UtmStat => ({
  date,
  utmSource: 'vk',
  utmMedium: 'cpc',
  utmCampaign: 'spring',
  visits: 100,
  users: 90,
  goalReaches: 7,
  conversionRate: 0.07,
  ...over,
});

describe('MetricsRepo — UTM stats', () => {
  it('upserts and lists UTM stats, optionally filtered by date range', () => {
    repo.upsertUtmStats([
      utm('2025-01-01'),
      utm('2025-01-02', { utmCampaign: 'summer' }),
      utm('2025-01-03'),
    ]);
    expect(repo.listUtmStats()).toHaveLength(3);
    const ranged = repo.listUtmStats({ from: '2025-01-02', to: '2025-01-03' });
    expect(ranged.map((u) => u.date)).toEqual(['2025-01-02', '2025-01-03']);
    expect(ranged[0]?.utmCampaign).toBe('summer');
    expect(ranged[0]?.goalReaches).toBe(7);
  });

  it('replaces a row on the composite-key conflict', () => {
    repo.upsertUtmStats([utm('2025-01-01', { visits: 100 })]);
    repo.upsertUtmStats([utm('2025-01-01', { visits: 250 })]);
    const rows = repo.listUtmStats();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.visits).toBe(250);
  });
});

const geo = (date: string, over: Partial<GeoDeviceStat> = {}): GeoDeviceStat => ({
  date,
  country: 'Россия',
  device: 'mobile',
  visits: 100,
  users: 90,
  goalReaches: 6,
  conversionRate: 0.06,
  ...over,
});

describe('MetricsRepo — geo/device stats', () => {
  it('upserts and lists geo/device stats, optionally filtered by date range', () => {
    repo.upsertGeoDeviceStats([
      geo('2025-01-01'),
      geo('2025-01-02', { device: 'desktop' }),
      geo('2025-01-03'),
    ]);
    expect(repo.listGeoDeviceStats()).toHaveLength(3);
    const ranged = repo.listGeoDeviceStats({ from: '2025-01-02', to: '2025-01-03' });
    expect(ranged.map((g) => g.date)).toEqual(['2025-01-02', '2025-01-03']);
    expect(ranged[0]?.device).toBe('desktop');
    expect(ranged[0]?.goalReaches).toBe(6);
  });
});

const page = (date: string, over: Partial<PageStat> = {}): PageStat => ({
  date,
  page: '/lp',
  visits: 100,
  users: 90,
  bounceRate: 0.3,
  goalReaches: 5,
  conversionRate: 0.05,
  ...over,
});

describe('MetricsRepo — page stats', () => {
  it('upserts and lists page stats, optionally filtered by date range', () => {
    repo.upsertPageStats([
      page('2025-01-01'),
      page('2025-01-02', { page: '/pricing' }),
      page('2025-01-03'),
    ]);
    expect(repo.listPageStats()).toHaveLength(3);
    const ranged = repo.listPageStats({ from: '2025-01-02', to: '2025-01-03' });
    expect(ranged.map((p) => p.date)).toEqual(['2025-01-02', '2025-01-03']);
    expect(ranged[0]?.page).toBe('/pricing');
    expect(ranged[0]?.bounceRate).toBe(0.3);
  });
});

describe('MetricsRepo — exit-page stats', () => {
  it('upserts and lists exit-page stats independently of entry pages', () => {
    repo.upsertPageStats([page('2025-01-01', { page: '/lp' })]);
    repo.upsertExitPageStats([
      page('2025-01-01', { page: '/checkout', bounceRate: 0.6 }),
      page('2025-01-02', { page: '/pricing' }),
    ]);
    // entry-page table is untouched by exit-page writes
    expect(repo.listPageStats()).toHaveLength(1);
    const exits = repo.listExitPageStats();
    expect(exits).toHaveLength(2);
    expect(exits[0]?.page).toBe('/checkout');
    expect(exits[0]?.bounceRate).toBe(0.6);
    const ranged = repo.listExitPageStats({ from: '2025-01-02', to: '2025-01-03' });
    expect(ranged.map((p) => p.page)).toEqual(['/pricing']);
  });
});

/** Count rows in a table directly (for asserting preserved user-entered data). */
function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** Insert one row into each user-entered table so we can prove they survive a sync reset. */
function seedUserEnteredData(): void {
  db.prepare(
    `INSERT INTO b2b_manual (company, tickets, stage, date_added)
     VALUES ('Acme', 5, 'paid', '2025-01-01')`,
  ).run();
  const hypId = (
    db
      .prepare(
        `INSERT INTO hypotheses
           (diamond_phase, kind, subject, action, solution, condition, title,
            hidden_assumptions, validation_methods, impact, confidence, ease,
            impact_rationale, confidence_rationale, ease_rationale,
            green_criteria, yellow_criteria, red_criteria, deadline_days, deadline_at,
            created_at, updated_at)
         VALUES ('define','problem','s','a','sol','cond','t','[]','[]',5,5,5,'r','r','r',
                 'g','y','r',2,'2025-01-03','2025-01-01','2025-01-01')
         RETURNING id`,
      )
      .get() as { id: number }
  ).id;
  db.prepare(
    `INSERT INTO decisions
       (number, hypothesis_id, date, method, scope, period_days, findings, evidence,
        outcome, outcome_rationale, next_step, decided_by, created_at, updated_at)
     VALUES ('DL-001', @hyp, '2025-01-02', 'quantitative', 'scope', 2, '[]', '[]',
             'green', 'ok', 'next', 'me', '2025-01-02', '2025-01-02')`,
  ).run({ hyp: hypId });
  db.prepare(
    `INSERT INTO report_snapshots (id, generated_at, date_from, date_to, payload)
     VALUES ('snap1', '2025-01-02', '2025-01-01', '2025-01-02', '{}')`,
  ).run();
}

describe('MetricsRepo — resetSyncedData', () => {
  it('wipes synced data but preserves user-entered data', () => {
    repo.upsertChannelStats([stat('2025-01-01')]);
    repo.upsertUtmStats([utm('2025-01-01')]);
    repo.upsertGeoDeviceStats([geo('2025-01-01')]);
    repo.upsertPageStats([page('2025-01-01', { page: '/lp' })]);
    repo.upsertExitPageStats([page('2025-01-01', { page: '/checkout' })]);
    repo.upsertGoals([goal(100)]);
    repo.saveRawResponse({
      endpoint: '/stat/v1/data',
      queryHash: 'clr',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-01',
      payload: { ok: true },
      fetchedAt: 't1',
    });
    seedUserEnteredData();

    repo.resetSyncedData();

    // synced data is fully wiped: stat tables + goals + raw_responses
    expect(repo.listChannelStats()).toHaveLength(0);
    expect(repo.listUtmStats()).toHaveLength(0);
    expect(repo.listGeoDeviceStats()).toHaveLength(0);
    expect(repo.listPageStats()).toHaveLength(0);
    expect(repo.listExitPageStats()).toHaveLength(0);
    expect(repo.listGoals(true)).toHaveLength(0);
    expect(count('raw_responses')).toBe(0);

    // user-entered data is preserved
    expect(count('b2b_manual')).toBe(1);
    expect(count('hypotheses')).toBe(1);
    expect(count('decisions')).toBe(1);
    expect(count('report_snapshots')).toBe(1);
  });
});

describe('MetricsRepo — resetSyncedWindow', () => {
  it('wipes only the [from, to] window; history outside survives; user data untouched', () => {
    for (const d of ['2025-01-01', '2025-01-10', '2025-01-20']) {
      repo.upsertChannelStats([stat(d)]);
      repo.upsertUtmStats([utm(d)]);
      repo.upsertGeoDeviceStats([geo(d)]);
      repo.upsertPageStats([page(d, { page: '/lp' })]);
      repo.upsertExitPageStats([page(d, { page: '/checkout' })]);
    }
    repo.upsertGoals([goal(100)]);
    repo.saveRawResponse({
      endpoint: '/stat/v1/data',
      queryHash: 'old',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-01',
      payload: {},
      fetchedAt: 't1',
    });
    repo.saveRawResponse({
      endpoint: '/stat/v1/data',
      queryHash: 'win',
      dateFrom: '2025-01-10',
      dateTo: '2025-01-20',
      payload: {},
      fetchedAt: 't1',
    });
    seedUserEnteredData();

    repo.resetSyncedWindow('2025-01-05', '2025-01-31');

    for (const rows of [
      repo.listChannelStats(),
      repo.listUtmStats(),
      repo.listGeoDeviceStats(),
      repo.listPageStats(),
      repo.listExitPageStats(),
    ]) {
      expect(rows.map((r) => r.date)).toEqual(['2025-01-01']);
    }
    expect(count('raw_responses')).toBe(1);
    expect(repo.listGoals(true)).toHaveLength(0);
    expect(count('b2b_manual')).toBe(1);
    expect(count('report_snapshots')).toBe(1);
  });
});

describe('MetricsRepo — statsCoverage (ANA-49)', () => {
  it('returns null while nothing is synced', () => {
    expect(repo.statsCoverage()).toBeNull();
  });

  it('returns the first/last synced day and the inclusive day count', () => {
    repo.upsertChannelStats([stat('2025-01-01'), stat('2025-01-05'), stat('2025-01-03')]);
    expect(repo.statsCoverage()).toEqual({ from: '2025-01-01', to: '2025-01-05', days: 5 });
  });
});

// ANA-139: /metrics/coverage must expose per-table coverage — channel_stats can be complete
// while utm_stats/geo/pages lag behind (optional sync steps skipped for days), and the
// FilterBar's «Догрузить» prompt is blind to that gap when only the channel window is reported.
describe('MetricsRepo — statsCoverageTables (ANA-139)', () => {
  it('returns null per table while nothing is synced', () => {
    expect(repo.statsCoverageTables()).toEqual({
      channels: null,
      utm: null,
      geoDevice: null,
      pages: null,
      exitPages: null,
    });
  });

  it('reports per-table min/max so a lagging utm_stats is visible next to fresh channels', () => {
    repo.upsertChannelStats([stat('2025-01-01'), stat('2025-01-05')]);
    // The ANA-139 symptom: utm stops four days before channels do.
    repo.upsertUtmStats([utm('2025-01-01')]);
    repo.upsertGeoDeviceStats([geo('2025-01-03')]);
    repo.upsertPageStats([page('2025-01-02', { page: '/lp' })]);
    repo.upsertExitPageStats([page('2025-01-04', { page: '/checkout' })]);

    expect(repo.statsCoverageTables()).toEqual({
      channels: { from: '2025-01-01', to: '2025-01-05' },
      utm: { from: '2025-01-01', to: '2025-01-01' },
      geoDevice: { from: '2025-01-03', to: '2025-01-03' },
      pages: { from: '2025-01-02', to: '2025-01-02' },
      exitPages: { from: '2025-01-04', to: '2025-01-04' },
    });
  });
});

// ANA-18 (appended): demo rows carry is_demo = 1 across every dataset; the demo banner reads
// demoStatus() and the first successful sync calls deleteDemoRows() — demo and live data must
// never mix in the KPIs.
describe('MetricsRepo — demo marks (ANA-18)', () => {
  const utmRow = (over: Partial<UtmStat> = {}): UtmStat => ({
    date: '2025-01-01',
    utmSource: 'vk',
    utmMedium: 'cpc',
    utmCampaign: 'demo',
    visits: 10,
    users: 9,
    goalReaches: 1,
    conversionRate: 0.1,
    ...over,
  });
  const geoRow = (over: Partial<GeoDeviceStat> = {}): GeoDeviceStat => ({
    date: '2025-01-01',
    country: 'Россия',
    device: 'mobile',
    visits: 10,
    users: 9,
    goalReaches: 1,
    conversionRate: 0.1,
    ...over,
  });
  const pageRow = (over: Partial<PageStat> = {}): PageStat => ({
    date: '2025-01-01',
    page: '/tickets',
    visits: 10,
    users: 9,
    bounceRate: 0.2,
    goalReaches: 1,
    conversionRate: 0.1,
    ...over,
  });
  const count = (t: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

  it('demoStatus counts is_demo rows per dataset and flips demo:true', () => {
    repo.upsertChannelStats([stat('2025-01-01', { isDemo: true })]);
    repo.upsertGoals([goal(80, { isDemo: true })]);
    const s = repo.demoStatus();
    expect(s.demo).toBe(true);
    expect(s.counts.channels).toBe(1);
    expect(s.counts.goals).toBe(1);
    expect(s.counts.utm).toBe(0);
    expect(s.counts.b2b).toBe(0);
    expect(s.counts.b2c).toBe(0);
  });

  it('demoStatus is demo:false while only live rows exist', () => {
    repo.upsertChannelStats([stat('2025-01-01')]);
    const s = repo.demoStatus();
    expect(s.demo).toBe(false);
    expect(s.counts.channels).toBe(0);
  });

  it('deleteDemoRows wipes every demo row and keeps live rows — sync after seed never mixes', () => {
    // Demo (seed-shaped) rows across every dataset, incl. b2b_manual and b2c_payments.
    repo.upsertChannelStats([stat('2025-01-01', { isDemo: true })]);
    repo.upsertUtmStats([utmRow({ isDemo: true })]);
    repo.upsertGeoDeviceStats([geoRow({ isDemo: true })]);
    repo.upsertPageStats([pageRow({ isDemo: true })]);
    repo.upsertExitPageStats([pageRow({ page: '/checkout', isDemo: true })]);
    repo.upsertGoals([goal(80, { isDemo: true })]);
    const b2b = new B2bRepo(db);
    b2b.create({
      company: 'BigCorp',
      tickets: 20,
      stage: 'paid',
      dateAdded: '2025-01-01',
      isDemo: true,
    });
    const b2c = new B2cPaymentsRepo(db);
    b2c.upsert(
      { date: '2025-01-01', tickets: 6 },
      { source: 'manual', isDemo: true, now: () => 'T' },
    );

    // Live rows interleaved in the same tables.
    repo.upsertChannelStats([stat('2025-02-01')]);
    b2b.create({ company: 'RealCo', tickets: 5, stage: 'lead', dateAdded: '2025-02-01' });
    b2c.upsert({ date: '2025-02-01', tickets: 3 }, { source: 'csv', now: () => 'T' });

    repo.deleteDemoRows();

    expect(repo.listChannelStats().map((c) => c.date)).toEqual(['2025-02-01']);
    expect(repo.listUtmStats()).toHaveLength(0);
    expect(repo.listGeoDeviceStats()).toHaveLength(0);
    expect(repo.listPageStats()).toHaveLength(0);
    expect(repo.listExitPageStats()).toHaveLength(0);
    expect(repo.listGoals(true)).toHaveLength(0);
    expect(count('b2b_manual')).toBe(1);
    expect(count('b2c_payments')).toBe(1);
    expect(repo.demoStatus().demo).toBe(false);
  });
});

// ANA-142: seeded demo history (is_demo = 1, prod has 2025-04-29..2025-12-31) must never blend
// into live Metrika reads (the counter only lives from 2026-11-06). Read paths return live rows
// when any exist in scope; a demo-only scope still serves the demo dataset — flagged isDemo so
// the UI can badge it («ДЕМО»). Coverage (the KPI base) is measured over live rows first, so the
// KPI page says «данных N дней (с 2026-11-06)» instead of counting the seeded 2025 «history».
describe('MetricsRepo — demo/live read separation (ANA-142)', () => {
  const demo = { isDemo: true } as const;

  it('listChannelStats returns live rows only when the table mixes live and demo', () => {
    repo.upsertChannelStats([
      stat('2025-04-29', demo),
      stat('2026-11-06'),
      stat('2026-11-07', {
        channel: 'direct',
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
      }),
    ]);
    const rows = repo.listChannelStats();
    expect(rows.map((r) => r.date)).toEqual(['2026-11-06', '2026-11-07']);
    expect(rows.every((r) => !r.isDemo)).toBe(true);
    // A range over the live window → live rows only, demo history never leaks in.
    const ranged = repo.listChannelStats({ from: '2026-11-01', to: '2026-11-30' });
    expect(ranged.map((r) => r.date)).toEqual(['2026-11-06', '2026-11-07']);
  });

  it('a demo-only scope still serves demo rows, flagged isDemo (fresh ./run.sh keeps its badge)', () => {
    repo.upsertChannelStats([stat('2025-04-29', demo), stat('2025-04-30', demo)]);
    const all = repo.listChannelStats();
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.isDemo === true)).toBe(true);
    const ranged = repo.listChannelStats({ from: '2025-04-29', to: '2025-04-30' });
    expect(ranged).toHaveLength(2);
    expect(ranged.every((r) => r.isDemo === true)).toBe(true);
  });

  it('listUtmStats/listGeoDeviceStats/listPageStats/listExitPageStats hide demo when live exists', () => {
    repo.upsertUtmStats([utm('2025-04-29', demo), utm('2026-11-06')]);
    repo.upsertGeoDeviceStats([geo('2025-04-29', demo), geo('2026-11-06')]);
    repo.upsertPageStats([page('2025-04-29', demo), page('2026-11-06', { page: '/lp' })]);
    repo.upsertExitPageStats([
      page('2025-04-29', { ...demo, page: '/checkout' }),
      page('2026-11-06', { page: '/exit' }),
    ]);
    expect(repo.listUtmStats().map((r) => r.date)).toEqual(['2026-11-06']);
    expect(repo.listGeoDeviceStats().map((r) => r.date)).toEqual(['2026-11-06']);
    expect(repo.listPageStats().map((r) => r.date)).toEqual(['2026-11-06']);
    expect(repo.listExitPageStats().map((r) => r.date)).toEqual(['2026-11-06']);
    // Demo-only range → demo rows come back with the isDemo flag (never silently unmarked).
    const demoUtm = repo.listUtmStats({ from: '2025-04-29', to: '2025-04-29' });
    expect(demoUtm).toHaveLength(1);
    expect(demoUtm[0]?.isDemo).toBe(true);
  });

  it('statsCoverage measures the KPI base from the first LIVE day (not the seeded 2025 history)', () => {
    repo.upsertChannelStats([stat('2025-04-29', demo), stat('2026-11-06'), stat('2026-11-12')]);
    expect(repo.statsCoverage()).toEqual({ from: '2026-11-06', to: '2026-11-12', days: 7 });
  });

  it('statsCoverage falls back to the demo window on a demo-only DB (./run.sh without a token)', () => {
    repo.upsertChannelStats([stat('2025-11-01', demo), stat('2025-11-05', demo)]);
    expect(repo.statsCoverage()).toEqual({ from: '2025-11-01', to: '2025-11-05', days: 5 });
  });

  it('statsCoverageTables reports per-table windows over live rows (FilterBar «Догрузить»)', () => {
    repo.upsertChannelStats([stat('2025-04-29', demo), stat('2026-11-06'), stat('2026-11-07')]);
    repo.upsertUtmStats([utm('2025-04-29', demo), utm('2026-11-06')]);
    expect(repo.statsCoverageTables()).toEqual({
      channels: { from: '2026-11-06', to: '2026-11-07' },
      utm: { from: '2026-11-06', to: '2026-11-06' },
      geoDevice: null,
      pages: null,
      exitPages: null,
    });
  });
});

// ANA-148: GET /api/metrics/utm answered in ~10s on the 1-CPU prod. The repo keeps a small
// in-process TTL cache over the derived-stat reads (each table+range key) so repeated GETs —
// the dashboard polls — never re-query SQLite; every write path (sync window reset, upserts,
// failed-sync restore, demo cleanup) drops the cache, so data never goes stale past one write.
describe('MetricsRepo — derived-stats response cache (ANA-148)', () => {
  /** A repo over a fresh DB with an injectable clock (TTL tests must not sleep). */
  function cachedRepo(): { db: ReturnType<typeof freshDb>; repo: MetricsRepo; tick: () => void } {
    let t = 1_000_000;
    const db = freshDb();
    return { db, repo: new MetricsRepo(db, () => t), tick: () => (t += STAT_CACHE_TTL_MS + 1) };
  }

  it('serves repeated reads from the cache and expires after the TTL', () => {
    const { db, repo, tick } = cachedRepo();
    try {
      repo.upsertUtmStats([utm('2025-01-01'), utm('2025-01-09', { utmCampaign: 'summer' })]);
      const first = repo.listUtmStats();
      expect(first).toHaveLength(2);
      // The rows vanish from SQLite OUTSIDE the repo (a raw write bypasses invalidation) —
      // the repeat read is served from the cache: the <300ms acceptance on repeat GETs.
      db.prepare('DELETE FROM utm_stats').run();
      expect(repo.listUtmStats()).toEqual(first);
      // Past the TTL the cached copy expires and the fresh (now empty) DB shows through.
      tick();
      expect(repo.listUtmStats()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('keys the cache per date range (ranged GETs never bleed into each other)', () => {
    const { db, repo } = cachedRepo();
    try {
      repo.upsertUtmStats([utm('2025-01-01'), utm('2025-01-09', { utmCampaign: 'summer' })]);
      const day1 = repo.listUtmStats({ from: '2025-01-01', to: '2025-01-01' });
      const day9 = repo.listUtmStats({ from: '2025-01-09', to: '2025-01-09' });
      expect(day1.map((r) => r.utmCampaign)).toEqual(['spring']);
      expect(day9.map((r) => r.utmCampaign)).toEqual(['summer']);
      db.prepare('DELETE FROM utm_stats').run();
      expect(repo.listUtmStats({ from: '2025-01-01', to: '2025-01-01' })).toEqual(day1);
      expect(repo.listUtmStats({ from: '2025-01-09', to: '2025-01-09' })).toEqual(day9);
      // A range that was never cached reads fresh from the DB.
      expect(repo.listUtmStats({ from: '2025-01-02', to: '2025-01-03' })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('every write path invalidates the cache (sync / upserts / demo cleanup)', () => {
    const { db, repo } = cachedRepo();
    try {
      const writePaths: Array<[string, () => void]> = [
        ['upsertUtmStats', () => repo.upsertUtmStats([utm('2025-01-05', { utmCampaign: 'next' })])],
        ['upsertChannelStats', () => repo.upsertChannelStats([stat('2025-01-05')])],
        ['upsertGeoDeviceStats', () => repo.upsertGeoDeviceStats([geo('2025-01-05')])],
        ['upsertPageStats', () => repo.upsertPageStats([page('2025-01-05')])],
        ['upsertExitPageStats', () => repo.upsertExitPageStats([page('2025-01-05')])],
        ['resetSyncedWindow', () => repo.resetSyncedWindow('2025-01-01', '2025-01-31')],
        ['resetSyncedData', () => repo.resetSyncedData()],
        [
          'restoreWindow',
          () => repo.restoreWindow(repo.snapshotWindow('2025-01-01', '2025-01-31')),
        ],
        ['deleteDemoRows', () => repo.deleteDemoRows()],
      ];
      for (const [name, write] of writePaths) {
        db.prepare('DELETE FROM utm_stats').run(); // clean slate (previous iteration leftovers)
        repo.upsertUtmStats([utm('2025-01-01')]);
        expect(repo.listUtmStats().map((r) => r.date)).toEqual(['2025-01-01']); // warm the cache
        // A raw DELETE outside the repo is invisible to a non-invalidated cache.
        db.prepare('DELETE FROM utm_stats').run();
        write();
        const dates = repo.listUtmStats().map((r) => r.date);
        if (name === 'upsertUtmStats') expect(dates).toEqual(['2025-01-05']);
        else expect(dates).toEqual([]); // cache invalidated → the DB truth shows through
      }
    } finally {
      db.close();
    }
  });
});

// ANA-154: the coverage answers (whole-window MIN/MAX, 12 queries per /metrics/coverage call)
// sit behind every filter-page mount and every snapshot build; with the restored 564-day history
// each call re-scanned the stat tables on the 1-CPU prod (147ms locally ≈ seconds there). They
// share the ANA-148 statCache now — every write path already invalidates it.
describe('MetricsRepo — coverage response cache (ANA-154)', () => {
  /** A repo over a fresh DB with an injectable clock (TTL tests must not sleep). */
  function cachedRepo(): { db: ReturnType<typeof freshDb>; repo: MetricsRepo; tick: () => void } {
    let t = 1_000_000;
    const db = freshDb();
    return { db, repo: new MetricsRepo(db, () => t), tick: () => (t += STAT_CACHE_TTL_MS + 1) };
  }

  /** Out-of-band channel row (bypasses the repo → bypasses invalidation) to shift the window. */
  function rawChannelRow(db: ReturnType<typeof freshDb>, date: string): void {
    db.prepare(
      `INSERT INTO channel_stats
         (date, channel, utm_source, utm_medium, utm_campaign, visits, users,
          bounce_rate, avg_duration, goal_reaches, conversion_rate, is_demo)
       VALUES (?, 'podcast', NULL, NULL, NULL, 1, 1, 0, 0, 0, 0, 0)`,
    ).run(date);
  }

  it('serves statsCoverage from the cache and expires after the TTL', () => {
    const { db, repo, tick } = cachedRepo();
    try {
      repo.upsertChannelStats([stat('2025-01-01'), stat('2025-01-09')]);
      const first = repo.statsCoverage();
      expect(first).toEqual({ from: '2025-01-01', to: '2025-01-09', days: 9 });
      // The real window widens OUTSIDE the repo — within the TTL the cached answer hides it.
      rawChannelRow(db, '2024-12-01');
      expect(repo.statsCoverage()).toEqual(first);
      // Past the TTL the DB truth shows through.
      tick();
      expect(repo.statsCoverage()).toEqual({ from: '2024-12-01', to: '2025-01-09', days: 40 });
    } finally {
      db.close();
    }
  });

  it('serves statsCoverageTables from the cache and expires after the TTL', () => {
    const { db, repo, tick } = cachedRepo();
    try {
      repo.upsertChannelStats([stat('2025-02-01'), stat('2025-02-05')]);
      const first = repo.statsCoverageTables();
      expect(first.channels).toEqual({ from: '2025-02-01', to: '2025-02-05' });
      rawChannelRow(db, '2025-02-09');
      expect(repo.statsCoverageTables().channels).toEqual(first.channels);
      tick();
      expect(repo.statsCoverageTables().channels).toEqual({ from: '2025-02-01', to: '2025-02-09' });
    } finally {
      db.close();
    }
  });

  it('a repo write invalidates the coverage cache (DB truth shows through immediately)', () => {
    const { db, repo } = cachedRepo();
    try {
      repo.upsertChannelStats([stat('2025-01-01')]);
      expect(repo.statsCoverage()).toEqual({ from: '2025-01-01', to: '2025-01-01', days: 1 });
      rawChannelRow(db, '2024-12-01'); // cached now
      expect(repo.statsCoverage()?.from).toBe('2025-01-01');
      // Any write path (upsert here, the full loop is covered by the ANA-148 suite — the
      // invalidation is the same invalidateStatCache()) drops the coverage cache too.
      repo.upsertChannelStats([stat('2025-01-15')]);
      expect(repo.statsCoverage()?.from).toBe('2024-12-01');
    } finally {
      db.close();
    }
  });

  it('list* reads serve the cached mapped array — no per-call re-mapping (ANA-154)', () => {
    const { db, repo } = cachedRepo();
    try {
      repo.upsertChannelStats([stat('2025-01-01'), stat('2025-01-02')]);
      const first = repo.listChannelStats();
      expect(repo.listChannelStats()).toBe(first); // identity — mapping ran exactly once
    } finally {
      db.close();
    }
  });

  // ANA-154 (round 2): the cache hands the SAME mapped array (and the same element objects) to
  // every caller within the TTL. Previously each call received freshly mapped copies, so an
  // in-place caller mutation was harmless; now rows.sort() or a numeric write would silently
  // corrupt the cached KPI/B2B answer for the whole TTL. The mapped rows are frozen at cache
  // time, so a mutating caller throws instead of poisoning every later read.
  it('cached stat rows are frozen — a caller mutation cannot corrupt the cache (ANA-154)', () => {
    const { db, repo } = cachedRepo();
    try {
      repo.upsertChannelStats([stat('2025-01-01'), stat('2025-01-02', { channel: 'direct' })]);
      repo.upsertUtmStats([utm('2025-01-01')]);
      repo.upsertGeoDeviceStats([geo('2025-01-01')]);
      repo.upsertPageStats([page('2025-01-01')]);
      repo.upsertExitPageStats([page('2025-01-01')]);
      const reads = [
        ['channels', () => repo.listChannelStats()],
        ['utm', () => repo.listUtmStats()],
        ['geoDevice', () => repo.listGeoDeviceStats()],
        ['pages', () => repo.listPageStats()],
        ['exitPages', () => repo.listExitPageStats()],
      ] as const;
      for (const [name, read] of reads) {
        const rows = read();
        expect(Object.isFrozen(rows), `${name}: array`).toBe(true);
        expect(Object.isFrozen(rows[0]), `${name}: element`).toBe(true);
        // Array-level mutation attempts throw — sort/push cannot reorder or grow what every
        // caller (routes, SnapshotBuilder) sees.
        expect(() => (rows as unknown[]).sort(), `${name}: sort`).toThrow(TypeError);
        expect(() => (rows as unknown[]).push({}), `${name}: push`).toThrow(TypeError);
        // Element-level writes throw — cached numbers cannot be silently rewritten.
        expect(() => {
          (rows[0] as { visits: number }).visits = 999_999;
        }, `${name}: element write`).toThrow(TypeError);
        // Same call, same pristine answer — the mutation attempt changed nothing.
        expect(read(), `${name}: pristine`).toEqual(rows);
        expect(read()[0]?.visits, `${name}: visits intact`).not.toBe(999_999);
      }
    } finally {
      db.close();
    }
  });

  // ANA-154 (round 2): statsCoverage/statsCoverageTables share the statCache — the same
  // shared-object hazard applies to their answers, so they are frozen too.
  it('coverage answers are frozen — a mutation cannot corrupt the cache (ANA-154)', () => {
    const { db, repo } = cachedRepo();
    try {
      repo.upsertChannelStats([stat('2025-01-01'), stat('2025-01-09')]);
      const cov = repo.statsCoverage();
      expect(cov).toEqual({ from: '2025-01-01', to: '2025-01-09', days: 9 });
      expect(() => {
        (cov as { days: number }).days = 999;
      }).toThrow(TypeError);
      const tables = repo.statsCoverageTables();
      expect(() => {
        (tables.channels as { from: string }).from = '1999-01-01';
      }).toThrow(TypeError);
      // Same call, same pristine answers.
      expect(repo.statsCoverage()).toEqual({ from: '2025-01-01', to: '2025-01-09', days: 9 });
      expect(repo.statsCoverageTables().channels).toEqual({ from: '2025-01-01', to: '2025-01-09' });
    } finally {
      db.close();
    }
  });

  // ANA-154 (round 2): invalidateStatCache() must clear the ENTIRE statCache — the
  // `coverage|window` / `coverage|tables` keys included — or a sync's new window would stay
  // hidden behind the coverage answers until the TTL (the ДЕМО-window logic lags behind the data).
  it('every write path drops the coverage keys too — the whole statCache clears (ANA-154)', () => {
    const { db, repo } = cachedRepo();
    try {
      const writePaths: Array<[string, () => void]> = [
        ['upsertChannelStats', () => repo.upsertChannelStats([stat('2025-03-01')])],
        ['upsertUtmStats', () => repo.upsertUtmStats([utm('2025-01-05', { utmCampaign: 'next' })])],
        ['upsertGeoDeviceStats', () => repo.upsertGeoDeviceStats([geo('2025-01-05')])],
        ['upsertPageStats', () => repo.upsertPageStats([page('2025-01-05')])],
        ['upsertExitPageStats', () => repo.upsertExitPageStats([page('2025-01-05')])],
        ['resetSyncedWindow', () => repo.resetSyncedWindow('2025-01-01', '2025-01-31')],
        ['resetSyncedData', () => repo.resetSyncedData()],
        [
          'restoreWindow',
          () => repo.restoreWindow(repo.snapshotWindow('2025-01-01', '2025-01-31')),
        ],
        ['deleteDemoRows', () => repo.deleteDemoRows()],
      ];
      for (const [name, write] of writePaths) {
        db.prepare('DELETE FROM channel_stats').run(); // clean slate (previous iteration leftovers)
        repo.upsertChannelStats([stat('2025-01-01')]);
        // Warm BOTH coverage caches while the DB only knows 2025-01-01…
        expect(repo.statsCoverage()?.from).toBe('2025-01-01');
        expect(repo.statsCoverageTables().channels?.from).toBe('2025-01-01');
        // …then the real window start appears OUTSIDE the repo; the warmed answers hide it.
        rawChannelRow(db, '2024-12-01');
        expect(repo.statsCoverage()?.from).toBe('2025-01-01');
        expect(repo.statsCoverageTables().channels?.from).toBe('2025-01-01');
        write();
        if (name === 'resetSyncedData') {
          // Everything is wiped → no coverage at all (not a stale cached window).
          expect(repo.statsCoverage()).toBeNull();
          expect(repo.statsCoverageTables().channels).toBeNull();
        } else {
          // Fresh DB truth shows through in BOTH cached answers.
          expect(repo.statsCoverage()?.from, name).toBe('2024-12-01');
          expect(repo.statsCoverageTables().channels?.from, name).toBe('2024-12-01');
        }
      }
    } finally {
      db.close();
    }
  });
});
