import { config } from '../config';
import { openDb, type DB } from '../db/connection';
import { migrate } from '../db/migrate';
import { MetricsRepo } from '../db/repositories/metrics-repo';
import { recoverHistoryFromRaw } from './recovery';

/**
 * CLI: `pnpm --filter @pca/backend recover [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--dry-run]`.
 *
 * ANA-150 one-off data recovery: replays the raw_responses audit trail (the sync chunks saved
 * BEFORE the counter reset ~2026-11-06) back through the sync's own parsers and upserts the
 * derived stat tables for the era migration 021 purged — 2025-04-29..2026-11-05 by default.
 * No Metrika calls, no token needed; raw_responses are only read, never written; the upsert is
 * INSERT OR REPLACE on the tables' natural keys, so re-running is safe. Use --dry-run to parse
 * and report without writing.
 */
function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

function main(): void {
  const from = arg('from') ?? '2025-04-29';
  const to = arg('to') ?? '2026-11-05';
  const dryRun = process.argv.includes('--dry-run');
  const db: DB = openDb(config.DB_PATH);
  migrate(db);
  const metrics = new MetricsRepo(db);
  console.log(
    `recover: scanning raw_responses ${from}..${to}${dryRun ? ' (dry-run, no writes)' : ''}`,
  );
  const summary = recoverHistoryFromRaw(metrics, { from, to }, { write: !dryRun });
  console.log('recovered:', JSON.stringify(summary));
  console.log('coverage:', JSON.stringify(metrics.statsCoverage()));
  console.log('coverage tables:', JSON.stringify(metrics.statsCoverageTables()));
  db.close();
}

void main();
