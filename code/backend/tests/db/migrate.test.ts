import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type DB } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';

let db: DB;
afterEach(() => db?.close());

describe('migrate', () => {
  it('applies all migrations on a fresh database', () => {
    db = openDb(':memory:');
    const applied = migrate(db);
    expect(applied).toEqual([
      '001_init.sql',
      '002_hypotheses.sql',
      '003_b2b_manual.sql',
      '004_snapshots.sql',
      '005_decisions.sql',
      '006_utm_stats.sql',
      '007_geo_device_stats.sql',
      '008_page_stats.sql',
      '009_exit_page_stats.sql',
      '010_auth_settings_ai.sql',
      '011_demo_marks.sql',
      '012_ai_usage_tokens.sql',
      '013_user_counters.sql',
      '014_hypotheses_source.sql',
      '015_ana18_demo_cleanup.sql',
      '016_ana15_sync_runs.sql',
      '017_ana19_b2c_payments.sql',
      '018_marketing_weekly.sql',
      '018_snapshot_author.sql',
      '019_decisions_source.sql',
    ]);
  });

  it('applies the ANA-18/15/19 schema (is_demo marks, sync_runs, b2c_payments)', () => {
    db = openDb(':memory:');
    migrate(db);
    const columns = (table: string): string[] =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);
    // ANA-18: every Metrika-derived table is demo-markable.
    for (const t of [
      'goals',
      'channel_stats',
      'utm_stats',
      'geo_device_stats',
      'page_stats',
      'exit_page_stats',
      'b2b_manual',
    ]) {
      expect(columns(t)).toContain('is_demo');
    }
    // ANA-15: sync runs are persisted for the admin status UI.
    expect(columns('sync_runs')).toEqual(
      expect.arrayContaining(['id', 'started_at', 'status', 'summary', 'errors']),
    );
    // ANA-19: manual B2C payments, one row per ISO day.
    expect(columns('b2c_payments')).toEqual(
      expect.arrayContaining(['date', 'tickets', 'amount_rub', 'source', 'is_demo']),
    );
  });

  it('adds the ANA-18 demo marks (is_demo) to hypotheses and decisions', () => {
    db = openDb(':memory:');
    migrate(db);
    const columns = (table: string): string[] =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
          dflt_value: unknown;
        }>
      ).map((c) => c.name);
    expect(columns('hypotheses')).toContain('is_demo');
    expect(columns('decisions')).toContain('is_demo');
  });

  it('creates the expected tables', () => {
    db = openDb(':memory:');
    migrate(db);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of [
      'goals',
      'raw_responses',
      'channel_stats',
      'hypotheses',
      'b2b_manual',
      'report_snapshots',
      'decisions',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent — a second run applies nothing', () => {
    db = openDb(':memory:');
    migrate(db);
    expect(migrate(db)).toEqual([]);
  });

  it('computes ice_score as a generated column (impact*confidence*ease)', () => {
    db = openDb(':memory:');
    migrate(db);
    db.prepare(
      `INSERT INTO hypotheses (diamond_phase, kind, subject, action, solution, condition, title,
        hidden_assumptions, validation_methods, impact, confidence, ease,
        impact_rationale, confidence_rationale, ease_rationale,
        green_criteria, yellow_criteria, red_criteria, deadline_days, deadline_at, created_at, updated_at)
       VALUES ('define','problem','s','a','sol','c','t','[]','[]',8,5,7,'r','r','r','g','y','rd',2,'x','n','n')`,
    ).run();
    const { ice_score } = db.prepare('SELECT ice_score FROM hypotheses').get() as {
      ice_score: number;
    };
    expect(ice_score).toBe(280);
  });

  it('015 purges ONLY the legacy seed fingerprints — real-looking rows survive (ANA-18)', async () => {
    db = openDb(':memory:');
    migrate(db);
    // Legacy seed rows exactly as they looked before the is_demo marks (fixed 2025-01-01..05).
    db.prepare(
      `INSERT INTO b2b_manual (company, tickets, stage, date_added, date_paid)
       VALUES ('BigCorp', 20, 'paid', '2025-01-02', '2025-01-04')`,
    ).run();
    db.prepare(
      `INSERT INTO goals (id, name, type, is_archived, synced_at)
       VALUES (80, 'Оплата', 'action', 0, '2025-01-05T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate)
       VALUES ('2025-01-02', 'podcast', 420, 378, 0.2, 60, 12, 0.02)`,
    ).run();
    db.prepare(
      `INSERT INTO utm_stats (date, utm_source, utm_medium, utm_campaign, visits, users, goal_reaches, conversion_rate)
       VALUES ('2025-01-02', 'vk', 'cpc', 'spring-launch', 240, 216, 9, 0.0375)`,
    ).run();
    // Real-looking rows (different companies, ids, dates) must NOT be touched by the purge.
    db.prepare(
      `INSERT INTO b2b_manual (company, tickets, stage, date_added)
       VALUES ('RealCo', 50, 'paid', '2026-10-20')`,
    ).run();
    db.prepare(
      `INSERT INTO goals (id, name, type, is_archived, synced_at)
       VALUES (173370304, 'Оплата', 'action', 0, '2026-10-20T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate)
       VALUES ('2026-10-20', 'podcast', 900, 800, 0.3, 90, 30, 0.033)`,
    ).run();
    db.prepare(
      `INSERT INTO utm_stats (date, utm_source, utm_medium, utm_campaign, visits, users, goal_reaches, conversion_rate)
       VALUES ('2026-10-20', 'telegram', 'social', 'channel-post', 130, 117, 6, 0.046)`,
    ).run();

    // Replay the exact DELETE block of 015 (the purge half of the artifact) — a live DB that
    // already applied 015 gets the same predicates, so this proves the fingerprints only match
    // the old seed rows.
    const sql = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../src/db/migrations/015_ana18_demo_cleanup.sql',
      ),
      'utf8',
    );
    db.exec(sql.slice(sql.indexOf('DELETE FROM decisions')));

    const count = (table: string, where: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
    expect(count('b2b_manual', "company = 'BigCorp'")).toBe(0); // seed fingerprint gone
    expect(count('b2b_manual', "company = 'RealCo'")).toBe(1); // real row survives
    expect(count('goals', "id = 80 AND name = 'Оплата'")).toBe(0); // seed goal gone…
    expect(count('goals', 'id = 173370304')).toBe(1); // …real goal (huge id) survives
    expect(count('channel_stats', "date = '2025-01-02'")).toBe(0); // seed window gone
    expect(count('channel_stats', "date = '2026-10-20'")).toBe(1); // same channel, real date
    expect(count('utm_stats', "date = '2025-01-02'")).toBe(0);
    expect(count('utm_stats', "date = '2026-10-20'")).toBe(1);
  });
});
