import type { DB } from '../connection';
import type { MarketingCell, MarketingSource, NewMarketingCell } from '@pca/shared';

interface Row {
  week_start: string;
  metric_key: string;
  value: number;
  source: MarketingSource;
  note: string | null;
  is_demo: number;
  updated_at: string;
  updated_by: string | null;
}

function toCell(r: Row): MarketingCell {
  return {
    weekStart: r.week_start,
    metricKey: r.metric_key,
    value: r.value,
    source: r.source,
    note: r.note ?? undefined,
    isDemo: r.is_demo ? true : undefined,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by ?? undefined,
  };
}

/**
 * ANA-73: the weekly marketing grid (Google Sheet «стата» replacement). Manual cells are the
 * analyst's explicit input — bulk writes (import/sync) never overwrite them unless `force`.
 */
export class MarketingRepo {
  constructor(private readonly db: DB) {}

  list(range?: { from: string; to: string }): MarketingCell[] {
    const rows = range
      ? (this.db
          .prepare(
            'SELECT * FROM marketing_weekly WHERE week_start >= ? AND week_start <= ? ORDER BY week_start, metric_key',
          )
          .all(range.from, range.to) as Row[])
      : (this.db
          .prepare('SELECT * FROM marketing_weekly ORDER BY week_start, metric_key')
          .all() as Row[]);
    return rows.map(toCell);
  }

  get(weekStart: string, metricKey: string): MarketingCell | undefined {
    const row = this.db
      .prepare('SELECT * FROM marketing_weekly WHERE week_start = ? AND metric_key = ?')
      .get(weekStart, metricKey) as Row | undefined;
    return row ? toCell(row) : undefined;
  }

  upsert(
    input: NewMarketingCell,
    opts: { source: MarketingSource; isDemo?: boolean; updatedBy?: string; now: () => string },
  ): MarketingCell {
    const row = this.db
      .prepare(
        `INSERT INTO marketing_weekly (week_start, metric_key, value, source, note, is_demo, updated_at, updated_by)
         VALUES (@week_start, @metric_key, @value, @source, @note, @is_demo, @updated_at, @updated_by)
         ON CONFLICT(week_start, metric_key) DO UPDATE SET
           value = excluded.value,
           source = excluded.source,
           note = excluded.note,
           is_demo = excluded.is_demo,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by
         RETURNING *`,
      )
      .get({
        week_start: input.weekStart,
        metric_key: input.metricKey,
        value: input.value,
        source: opts.source,
        note: input.note ?? null,
        is_demo: opts.isDemo ? 1 : 0,
        updated_at: opts.now(),
        updated_by: opts.updatedBy ?? null,
      }) as Row;
    return toCell(row);
  }

  /**
   * Bulk upsert for the Metrika sync and the sheet import. Priority: manual > import > metrika —
   * a bulk write skips cells whose stored source ranks higher, unless `force` (still never
   * overwrites `manual`: that is the analyst's explicit input). Returns the number of rows written.
   */
  upsertMany(
    cells: NewMarketingCell[],
    opts: { source: Exclude<MarketingSource, 'manual'>; updatedBy?: string; now: () => string },
  ): number {
    const guard =
      opts.source === 'metrika'
        ? `WHERE marketing_weekly.source = 'metrika'`
        : `WHERE marketing_weekly.source IN ('metrika', 'import')`;
    const stmt = this.db.prepare(
      `INSERT INTO marketing_weekly (week_start, metric_key, value, source, note, is_demo, updated_at, updated_by)
       VALUES (@week_start, @metric_key, @value, @source, @note, 0, @updated_at, @updated_by)
       ON CONFLICT(week_start, metric_key) DO UPDATE SET
         value = excluded.value,
         source = excluded.source,
         note = excluded.note,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by
         ${guard}`,
    );
    const write = this.db.transaction((batch: NewMarketingCell[]) => {
      let n = 0;
      for (const c of batch) {
        n += stmt.run({
          week_start: c.weekStart,
          metric_key: c.metricKey,
          value: c.value,
          source: opts.source,
          note: c.note ?? null,
          updated_at: opts.now(),
          updated_by: opts.updatedBy ?? null,
        }).changes;
      }
      return n;
    });
    return write(cells);
  }

  remove(weekStart: string, metricKey: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM marketing_weekly WHERE week_start = ? AND metric_key = ?')
        .run(weekStart, metricKey).changes > 0
    );
  }

  /** Aggregated source data for one campaign week — the weekly sync's input (ANA-73). */
  weekTotals(
    start: string,
    end: string,
  ): {
    channelRows: number;
    visits: number;
    goalReaches: number;
    b2cRows: number;
    b2bPaidRows: number;
    payments: number;
    b2bLeadRows: number;
  } {
    const scalar = (sql: string, ...params: string[]): number =>
      (this.db.prepare(sql).get(...params) as { v: number }).v;
    const inWeek = (col: 'date' | 'date_added' | 'date_paid') =>
      `WHERE ${col} >= ? AND ${col} <= ?`;
    const channelRows = scalar(
      'SELECT COUNT(*) AS v FROM channel_stats ' + inWeek('date'),
      start,
      end,
    );
    const b2cRows = scalar('SELECT COUNT(*) AS v FROM b2c_payments ' + inWeek('date'), start, end);
    const b2bPaidRows = scalar(
      'SELECT COUNT(*) AS v FROM b2b_manual ' + inWeek('date_paid'),
      start,
      end,
    );
    return {
      channelRows,
      visits: scalar(
        'SELECT COALESCE(SUM(visits), 0) AS v FROM channel_stats ' + inWeek('date'),
        start,
        end,
      ),
      goalReaches: scalar(
        'SELECT COALESCE(SUM(goal_reaches), 0) AS v FROM channel_stats ' + inWeek('date'),
        start,
        end,
      ),
      b2cRows,
      b2bPaidRows,
      payments:
        scalar(
          'SELECT COALESCE(SUM(tickets), 0) AS v FROM b2c_payments ' + inWeek('date'),
          start,
          end,
        ) +
        scalar(
          'SELECT COALESCE(SUM(tickets), 0) AS v FROM b2b_manual ' + inWeek('date_paid'),
          start,
          end,
        ),
      b2bLeadRows: scalar(
        'SELECT COUNT(*) AS v FROM b2b_manual ' + inWeek('date_added'),
        start,
        end,
      ),
    };
  }
}
