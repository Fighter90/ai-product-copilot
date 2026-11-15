import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type DB } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { MetricsRepo } from '../../src/db/repositories/metrics-repo';

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
      '020_decision_type.sql',
      '021_ana147_prelaunch_cleanup.sql',
      '022_ana148_stat_date_indexes.sql',
      '023_ana153_protected_days.sql',
      '024_ana169_decision_status.sql',
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

  it('020 adds decisions.decision_type and backfills legacy AI rows as hypothesis drafts (ANA-137)', () => {
    db = openDb(':memory:');
    // `until` stops right before 020: a DB where AI drafts predate the autonomy model.
    const before = migrate(db, { until: '020_decision_type.sql' });
    expect(before).not.toContain('020_decision_type.sql');
    const columns = (
      db.prepare('PRAGMA table_info(decisions)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).not.toContain('decision_type');

    // Pre-020 rows inserted the old way — no decision_type column exists yet.
    const h = db
      .prepare(
        `INSERT INTO hypotheses (diamond_phase, kind, subject, action, solution, condition, title,
          hidden_assumptions, validation_methods, impact, confidence, ease,
          impact_rationale, confidence_rationale, ease_rationale,
          green_criteria, yellow_criteria, red_criteria, deadline_days, deadline_at, created_at, updated_at)
         VALUES ('define','problem','s','a','sol','c','t','[]','[]',8,5,7,'r','r','r','g','y','rd',2,'x','n','n')`,
      )
      .run();
    const insertDecision = db.prepare(
      `INSERT INTO decisions (number, hypothesis_id, date, method, scope, period_days, findings,
         evidence, outcome, outcome_rationale, next_step, decided_by, is_demo, source, created_at, updated_at)
       VALUES (?, ?, '2025-01-10', 'mixed', '5 интервью', 5, '[]', '[]', 'yellow', 'r', 'next', ?, 0, ?, 'n', 'n')`,
    );
    insertDecision.run('DL-001', Number(h.lastInsertRowid), 'AI · yandexgpt', 'ai');
    insertDecision.run('DL-002', Number(h.lastInsertRowid), 'команда трека', 'manual');

    const applied = migrate(db);
    expect(applied).toEqual([
      '020_decision_type.sql',
      '021_ana147_prelaunch_cleanup.sql',
      '022_ana148_stat_date_indexes.sql',
      '023_ana153_protected_days.sql',
      '024_ana169_decision_status.sql',
    ]);

    const typeOf = (number: string): string | null =>
      (
        db.prepare('SELECT decision_type FROM decisions WHERE number = ?').get(number) as {
          decision_type: string | null;
        }
      ).decision_type;
    // Every AI row created before 020 came from ai-autopopulate (ANA-128) as a
    // hypothesis-verification draft — the backfill records that, so no legacy row
    // turns into a «requires PM escalation» badge on deploy.
    expect(typeOf('DL-001')).toBe('hypothesis-draft');
    // Manual rows stay NULL — their type is not inferred.
    expect(typeOf('DL-002')).toBeNull();
  });

  it('021 purges the unmarked pre-launch era so coverage starts at the real counter day (ANA-147)', () => {
    db = openDb(':memory:');
    // Stage the prod state (progress.md): the one-off 365-day Metrika backfill wrote
    // 2025-04-29..2026-11-03 through the normal sync path — every row UNMARKED (is_demo = 0),
    // so ANA-142's live-wins reads treat the era as real and coverage stretches to «563 дн.
    // (с 2025-04-29)». The counter only lives from 2026-11-06 (the honest KPI base, ANA-142).
    const before = migrate(db, { until: '021_ana147_prelaunch_cleanup.sql' });
    expect(before).not.toContain('021_ana147_prelaunch_cleanup.sql');

    // Unmarked backfill-era rows in every derived stat table (real Metrika dimension values —
    // fingerprints can't match them, the date boundary is the only honest predicate).
    db.prepare(
      `INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate)
       VALUES ('2025-04-29', 'advertising', 3, 3, 0, 0, 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO utm_stats (date, utm_source, utm_medium, utm_campaign, visits, users, goal_reaches, conversion_rate)
       VALUES ('2025-04-29', 'yandex', 'cpc', 'brand', 3, 3, 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO geo_device_stats (date, country, device, visits, users, goal_reaches, conversion_rate)
       VALUES ('2026-01-15', 'Россия', 'desktop', 3, 3, 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO page_stats (date, page, visits, users, bounce_rate, goal_reaches, conversion_rate)
       VALUES ('2026-11-03', '/', 3, 3, 0, 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO exit_page_stats (date, page, visits, users, bounce_rate, goal_reaches, conversion_rate)
       VALUES ('2026-11-03', '/', 3, 3, 0, 0, 0)`,
    ).run();
    // A demo-marked leftover from the same pre-launch era goes too: before the counter's
    // first real day EVERY stat row is noise, regardless of the mark.
    db.prepare(
      `INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate, is_demo)
       VALUES ('2025-06-01', 'podcast', 420, 378, 0.2, 60, 12, 0.02, 1)`,
    ).run();
    // The counter's real first days — must survive the purge.
    for (const day of ['2026-11-06', '2026-11-07']) {
      db.prepare(
        `INSERT INTO channel_stats (date, channel, visits, users, bounce_rate, avg_duration, goal_reaches, conversion_rate)
         VALUES (?, 'advertising', 900, 800, 0.3, 90, 30, 0.033)`,
      ).run(day);
      db.prepare(
        `INSERT INTO utm_stats (date, utm_source, utm_medium, utm_campaign, visits, users, goal_reaches, conversion_rate)
         VALUES (?, 'yandex', 'cpc', 'brand', 130, 117, 6, 0.046)`,
      ).run(day);
      db.prepare(
        `INSERT INTO geo_device_stats (date, country, device, visits, users, goal_reaches, conversion_rate)
         VALUES (?, 'Россия', 'mobile', 900, 800, 30, 0.033)`,
      ).run(day);
      db.prepare(
        `INSERT INTO page_stats (date, page, visits, users, bounce_rate, goal_reaches, conversion_rate)
         VALUES (?, '/tickets', 900, 800, 0.3, 30, 0.033)`,
      ).run(day);
      db.prepare(
        `INSERT INTO exit_page_stats (date, page, visits, users, bounce_rate, goal_reaches, conversion_rate)
         VALUES (?, '/tickets', 900, 800, 0.3, 30, 0.033)`,
      ).run(day);
    }
    // User-entered data and the raw audit trail are never Metrika stat rows — untouched.
    db.prepare(
      `INSERT INTO b2b_manual (company, tickets, stage, date_added)
       VALUES ('RealCo', 50, 'paid', '2026-10-20')`,
    ).run();
    db.prepare(
      `INSERT INTO b2c_payments (date, tickets, source, updated_at)
       VALUES ('2026-11-10', 5, 'manual', 'n')`,
    ).run();
    db.prepare(
      `INSERT INTO raw_responses (endpoint, query_hash, date_from, date_to, payload, fetched_at)
       VALUES ('/stat/v1/data', 'h', '2025-04-29', '2025-04-29', '{}', 'n')`,
    ).run();

    const applied = migrate(db);
    expect(applied).toEqual([
      '021_ana147_prelaunch_cleanup.sql',
      '022_ana148_stat_date_indexes.sql',
      '023_ana153_protected_days.sql',
      '024_ana169_decision_status.sql',
    ]);

    const dates = (table: string): string[] =>
      (
        db.prepare(`SELECT DISTINCT date FROM ${table} ORDER BY date`).all() as Array<{
          date: string;
        }>
      ).map((r) => r.date);
    // Pre-launch era gone (marked or not), the real counter days stay in every table.
    for (const t of [
      'channel_stats',
      'utm_stats',
      'geo_device_stats',
      'page_stats',
      'exit_page_stats',
    ]) {
      expect(dates(t)).toEqual(['2026-11-06', '2026-11-07']);
    }
    expect(dates('b2c_payments')).toEqual(['2026-11-10']); // user data survives
    expect(
      (db.prepare('SELECT company FROM b2b_manual').all() as Array<{ company: string }>).map(
        (r) => r.company,
      ),
    ).toEqual(['RealCo']); // user data survives
    // raw_responses keep the anti-hallucination audit trail of the purged era.
    expect((db.prepare('SELECT COUNT(*) AS n FROM raw_responses').get() as { n: number }).n).toBe(
      1,
    );
    // «Показать честное окно»: KPI/coverage counts from the first real counter day only.
    expect(new MetricsRepo(db).statsCoverage()).toEqual({
      from: '2026-11-06',
      to: '2026-11-07',
      days: 2,
    });
    // Idempotent: a second run applies nothing.
    expect(migrate(db)).toEqual([]);
  });

  it('022 adds a single-column date index to every derived stat table (ANA-148)', () => {
    db = openDb(':memory:');
    migrate(db);
    for (const t of [
      'channel_stats',
      'utm_stats',
      'geo_device_stats',
      'page_stats',
      'exit_page_stats',
    ]) {
      const indexes = db.prepare(`PRAGMA index_list(${t})`).all() as Array<{
        name: string;
        origin: string;
      }>;
      expect(indexes.map((i) => i.name)).toContain(`idx_${t}_date`);
      const cols = (
        db.prepare(`PRAGMA index_info(idx_${t}_date)`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      expect(cols[0]).toBe('date');
    }
    // The date-ranged read behind GET /api/metrics/utm?from&to stays index-driven, never a
    // full table scan — the «холодный < 3с» half of the acceptance criteria.
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM utm_stats WHERE date >= ? AND date <= ?')
      .all('2025-01-01', '2025-01-31') as Array<{ detail: string }>;
    expect(plan.some((r) => /USING INDEX/i.test(r.detail))).toBe(true);
  });

  it('024 backfills decision formulations and kanban lanes from stored data (ANA-169)', () => {
    db = openDb(':memory:');
    // Stage the pre-ANA-169 state: rows created before the kanban model have no decision
    // formulation and no status column at all.
    const before = migrate(db, { until: '024_ana169_decision_status.sql' });
    expect(before).not.toContain('024_ana169_decision_status.sql');
    const columns = (
      db.prepare('PRAGMA table_info(decisions)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).not.toContain('decision');
    expect(columns).not.toContain('status');

    const h = db
      .prepare(
        `INSERT INTO hypotheses (diamond_phase, kind, subject, action, solution, condition, title,
          hidden_assumptions, validation_methods, impact, confidence, ease,
          impact_rationale, confidence_rationale, ease_rationale,
          green_criteria, yellow_criteria, red_criteria, deadline_days, deadline_at, created_at, updated_at)
         VALUES ('define','problem','s','a','sol','c','t','[]','[]',8,5,7,'r','r','r','g','y','rd',2,'x','n','n')`,
      )
      .run();
    const insertDecision = db.prepare(
      `INSERT INTO decisions (number, hypothesis_id, date, method, scope, period_days, findings,
         evidence, outcome, outcome_rationale, next_step, decided_by, is_demo, source, created_at, updated_at)
       VALUES (?, ?, '2025-01-10', 'mixed', '5 интервью', 5, '[]', '[]', 'yellow', 'вывод', ?, ?, 0, ?, 'n', 'n')`,
    );
    insertDecision.run(
      'DL-001',
      Number(h.lastInsertRowid),
      'масштабируем подкаст',
      'команда',
      'manual',
    );
    insertDecision.run(
      'DL-002',
      Number(h.lastInsertRowid),
      'проверить гипотезу: A/B',
      'AI · yandexgpt',
      'ai',
    );

    const applied = migrate(db);
    expect(applied).toEqual(['024_ana169_decision_status.sql']);

    const row = (number: string): { decision: string; status: string } =>
      db.prepare('SELECT decision, status FROM decisions WHERE number = ?').get(number) as {
        decision: string;
        status: string;
      };
    // The formulation is derived from the stored «что делаем» (next_step) — no text invented.
    expect(row('DL-001')).toEqual({ decision: 'масштабируем подкаст', status: 'accepted' });
    // A manual conclusion was a made decision → «Принято»; an AI draft stays a proposal → «В работе».
    expect(row('DL-002')).toEqual({ decision: 'проверить гипотезу: A/B', status: 'in_progress' });

    // Idempotent: a second run applies nothing.
    expect(migrate(db)).toEqual([]);
  });
});
