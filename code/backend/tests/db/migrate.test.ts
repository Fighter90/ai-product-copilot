import { describe, it, expect, afterEach } from 'vitest';
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
    ]);
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
});
