import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NewB2bDeal } from '@pca/shared';
import type { B2bRepo } from '../db/repositories/b2b-repo';

export interface B2bRouteOptions {
  readonly repo: B2bRepo;
}

const StageBody = z.object({
  stage: z.enum(['lead', 'negotiation', 'invoiced', 'paid']).optional(),
  datePaid: z.string().optional(),
  // ANA-50: сумма сделки в ₽ — editable after creation (null clears it).
  amountRub: z.number().min(0).nullable().optional(),
});

/**
 * Parse a historical B2B-deals CSV (ANA-72 backfill):
 * `company,tickets,stage,date_added[,date_paid[,amount_rub[,contact_email[,notes]]]]` per line.
 * Header optional. Quoted fields with commas inside are supported.
 */
export function parseB2bCsv(csv: string): {
  rows: NewB2bDeal[];
  errors: Array<{ line: number; message: string }>;
} {
  const rows: NewB2bDeal[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  const stages = new Set(['lead', 'negotiation', 'invoiced', 'paid']);
  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (line === '' || /^company\b/i.test(line)) continue; // blank / header row
    // CSV split that keeps "quoted" fields (commas inside company names/notes).
    const parts = [...line.matchAll(/("([^"]|"")*"|[^,;\t]*)([,;\t]|$)/g)]
      .map((m) =>
        (m[1] ?? '').replace(/^"([\s\S]*)"$/, (_, inner: string) => inner.replace(/""/g, '"')),
      )
      .slice(0, -1);
    const [company, ticketsRaw, stageRaw, dateAdded, datePaid, amountRaw, email, notes] = parts;
    if (!company?.trim()) {
      errors.push({ line: i + 1, message: 'missing company' });
      continue;
    }
    const tickets = Number(ticketsRaw);
    if (!Number.isInteger(tickets) || tickets <= 0) {
      errors.push({ line: i + 1, message: `bad tickets "${ticketsRaw ?? ''}"` });
      continue;
    }
    const calendarDay = (d?: string): d is string =>
      !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
    if (!calendarDay(dateAdded)) {
      errors.push({ line: i + 1, message: `bad date_added "${dateAdded ?? ''}" (YYYY-MM-DD)` });
      continue;
    }
    const stage = (stageRaw ?? '').trim().toLowerCase();
    if (!stages.has(stage)) {
      errors.push({
        line: i + 1,
        message: `bad stage "${stageRaw ?? ''}" (lead|negotiation|invoiced|paid)`,
      });
      continue;
    }
    const amountRub = amountRaw !== undefined && amountRaw !== '' ? Number(amountRaw) : undefined;
    if (amountRub !== undefined && !Number.isFinite(amountRub)) {
      errors.push({ line: i + 1, message: `bad amount "${amountRaw}"` });
      continue;
    }
    rows.push({
      company: company.trim(),
      tickets,
      stage: stage as NewB2bDeal['stage'],
      dateAdded,
      datePaid: calendarDay(datePaid) ? datePaid : undefined,
      amountRub,
      contactEmail: email?.trim() || undefined,
      notes: notes?.trim() || undefined,
    });
  }
  return { rows, errors };
}

/** Manual B2B pipeline CRUD. */
export async function b2bRoutes(app: FastifyInstance, opts: B2bRouteOptions): Promise<void> {
  app.get('/b2b', { schema: { tags: ['b2b'] } }, async () => opts.repo.list());

  app.post('/b2b', { schema: { tags: ['b2b'] } }, async (req, reply) =>
    reply.code(201).send(opts.repo.create(req.body as NewB2bDeal)),
  );

  // ANA-72: bulk backfill of the historical deals (pre-launch leads live in the customer's
  // sheet/CRM, not in Metrika). Exact duplicates (company+dateAdded+tickets) are skipped so
  // re-importing the same file is safe.
  app.post(
    '/b2b/import',
    { schema: { tags: ['b2b'], summary: 'Import historical B2B deals from CSV' } },
    async (req, reply) => {
      const body = req.body as { csv?: string } | undefined;
      if (!body?.csv || typeof body.csv !== 'string' || body.csv.length > 1_000_000) {
        return reply.code(400).send({ error: 'invalid body: csv expected' });
      }
      const { rows, errors } = parseB2bCsv(body.csv);
      const seen = new Set(opts.repo.list().map((d) => `${d.company}|${d.dateAdded}|${d.tickets}`));
      let imported = 0;
      let skipped = 0;
      for (const row of rows) {
        const key = `${row.company}|${row.dateAdded}|${row.tickets}`;
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        opts.repo.create(row);
        imported++;
      }
      return { imported, skipped, errors };
    },
  );

  app.patch('/b2b/:id', { schema: { tags: ['b2b'] } }, async (req, reply) => {
    const parsed = StageBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid stage' });
    if (parsed.data.stage === undefined && parsed.data.amountRub === undefined) {
      return reply.code(400).send({ error: 'nothing to update' });
    }
    const id = Number((req.params as { id: string }).id);
    // Stage first (it owns date_paid), then the amount — both optional, one round-trip.
    let updated =
      parsed.data.stage === undefined
        ? opts.repo.getById(id)
        : opts.repo.updateStage(id, parsed.data.stage, parsed.data.datePaid);
    if (updated && parsed.data.amountRub !== undefined) {
      updated = opts.repo.updateAmount(id, parsed.data.amountRub);
    }
    return updated ?? reply.code(404).send({ error: 'not found' });
  });

  app.delete('/b2b/:id', { schema: { tags: ['b2b'] } }, async (req, reply) => {
    const removed = opts.repo.remove(Number((req.params as { id: string }).id));
    return removed ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });
}
