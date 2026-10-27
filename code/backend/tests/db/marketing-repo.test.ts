import { describe, expect, it } from 'vitest';
import { MarketingRepo } from '../../src/db/repositories/marketing-repo';
import { freshDb } from './helpers';
import type { NewMarketingCell } from '@pca/shared';

const now = () => '2026-10-27T10:00:00.000Z';
const cell = (weekStart: string, metricKey: string, value: number): NewMarketingCell => ({
  weekStart,
  metricKey,
  value,
});

describe('MarketingRepo', () => {
  it('upsert + get + list roundtrip', () => {
    const repo = new MarketingRepo(freshDb());
    const saved = repo.upsert(cell('2026-08-01', 'tg_clicks', 18), { source: 'import', now });
    expect(saved.source).toBe('import');
    expect(saved.value).toBe(18);
    expect(saved.updatedAt).toBe(now());

    const updated = repo.upsert(cell('2026-08-01', 'tg_clicks', 29), { source: 'manual', now });
    expect(updated.source).toBe('manual');

    expect(repo.get('2026-08-01', 'tg_clicks')?.value).toBe(29);
    expect(repo.get('2026-08-08', 'tg_clicks')).toBeUndefined();
    expect(repo.list()).toHaveLength(1);
  });

  it('list filters by week range', () => {
    const repo = new MarketingRepo(freshDb());
    repo.upsert(cell('2026-08-01', 'tg_clicks', 1), { source: 'import', now });
    repo.upsert(cell('2026-09-07', 'tg_clicks', 2), { source: 'import', now });
    repo.upsert(cell('2026-10-19', 'tg_clicks', 3), { source: 'import', now });
    const cells = repo.list({ from: '2026-09-01', to: '2026-10-01' });
    expect(cells.map((c) => c.weekStart)).toEqual(['2026-09-07']);
  });

  it('upsertMany(metrika) inserts new cells but never overwrites manual or import', () => {
    const repo = new MarketingRepo(freshDb());
    repo.upsert(cell('2026-08-01', 'landings_visits', 999), { source: 'manual', now });
    repo.upsert(cell('2026-08-08', 'landings_visits', 531), { source: 'import', now });

    const written = repo.upsertMany(
      [
        cell('2026-08-01', 'landings_visits', 100), // manual — must survive
        cell('2026-08-08', 'landings_visits', 200), // import — must survive
        cell('2026-09-07', 'landings_visits', 300), // empty — insert
      ],
      { source: 'metrika', updatedBy: 'sync', now },
    );
    expect(written).toBe(1);
    expect(repo.get('2026-08-01', 'landings_visits')?.value).toBe(999);
    expect(repo.get('2026-08-01', 'landings_visits')?.source).toBe('manual');
    expect(repo.get('2026-08-08', 'landings_visits')?.value).toBe(531);
    expect(repo.get('2026-09-07', 'landings_visits')?.source).toBe('metrika');
  });

  it('upsertMany(import) refreshes import+metrika but not manual', () => {
    const repo = new MarketingRepo(freshDb());
    repo.upsert(cell('2026-08-01', 'payments', 5), { source: 'metrika', now });
    repo.upsert(cell('2026-08-08', 'payments', 0), { source: 'manual', now });

    const written = repo.upsertMany(
      [cell('2026-08-01', 'payments', 7), cell('2026-08-08', 'payments', 9)],
      { source: 'import', updatedBy: 'sheet-import', now },
    );
    expect(written).toBe(1);
    expect(repo.get('2026-08-01', 'payments')?.value).toBe(7);
    expect(repo.get('2026-08-01', 'payments')?.source).toBe('import');
    expect(repo.get('2026-08-08', 'payments')?.value).toBe(0);
    expect(repo.get('2026-08-08', 'payments')?.source).toBe('manual');
  });

  it('remove deletes a cell and reports emptiness', () => {
    const repo = new MarketingRepo(freshDb());
    repo.upsert(cell('2026-10-19', 'referrals_clicks', 100), { source: 'manual', now });
    expect(repo.remove('2026-10-19', 'referrals_clicks')).toBe(true);
    expect(repo.remove('2026-10-19', 'referrals_clicks')).toBe(false);
  });

  it('weekTotals aggregates the sync sources over a window', () => {
    const db = freshDb();
    const repo = new MarketingRepo(db);
    db.prepare(
      `INSERT INTO channel_stats (date, channel, utm_source, utm_medium, utm_campaign, visits, users,
         bounce_rate, avg_duration, goal_reaches, conversion_rate, is_demo)
       VALUES ('2026-08-02', 'Search engine traffic', 'google', 'organic', 'none', 300, 280, 20, 60, 4, 1.3, 0),
              ('2026-08-03', 'Direct traffic', null, null, null, 186, 180, 10, 40, 2, 1.0, 0),
              ('2026-08-09', 'Direct traffic', null, null, null, 500, 480, 10, 40, 1, 0.2, 0)`,
    ).run();

    const w1 = repo.weekTotals('2026-08-01', '2026-08-07');
    expect(w1.channelRows).toBe(2);
    expect(w1.visits).toBe(486);
    expect(w1.goalReaches).toBe(6);
    expect(w1.b2cRows).toBe(0);
    expect(w1.b2bLeadRows).toBe(0);

    const w2 = repo.weekTotals('2026-08-08', '2026-08-14');
    expect(w2.channelRows).toBe(1);
    expect(w2.visits).toBe(500);
  });

  it('weekTotals counts payments (b2c + paid b2b) and b2b leads', () => {
    const db = freshDb();
    const repo = new MarketingRepo(db);
    db.prepare(
      `INSERT INTO b2c_payments (date, tickets, source, is_demo, updated_at)
       VALUES ('2026-10-20', 3, 'manual', 0, '2026-10-20T00:00:00Z'),
              ('2026-10-21', 2, 'manual', 0, '2026-10-21T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO b2b_manual (company, tickets, stage, date_added, date_paid, is_demo)
       VALUES ('ООО «Ромашка»', 5, 'paid', '2026-10-19', '2026-10-22', 0),
              ('ООО «Василёк»', 2, 'lead', '2026-10-21', null, 0),
              ('Ранняя сделка', 1, 'paid', '2026-09-01', '2026-09-02', 0)`,
    ).run();

    const t = repo.weekTotals('2026-10-19', '2026-10-25');
    expect(t.b2cRows).toBe(2);
    expect(t.b2bPaidRows).toBe(1);
    expect(t.payments).toBe(3 + 2 + 5); // b2c tickets + paid b2b tickets
    expect(t.b2bLeadRows).toBe(2); // deals added in the week
  });
});
