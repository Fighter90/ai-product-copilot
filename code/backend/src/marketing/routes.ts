import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MarketingRepo } from '../db/repositories/marketing-repo';
import type { SyncRunner } from '../routes/sync';
import { recomputeWeekly, type MarketingSyncResult } from './sync';
import { buildStataSheetCells } from './sheet-data';
import {
  MARKETING_METRICS,
  MARKETING_MONTHS,
  MARKETING_SECTIONS,
  MARKETING_WEEKS,
} from './definitions';
import { csvCell } from '../integrations/datalens';

export interface MarketingRouteOptions {
  readonly repo: MarketingRepo;
  /** Full Metrika sync (wipes + reloads the window) — used to backfill missing past weeks. */
  readonly runSync?: SyncRunner;
  readonly now?: () => string;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, 'date must be a real calendar day');

const CellBody = z.object({
  weekStart: isoDate,
  metricKey: z.string().refine((k) => MARKETING_METRICS.some((m) => m.key === k), 'unknown metric'),
  value: z.number().finite().min(0),
  note: z.string().max(500).optional(),
});

const SyncBody = z
  .object({
    /** Optional Metrika backfill window (e.g. the pre-launch period) — admin sync quota. */
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((b) => (b.from && b.to) || (!b.from && !b.to), 'from and to must be passed together');

const userEmail = (req: { user?: { email?: string } }): string | undefined => req.user?.email;

/**
 * ANA-73: the weekly marketing grid — GET the sheet-shaped table, PUT a single cell by hand
 * (admin/analyst), POST a sync (admin: optional Metrika backfill of missing past weeks, then a
 * recompute of the syncable rows; manual and imported cells are never overwritten), and a CSV
 * export that mirrors the Google Sheet layout.
 */
export async function marketingRoutes(
  app: FastifyInstance,
  opts: MarketingRouteOptions,
): Promise<void> {
  const now = opts.now ?? (() => new Date().toISOString());

  app.get(
    '/marketing/weekly',
    { schema: { tags: ['marketing'], summary: 'Weekly marketing grid (sheet «стата» shape)' } },
    async (req) => {
      const q = req.query as { from?: string; to?: string };
      const cells = opts.repo.list(q.from && q.to ? { from: q.from, to: q.to } : undefined);
      return {
        months: MARKETING_MONTHS,
        weeks: MARKETING_WEEKS,
        sections: MARKETING_SECTIONS,
        metrics: MARKETING_METRICS,
        cells,
      };
    },
  );

  app.put(
    '/marketing/weekly',
    {
      schema: {
        tags: ['marketing'],
        summary: 'Enter/correct one cell by hand (analyst input wins)',
      },
    },
    async (req, reply) => {
      const parsed = CellBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
      }
      const saved = opts.repo.upsert(parsed.data, {
        source: 'manual',
        updatedBy: userEmail(req),
        now,
      });
      return reply.code(200).send(saved);
    },
  );

  app.delete(
    '/marketing/weekly/:weekStart/:metricKey',
    { schema: { tags: ['marketing'], summary: 'Clear one cell' } },
    async (req, reply) => {
      const { weekStart, metricKey } = req.params as { weekStart: string; metricKey: string };
      const removed = opts.repo.remove(weekStart, metricKey);
      return removed ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
    },
  );

  app.post(
    '/marketing/weekly/import-sheet',
    { schema: { tags: ['marketing'], summary: 'Import the real «стата» sheet cells (admin; source=import, manual untouched)' } },
    async (req, reply) => {
      const cells = buildStataSheetCells();
      const written = opts.repo.upsertMany(cells, {
        source: 'import',
        updatedBy: userEmail(req) ?? 'sheet-import',
        now,
      });
      return reply.code(200).send({ cells: cells.length, written });
    },
  );

  app.post(
    '/marketing/weekly/sync',
    {
      schema: {
        tags: ['marketing'],
        summary: 'Recompute syncable cells; optionally backfill the window from Metrika (admin)',
      },
    },
    async (req, reply) => {
      const parsed = SyncBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
      }
      // Optional Metrika pull first: without it the recompute can only see windows that a
      // previous sync already loaded (the sheet starts well before the first sync).
      let pulled: unknown;
      if (opts.runSync && parsed.data.from && parsed.data.to) {
        pulled = await opts.runSync({ from: parsed.data.from, to: parsed.data.to });
      }
      const result: MarketingSyncResult & { pulled?: unknown } = {
        ...recomputeWeekly(opts.repo, now),
        ...(pulled !== undefined ? { pulled } : {}),
      };
      return result;
    },
  );

  app.get(
    '/marketing/weekly.csv',
    { schema: { tags: ['marketing'], summary: 'CSV export in the sheet «стата» layout' } },
    async (_req, reply) => {
      const cells = opts.repo.list();
      const byKey = new Map(cells.map((c) => [`${c.weekStart}|${c.metricKey}`, c]));
      const header = [
        'Секция',
        'Метрика',
        ...MARKETING_WEEKS.map((w) => `${w.labelRu} (${w.start}..${w.end})`),
      ];
      const rows = MARKETING_SECTIONS.flatMap((s) =>
        MARKETING_METRICS.filter((m) => m.section === s.key).map((m) => [
          s.ru,
          m.ru,
          ...MARKETING_WEEKS.map((w) => {
            const c = byKey.get(`${w.key}|${m.key}`);
            return c ? String(c.value) : '';
          }),
        ]),
      );
      const csv = [header, ...rows].map((r) => r.map((v) => csvCell(v)).join(',')).join('\r\n');
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename=marketing-weekly.csv');
      return `\uFEFF${csv}`;
    },
  );
}
