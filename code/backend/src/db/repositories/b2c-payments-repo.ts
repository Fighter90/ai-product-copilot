import type { DB } from '../connection';
import type { B2cPayment, NewB2cPayment } from '@pca/shared';

interface PaymentRow {
  date: string;
  tickets: number;
  amount_rub: number | null;
  source: B2cPayment['source'];
  note: string | null;
  is_demo: number;
  updated_at: string;
  updated_by: string | null;
}

function toPayment(r: PaymentRow): B2cPayment {
  return {
    date: r.date,
    tickets: r.tickets,
    amountRub: r.amount_rub ?? undefined,
    source: r.source,
    note: r.note ?? undefined,
    isDemo: r.is_demo ? true : undefined,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by ?? undefined,
  };
}

/**
 * Manual B2C payments (ANA-19): paid tickets per ISO day, entered by an admin/analyst or imported
 * from a payment-provider CSV. Metrika only sees orders — these rows ARE the confirmed money.
 */
export class B2cPaymentsRepo {
  constructor(private readonly db: DB) {}

  /** Insert or replace the row for one day (one row per date, natural key). */
  upsert(
    input: NewB2cPayment,
    opts: { source: B2cPayment['source']; isDemo?: boolean; updatedBy?: string; now: () => string },
  ): B2cPayment {
    const row = this.db
      .prepare(
        `INSERT INTO b2c_payments (date, tickets, amount_rub, source, note, is_demo, updated_at, updated_by)
         VALUES (@date, @tickets, @amount_rub, @source, @note, @is_demo, @updated_at, @updated_by)
         ON CONFLICT(date) DO UPDATE SET
           tickets = excluded.tickets,
           amount_rub = excluded.amount_rub,
           source = excluded.source,
           note = excluded.note,
           is_demo = excluded.is_demo,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by
         RETURNING *`,
      )
      .get({
        date: input.date,
        tickets: input.tickets,
        amount_rub: input.amountRub ?? null,
        source: opts.source,
        note: input.note ?? null,
        is_demo: opts.isDemo ? 1 : 0,
        updated_at: opts.now(),
        updated_by: opts.updatedBy ?? null,
      }) as PaymentRow;
    return toPayment(row);
  }

  list(range?: { from: string; to: string }): B2cPayment[] {
    const rows = range
      ? (this.db
          .prepare('SELECT * FROM b2c_payments WHERE date >= ? AND date <= ? ORDER BY date')
          .all(range.from, range.to) as PaymentRow[])
      : (this.db.prepare('SELECT * FROM b2c_payments ORDER BY date').all() as PaymentRow[]);
    return rows.map(toPayment);
  }

  remove(date: string): boolean {
    return this.db.prepare('DELETE FROM b2c_payments WHERE date = ?').run(date).changes > 0;
  }

  /** Sum of paid tickets in the range (the KPI «Оплачено B2C» figure). */
  sumTickets(range?: { from: string; to: string }): number {
    const row = range
      ? (this.db
          .prepare(
            'SELECT COALESCE(SUM(tickets), 0) AS s FROM b2c_payments WHERE date >= ? AND date <= ?',
          )
          .get(range.from, range.to) as { s: number })
      : (this.db.prepare('SELECT COALESCE(SUM(tickets), 0) AS s FROM b2c_payments').get() as {
          s: number;
        });
    return row.s;
  }

  /** ANA-18: demo-seeded payment rows count (drives the demo banner). */
  demoCount(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM b2c_payments WHERE is_demo = 1').get() as {
      n: number;
    };
    return r.n;
  }

  /** ANA-18: remove demo-seeded payment rows (part of the post-sync demo wipe). */
  deleteDemoRows(): void {
    this.db.prepare('DELETE FROM b2c_payments WHERE is_demo = 1').run();
  }
}
