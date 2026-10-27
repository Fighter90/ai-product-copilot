import { config } from '../config';
import { openDb } from './connection';
import { migrate } from './migrate';
import { MarketingRepo } from './repositories/marketing-repo';
import { buildStataSheetCells } from '../marketing/sheet-data';

/**
 * ANA-73: import the real campaign data from the Google Sheet «Инфопартнеры ProductCamp |
 * лето 2026» (лист «стата») into marketing_weekly with source='import'. Manual cells are never
 * overwritten; re-running the import refreshes imported values with the sheet's current numbers.
 *
 *   pnpm --filter @pca/backend marketing:import
 */
async function main(): Promise<void> {
  const db = openDb(config.DB_PATH);
  migrate(db);
  const repo = new MarketingRepo(db);
  const cells = buildStataSheetCells();
  const written = repo.upsertMany(cells, {
    source: 'import',
    updatedBy: 'sheet-import',
    now: () => new Date().toISOString(),
  });
  console.log(
    `[marketing:import] sheet cells: ${cells.length}, written: ${written} (manual cells untouched)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
