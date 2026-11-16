import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type DB } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { snapshotKpiMeta } from '@pca/shared';

/**
 * ANA-139 review (round 2): the KPI pinning rule exists twice — the SQL CASE of migration 025
 * (backfill of pre-025 rows) and the shared snapshotKpiMeta (the save-path pinning). The
 * migrate/snapshot-repo suites mirror each other with DUPLICATED fixtures, which drifts
 * silently. This is the single true parity test: ONE payload set, BOTH implementations, row by
 * row — pre-025 and post-025 rows must never show different план→факт for identical payloads.
 *
 * The reviewer's concrete divergence case (b2cPaidTickets present, b2bPaidTickets absent) is
 * included: the SQL WHERE skips the row entirely (both columns NULL), so the shared function
 * must also return null/null — never a half-truth {target, null}.
 */

interface ParityRow {
  /** Stable row id, also the assertion label. */
  readonly id: string;
  /** What the repo save-path passes into snapshotKpiMeta (the parsed payload object). */
  readonly tsInput: unknown;
  /** What actually sits in the report_snapshots.payload TEXT column. */
  readonly sqlText: string;
}

const jsonRow = (id: string, tsInput: unknown): ParityRow => ({
  id,
  tsInput,
  sqlText: JSON.stringify(tsInput),
});

// The same rows the 025 backfill meets in prod: new payload, legacy payload, B2B over target,
// clamped negatives, junk, partial data — every branch of both implementations.
const PAYLOADS: readonly ParityRow[] = [
  jsonRow('new-payload', {
    kpi: { target: 300, b2cApplications: 400, b2cPaidTickets: 75, b2bPaidTickets: 20, gap: 205 },
  }),
  jsonRow('legacy', { kpi: { target: 300, b2cApplications: 412, b2bPaidTickets: 120, gap: 80 } }),
  jsonRow('legacy-b2b-over', {
    kpi: { target: 300, b2cApplications: 0, b2bPaidTickets: 320, gap: 0 },
  }),
  // ANA-139 review: b2c WITHOUT b2b — SQL WHERE fails the row → both columns NULL.
  jsonRow('b2c-without-b2b', { kpi: { target: 300, b2cApplications: 5, b2cPaidTickets: 95 } }),
  // b2b without b2c and without gap — the legacy branch cannot derive paid → row skipped.
  jsonRow('b2b-without-gap', { kpi: { target: 300, b2cApplications: 5, b2bPaidTickets: 150 } }),
  jsonRow('gap-not-number', { kpi: { target: 300, b2bPaidTickets: 150, gap: '80' } }),
  jsonRow('negative-clamp', { kpi: { target: 300, b2cPaidTickets: -10, b2bPaidTickets: -5 } }),
  jsonRow('string-target', { kpi: { target: '300', b2cPaidTickets: 1, b2bPaidTickets: 1 } }),
  jsonRow('no-kpi-block', { ok: true }),
  // A truncated payload straight from a crashed write: json_valid fails → row skipped; the
  // shared function receives the raw string (typeof 'string' → no kpi) — must agree.
  { id: 'invalid-json', tsInput: '{"kpi":{"target":300', sqlText: '{"kpi":{"target":300' },
];

let db: DB;
afterEach(() => db?.close());

describe('025 backfill ⇄ snapshotKpiMeta parity (ANA-139 review)', () => {
  it('the SQL migration and the shared function return identical план→факт for every payload', async () => {
    // A pre-025 database: 001..024 applied, report_snapshots still without kpi columns.
    db = openDb(':memory:');
    const applied = migrate(db, { until: '025_ana193_snapshot_kpi_meta.sql' });
    expect(applied).not.toContain('025_ana193_snapshot_kpi_meta.sql');

    const insert = db.prepare(
      `INSERT INTO report_snapshots (id, generated_at, date_from, date_to, payload)
       VALUES (?, '2026-11-16T00:00:00.000Z', '2026-11-06', '2026-11-15', ?)`,
    );
    for (const row of PAYLOADS) insert.run(row.id, row.sqlText);

    // Replay the EXACT migration file (ALTER + UPDATE) — not a hand-copied CASE.
    const sql = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../src/db/migrations/025_ana193_snapshot_kpi_meta.sql',
      ),
      'utf8',
    );
    db.exec(sql);

    const rows = db
      .prepare('SELECT id, kpi_target, kpi_paid FROM report_snapshots ORDER BY id')
      .all() as Array<{ id: string; kpi_target: number | null; kpi_paid: number | null }>;
    expect(rows).toHaveLength(PAYLOADS.length);

    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const row of PAYLOADS) {
      const sqlMeta = byId.get(row.id)!;
      expect(
        { kpiTarget: sqlMeta.kpi_target, kpiPaid: sqlMeta.kpi_paid },
        `parity drift on ${row.id}: SQL ${JSON.stringify(sqlMeta)} vs shared ${JSON.stringify(
          snapshotKpiMeta(row.tsInput),
        )}`,
      ).toEqual(snapshotKpiMeta(row.tsInput));
    }

    // Anti-vacuity anchors (hand-computed): parity alone could go green with BOTH sides wrong.
    expect(byId.get('new-payload')).toMatchObject({ kpi_target: 300, kpi_paid: 95 });
    expect(byId.get('legacy-b2b-over')).toMatchObject({ kpi_target: 300, kpi_paid: 320 });
    // The reviewer's divergence case — both implementations must agree on null/null.
    expect(byId.get('b2c-without-b2b')).toMatchObject({ kpi_target: null, kpi_paid: null });
    expect(snapshotKpiMeta(PAYLOADS.find((p) => p.id === 'b2c-without-b2b')!.tsInput)).toEqual({
      kpiTarget: null,
      kpiPaid: null,
    });
    expect(byId.get('no-kpi-block')).toMatchObject({ kpi_target: null, kpi_paid: null });
  });
});
