import { config, hasMetrikaToken } from '../config';
import { openDb, type DB } from '../db/connection';
import { migrate } from '../db/migrate';
import { SyncRunRepo } from '../db/repositories/sync-run-repo';
import { MarketingRepo } from '../db/repositories/marketing-repo';
import { recomputeWeekly } from '../marketing/sync';
import { windowFor } from './sync-window';
import { makeSyncRunner } from './production-sync';
// REG-05: the CLI must record the same run outcome as POST /api/sync — «partial» when the summary
// carries per-step errors, not an unconditional «ok».
import { outcomeOf } from '../routes/sync';

/** CLI: `pnpm --filter @pca/backend sync [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--days=N] [--goalId=ID]`.
 *  Excluded from coverage. */
function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

async function main(): Promise<void> {
  if (!hasMetrikaToken()) {
    console.log('sync: no YANDEX_OAUTH_TOKEN set — skipping. Fill .env and re-run `pnpm sync`.');
    return;
  }
  const to = arg('to') ?? new Date().toISOString().slice(0, 10);
  const from = arg('from') ?? new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
  const goalIdRaw = arg('goalId');
  // --days=N (ANA-74): окно = последние N дней включая сегодня. Явные from/to имеют приоритет.
  const days = arg('days') ? Number(arg('days')) : undefined;
  const window = days ? windowFor(days) : { from, to };

  // Прогон фиксируется в sync_runs — «Админ → Метрика и данные» и /api/sync/status показывают
  // свежесть данных даже для крон-запусков (ANA-74).
  const db: DB = openDb(config.DB_PATH);
  migrate(db);
  const runs = new SyncRunRepo(db);
  const runId = runs.start(window.from, window.to);

  try {
    const summary = await makeSyncRunner()({
      from: window.from,
      to: window.to,
      goalId: goalIdRaw ? Number(goalIdRaw) : undefined,
    });
    // REG-05: failed optional steps (summary.errors) → «partial», not «ok»; only a clean run is ok.
    runs.finish(
      runId,
      outcomeOf(summary),
      summary as unknown as Record<string, unknown>,
      summary.errors ?? [],
    );
    console.log(`sync done (counter ${config.COUNTER_ID}):`, summary);

    // ANA-74: после успешного синка пересчитываем syncable-ячейки маркетинговой сетки
    // (landings/goals/payments/b2b_leads) — manual/import не трогаются.
    const written = recomputeWeekly(new MarketingRepo(db), () => new Date().toISOString());
    const cells = Object.values(written.updated).reduce((a, b) => a + b, 0);
    console.log(
      `marketing grid: +${cells} cells, weeks without data: ${written.skippedWeeks.length}`,
    );
  } catch (err) {
    runs.finish(runId, 'failed', undefined, [
      { step: 'sync', message: err instanceof Error ? err.message : String(err) },
    ]);
    throw err;
  } finally {
    db.close();
  }
}

void main();
