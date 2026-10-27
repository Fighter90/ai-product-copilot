import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { B2cPayment, NewB2cPayment } from '@pca/shared';
import type { B2cPaymentsRepo } from '../db/repositories/b2c-payments-repo';
import type { B2bRepo } from '../db/repositories/b2b-repo';
import { dataCoverage } from '../data/coverage';

export interface PaymentsRouteOptions {
  readonly b2c: B2cPaymentsRepo;
  readonly b2b: B2bRepo;
  /** ANA-72: the synced Metrika window (metrics.statsCoverage) for the coverage report. */
  readonly statsCoverage?: () => { from: string; to: string; days: number } | null;
  /** ISO timestamp source (injectable for deterministic tests). */
  readonly now?: () => string;
}

/** YYYY-MM-DD AND a real calendar day (2026-13-99 is well-shaped but not a day). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, 'date must be a real calendar day');

const PaymentBody = z.object({
  date: isoDate,
  tickets: z.number().int().min(0),
  amountRub: z.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

const ImportBody = z.object({ csv: z.string().max(1_000_000) });

/** Parse a payment-provider CSV: `date,tickets[,amount]` per line, header optional. */
export function parsePaymentsCsv(csv: string): {
  rows: NewB2cPayment[];
  errors: Array<{ line: number; message: string }>;
} {
  const rows: NewB2cPayment[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (line === '' || /^(date|дата)\s*([,;\t]|$)/i.test(line)) continue; // blank / header row
    const parts = line.split(/[,;\t]/).map((s) => s.trim());
    const [date, ticketsRaw, amountRaw] = parts;
    // Format AND calendar check (2026-13-99 is well-shaped but not a day).
    const calendarDay = new Date(`${date}T00:00:00Z`);
    const validDate =
      /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') &&
      !Number.isNaN(calendarDay.getTime()) &&
      calendarDay.toISOString().slice(0, 10) === date;
    if (!validDate) {
      errors.push({ line: i + 1, message: `bad date "${date ?? ''}" (YYYY-MM-DD expected)` });
      continue;
    }
    const tickets = Number(ticketsRaw);
    if (!Number.isInteger(tickets) || tickets < 0) {
      errors.push({ line: i + 1, message: `bad tickets "${ticketsRaw ?? ''}"` });
      continue;
    }
    const amountRub = amountRaw !== undefined && amountRaw !== '' ? Number(amountRaw) : undefined;
    if (amountRub !== undefined && !Number.isFinite(amountRub)) {
      errors.push({ line: i + 1, message: `bad amount "${amountRaw}"` });
      continue;
    }
    rows.push({ date, tickets, amountRub, note: 'CSV import' });
  }
  return { rows, errors };
}

/**
 * ANA-19: manual B2C payments — Metrika only sees orders, so paid B2C tickets are entered per day
 * (or imported from a payment-provider CSV) here. `GET /payments/summary` returns the KPI figures:
 * «Оплачено» = B2C paid + B2B paid.
 */
export async function paymentsRoutes(
  app: FastifyInstance,
  opts: PaymentsRouteOptions,
): Promise<void> {
  const now = opts.now ?? (() => new Date().toISOString());

  app.get(
    '/payments/b2c',
    { schema: { tags: ['payments'], summary: 'Manual B2C payments by day' } },
    async (req) => {
      const q = req.query as { from?: string; to?: string };
      const range = q.from && q.to ? { from: q.from, to: q.to } : undefined;
      return opts.b2c.list(range);
    },
  );

  app.put(
    '/payments/b2c',
    { schema: { tags: ['payments'], summary: 'Set the paid B2C tickets for one day' } },
    async (req, reply) => {
      const parsed = PaymentBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
      }
      const saved = opts.b2c.upsert(parsed.data as NewB2cPayment, {
        source: 'manual',
        now,
      });
      return reply.code(200).send(saved);
    },
  );

  app.delete(
    '/payments/b2c/:date',
    { schema: { tags: ['payments'], summary: 'Remove a manual payment day' } },
    async (req, reply) => {
      const removed = opts.b2c.remove((req.params as { date: string }).date);
      return removed ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
    },
  );

  app.post(
    '/payments/b2c/import',
    {
      schema: {
        tags: ['payments'],
        summary: 'Import paid B2C tickets from CSV (date,tickets[,amount])',
      },
    },
    async (req, reply) => {
      const parsed = ImportBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
      }
      const { rows, errors } = parsePaymentsCsv(parsed.data.csv);
      let imported = 0;
      for (const r of rows) {
        opts.b2c.upsert(r, { source: 'csv', now });
        imported++;
      }
      return reply.code(200).send({ imported, skipped: errors.length, errors });
    },
  );

  app.get(
    '/payments/summary',
    { schema: { tags: ['payments'], summary: '«Оплачено» = B2C paid + B2B paid (ANA-19)' } },
    async (req) => {
      const q = req.query as { from?: string; to?: string };
      const range = q.from && q.to ? { from: q.from, to: q.to } : undefined;
      const b2cPaid = opts.b2c.sumTickets(range);
      const b2bPaid = opts.b2b
        .list()
        .filter((d) => d.stage === 'paid' && d.datePaid)
        .filter((d) => (range ? d.datePaid!.slice(0, 10) >= range.from : true))
        .filter((d) => (range ? d.datePaid!.slice(0, 10) <= range.to : true))
        .reduce((acc, d) => acc + d.tickets, 0);
      const b2cDays: B2cPayment[] = opts.b2c.list(range);
      return { b2cPaid, b2bPaid, paid: b2cPaid + b2bPaid, days: b2cDays.length };
    },
  );

  // ANA-72: coverage + gap report — «от какого числа собираем?» and the «разрыв в 7 дней» the
  // customer saw. Shows the first/last day of every series and the holes that need a backfill.
  app.get(
    '/payments/coverage',
    {
      schema: {
        tags: ['payments'],
        summary: 'Data coverage & gaps (b2b, b2c payments, Metrika window)',
      },
    },
    async () => dataCoverage(opts.statsCoverage?.() ?? null, opts.b2b.list(), opts.b2c.list()),
  );
}
