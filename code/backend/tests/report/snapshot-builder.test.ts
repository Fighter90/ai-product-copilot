import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../../src/db/connection';
import { MetricsRepo } from '../../src/db/repositories/metrics-repo';
import { HypothesesRepo } from '../../src/db/repositories/hypotheses-repo';
import { DecisionsRepo } from '../../src/db/repositories/decisions-repo';
import { B2bRepo } from '../../src/db/repositories/b2b-repo';
import { B2cPaymentsRepo } from '../../src/db/repositories/b2c-payments-repo';
import { SnapshotBuilder } from '../../src/report/snapshot-builder';
import { freshDb, validHypothesis } from '../db/helpers';

let db: DB;
let builder: SnapshotBuilder;
let metrics: MetricsRepo;

beforeEach(() => {
  db = freshDb();
  metrics = new MetricsRepo(db);
  const hypotheses = new HypothesesRepo(db);
  const b2b = new B2bRepo(db);
  builder = new SnapshotBuilder({ metrics, hypotheses, decisions: new DecisionsRepo(db), b2b });

  metrics.upsertChannelStats([
    {
      date: '2025-01-02',
      channel: 'podcast',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      visits: 100,
      users: 90,
      bounceRate: 0.2,
      avgDuration: 60,
      goalReaches: 7,
      conversionRate: 0.07,
    },
  ]);
  metrics.upsertUtmStats([
    {
      date: '2025-01-02',
      utmSource: 'vk',
      utmMedium: 'cpc',
      utmCampaign: 'spring',
      visits: 80,
      users: 70,
      goalReaches: 4,
      conversionRate: 0.05,
    },
  ]);
  metrics.upsertGeoDeviceStats([
    {
      date: '2025-01-02',
      country: 'Россия',
      device: 'mobile',
      visits: 60,
      users: 55,
      goalReaches: 3,
      conversionRate: 0.05,
    },
  ]);
  metrics.upsertPageStats([
    {
      date: '2025-01-02',
      page: '/lp',
      visits: 70,
      users: 60,
      bounceRate: 0.25,
      goalReaches: 4,
      conversionRate: 0.05,
    },
  ]);
  metrics.upsertExitPageStats([
    {
      date: '2025-01-02',
      page: '/checkout',
      visits: 40,
      users: 35,
      bounceRate: 0.6,
      goalReaches: 2,
      conversionRate: 0.05,
    },
  ]);
  hypotheses.create(validHypothesis({ kind: 'problem' }));
  hypotheses.create(validHypothesis({ kind: 'solution', diamondPhase: 'develop' }));
  b2b.create({ company: 'BigCorp', tickets: 20, stage: 'paid', dateAdded: '2025-01-01' });
  b2b.create({ company: 'SmallCo', tickets: 3, stage: 'lead', dateAdded: '2025-01-01' });
});
afterEach(() => db.close());

