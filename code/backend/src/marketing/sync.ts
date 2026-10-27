import type { MarketingRepo } from '../db/repositories/marketing-repo';
import { MARKETING_WEEKS } from './definitions';
import type { NewMarketingCell } from '@pca/shared';

export interface MarketingSyncResult {
  /** Week grid size. */
  weeks: number;
  /** Cells written per metric key (only metrics with source data in the window). */
  updated: Record<string, number>;
  /** Week keys with no source data at all — left empty until the ANA-72 historical backfill. */
  skippedWeeks: string[];
}

/**
 * ANA-73: recompute the syncable weekly cells from the data already in the DB —
 *
 *   landings_visits / site_goals ← channel_stats (synced from Metrika, summed per week)
 *   payments                     ← b2c_payments.tickets + paid b2b_manual.tickets
 *   b2b_leads                    ← count of b2b_manual deals added in the week
 *
 * A cell is written only when the window actually has source data (a pre-launch week with no
 * rows stays empty instead of showing a misleading 0). Manual and imported cells are never
 * overwritten (MarketingRepo.upsertMany guards by source priority: manual > import > metrika).
 */
export function recomputeWeekly(repo: MarketingRepo, now: () => string): MarketingSyncResult {
  const updated: Record<string, number> = {};
  const skippedWeeks: string[] = [];
  const write = (cell: NewMarketingCell): number =>
    repo.upsertMany([cell], { source: 'metrika', updatedBy: 'sync', now });

  for (const week of MARKETING_WEEKS) {
    const t = repo.weekTotals(week.start, week.end);

    // Metrika-side sums (only when the window has synced rows at all).
    if (t.channelRows > 0) {
      updated.landings_visits =
        (updated.landings_visits ?? 0) +
        write({
          weekStart: week.key,
          metricKey: 'landings_visits',
          value: t.visits,
        });
      updated.site_goals =
        (updated.site_goals ?? 0) +
        write({
          weekStart: week.key,
          metricKey: 'site_goals',
          value: t.goalReaches,
        });
    }

    // «оплат» = подтверждённые деньги: B2C-платежи дня + оплаченные B2B-сделки (ANA-19).
    if (t.b2cRows > 0 || t.b2bPaidRows > 0) {
      updated.payments =
        (updated.payments ?? 0) +
        write({
          weekStart: week.key,
          metricKey: 'payments',
          value: t.payments,
        });
    }

    // Заявки b2b: сделки, добавленные за неделю.
    if (t.b2bLeadRows > 0) {
      updated.b2b_leads =
        (updated.b2b_leads ?? 0) +
        write({
          weekStart: week.key,
          metricKey: 'b2b_leads',
          value: t.b2bLeadRows,
        });
    }

    if (t.channelRows === 0 && t.b2cRows === 0 && t.b2bPaidRows === 0 && t.b2bLeadRows === 0) {
      skippedWeeks.push(week.key);
    }
  }

  return { weeks: MARKETING_WEEKS.length, updated, skippedWeeks };
}