describe('SnapshotBuilder', () => {
  it('assembles KPI, channels, hypotheses split and decisions from the DB', () => {
    const snap = builder.build({
      id: 'snap-1',
      generatedAt: 'T',
      from: '2025-01-01',
      to: '2025-01-07',
    });
    expect(snap.id).toBe('snap-1');
    expect(snap.kpi).toEqual({ target: 300, b2cApplications: 7, b2bPaidTickets: 20, gap: 280 });
    expect(snap.channels).toHaveLength(1);
    expect(snap.hypotheses.problems).toHaveLength(1);
    expect(snap.hypotheses.solutions).toHaveLength(1);
    expect(snap.period).toEqual({ from: '2025-01-01', to: '2025-01-07' });
  });

  it('includes top breakdowns (UTM, geo/device, entry + exit pages) for the period', () => {
    const snap = builder.build({ id: 's', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' });
    expect(snap.breakdowns.utm[0]).toMatchObject({ source: 'vk', visits: 80 });
    expect(snap.breakdowns.geoDevice[0]).toMatchObject({ country: 'Россия', device: 'mobile' });
    expect(snap.breakdowns.entryPages[0]).toMatchObject({ page: '/lp', visits: 70 });
    expect(snap.breakdowns.exitPages[0]).toMatchObject({ page: '/checkout', visits: 40 });
  });

  it('is deterministic — same inputs + data yield an identical snapshot', () => {
    const opts = { id: 'x', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' };
    expect(JSON.stringify(builder.build(opts))).toBe(JSON.stringify(builder.build(opts)));
  });

  it('REG-04 (ANA-93): exposes cached-data coverage (statsCoverage) in the snapshot', () => {
    const snap = builder.build({ id: 'c', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' });
    // The seed has a single synced day (2025-01-02) inside the 7-day period.
    expect(snap.coverage).toEqual({ from: '2025-01-02', to: '2025-01-02', days: 1 });
  });

  it('REG-04 (ANA-93): omits coverage while nothing has been synced', () => {
    const emptyDb = freshDb();
    try {
      const emptyBuilder = new SnapshotBuilder({
        metrics: new MetricsRepo(emptyDb),
        hypotheses: new HypothesesRepo(emptyDb),
        decisions: new DecisionsRepo(emptyDb),
        b2b: new B2bRepo(emptyDb),
      });
      const snap = emptyBuilder.build({
        id: 'e',
        generatedAt: 'T',
        from: '2025-01-01',
        to: '2025-01-07',
      });
      expect(snap.coverage).toBeUndefined();
    } finally {
      emptyDb.close();
    }
  });

  it('excludes channel rows outside the requested period', () => {
    const snap = builder.build({ id: 'x', generatedAt: 'T', from: '2025-02-01', to: '2025-02-07' });
    expect(snap.channels).toHaveLength(0);
    expect(snap.kpi.b2cApplications).toBe(0);
  });

  it('includes b2bSummary with deals, totals and byStage breakdown', () => {
    const snap = builder.build({ id: 'x', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' });
    expect(snap.b2bSummary.totalTickets).toBe(23);
    expect(snap.b2bSummary.paidTickets).toBe(20);
    expect(snap.b2bSummary.dealsCount).toBe(2);
    expect(snap.b2bSummary.deals).toHaveLength(2);
    expect(snap.b2bSummary.byStage).toHaveLength(2);
  });

  it('includes funnel data (visits → applications → B2B pipeline → B2B paid)', () => {
    const snap = builder.build({ id: 'x', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' });
    expect(snap.funnel.visits).toBe(100);
    expect(snap.funnel.b2cApplications).toBe(7);
    expect(snap.funnel.b2bPipelineTickets).toBe(3);
    expect(snap.funnel.b2bPaidTickets).toBe(20);
  });

  it('REG-03: purchase-goal reaches are NOT payments — gap = target − B2C paid − B2B paid', () => {
    // Seed a purchase goal: its reaches are orders («Заказов»), never payments.
    metrics.upsertGoals([
      {
        id: 1,
        name: 'Ecommerce: покупка',
        type: 'e_purchase',
        isB2b: false,
        isArchived: false,
        syncedAt: 'T',
      },
    ]);
    const snap = builder.build({ id: 'p', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' });
    expect(snap.goalLabel).toMatchObject({ title: 'Заказов', isPaid: true });
    // 7 Metrika orders stay a separate metric; gap = 300 − 0 (B2C) − 20 (B2B) = 280.
    expect(snap.kpi.b2cApplications).toBe(7);
    expect(snap.kpi.gap).toBe(280);
  });

  it('REG-03: gap subtracts B2C payments (b2c_payments) for the report period', () => {
    const b2c = new B2cPaymentsRepo(db);
    b2c.upsert({ date: '2025-01-05', tickets: 12 }, { source: 'manual', now: () => 'T' });
    b2c.upsert({ date: '2025-01-09', tickets: 5 }, { source: 'csv', now: () => 'T' }); // outside
    const deps = {
      metrics,
      hypotheses: new HypothesesRepo(db),
      decisions: new DecisionsRepo(db),
      b2b: new B2bRepo(db),
    };
    const opts = { id: 'm', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' };
    const snap = new SnapshotBuilder({ ...deps, b2cPaid: (r) => b2c.sumTickets(r) }).build(opts);
    // gap = 300 − 12 (B2C in period) − 20 (B2B) = 268; the 5 out-of-period tickets don't count.
    expect(snap.kpi).toEqual({ target: 300, b2cApplications: 7, b2bPaidTickets: 20, gap: 268 });
    // Without the dep (legacy single-user mode) the B2C money is simply absent → gap 280.
    expect(builder.build(opts).kpi.gap).toBe(280);
  });
  it('uses the runtime KPI target setting for target + gap (default 300 when unset/invalid)', () => {
    const deps = {
      metrics,
      hypotheses: new HypothesesRepo(db),
      decisions: new DecisionsRepo(db),
      b2b: new B2bRepo(db),
    };
    const opts = { id: 'k', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' };
    const custom = new SnapshotBuilder({ ...deps, kpiTarget: () => '500' }).build(opts);
    // gap = 500 − B2B paid 20 (application goal → Metrika reaches are not payments) = 480.
    expect(custom.kpi).toMatchObject({ target: 500, gap: 480 });
    const invalid = new SnapshotBuilder({ ...deps, kpiTarget: () => '0' }).build(opts);
    expect(invalid.kpi).toMatchObject({ target: 300, gap: 280 });
  });

  it('labels the admin-pinned GOAL_ID goal instead of the auto-detected one', () => {
    metrics.upsertGoals([
      {
        id: 1,
        name: 'Ecommerce: покупка',
        type: 'e_purchase',
        isB2b: false,
        isArchived: false,
        syncedAt: 'T',
      },
      {
        id: 2,
        name: 'Заявка на билет',
        type: 'action',
        isB2b: false,
        isArchived: false,
        syncedAt: 'T',
      },
    ]);
    const opts = { id: 'g', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' };
    const deps = {
      metrics,
      hypotheses: new HypothesesRepo(db),
      decisions: new DecisionsRepo(db),
      b2b: new B2bRepo(db),
    };
    expect(builder.build(opts).goalLabel).toMatchObject({ isPaid: true }); // auto → purchase
    const pinned = new SnapshotBuilder({ ...deps, primaryGoalId: () => 2 }).build(opts);
    expect(pinned.goalLabel).toMatchObject({ isPaid: false });
    expect(pinned.kpi.gap).toBe(280); // application goal → only B2B paid counts
  });

  it('groups B2B deals by same stage (exercises the merge branch in computeB2bSummary)', () => {
    // Create a third deal with the same 'paid' stage to exercise the "key exists" ?? branch
    const b2b = new B2bRepo(db);
    b2b.create({ company: 'AnotherCorp', tickets: 10, stage: 'paid', dateAdded: '2025-01-02' });
    const snap = builder.build({ id: 'y', generatedAt: 'T', from: '2025-01-01', to: '2025-01-07' });
    // paid stage now has 2 deals: BigCorp (20) + AnotherCorp (10) = 30 tickets
    expect(snap.b2bSummary.paidTickets).toBe(30);
    const paidStage = snap.b2bSummary.byStage.find((s) => s.stage === 'paid');
    expect(paidStage?.tickets).toBe(30);
    expect(paidStage?.deals).toBe(2); // two deals with 'paid' stage
  });
});
