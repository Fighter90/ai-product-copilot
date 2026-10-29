import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  isReportLocale,
  type AiGenerationInfo,
  type GeneratedHypotheses,
  type ReportLocale,
  type ReportSnapshot,
} from '@pca/shared';
import type { UsersRepo } from '../auth/users-repo';

const SnapshotBody = z.object({ from: z.string(), to: z.string() });
const GenerateBody = z.object({ snapshotId: z.string(), format: z.enum(['docx', 'pdf']) });

/** ANA-33: «Авто» (chain order) or a specific enabled provider for the AI report blocks. */
export const AI_PROVIDER_CHOICES = [
  'auto',
  'openrouter',
  'anthropic',
  'yandexgpt',
  'gigachat',
] as const;
export type AiProviderChoice = (typeof AI_PROVIDER_CHOICES)[number];
const AiProvider = z.enum(AI_PROVIDER_CHOICES);

const InsightsBody = z.object({ snapshotId: z.string(), providerId: AiProvider.optional() });
const HypothesesBody = z.object({ snapshotId: z.string(), providerId: AiProvider.optional() });

export type ReportFormat = z.infer<typeof GenerateBody>['format'];

export type InsightsResult =
  | { ok: true; narrative: string; generatedBy?: AiGenerationInfo }
  | {
      ok: false;
      // 'provider_error' = сбой выбранного провайдера (например, HTTP 402 — нет кредитов).
      reason: 'not_found' | 'unavailable' | 'provider_error';
      message: string;
    };

export type HypothesesResult =
  | { ok: true; hypotheses: GeneratedHypotheses }
  | {
      ok: false;
      reason: 'not_found' | 'unavailable' | 'provider_error';
      message: string;
    };

/** A generated report file ready to stream to the browser as a download. */
export interface ReportDownload {
  readonly body: Buffer;
  readonly filename: string;
  readonly contentType: string;
}

export interface ReportRunner {
  build: (opts: { from: string; to: string; by?: string | null }) => Promise<ReportSnapshot>;
  get: (id: string) => ReportSnapshot | undefined;
  list: () => Array<{
    id: string;
    generatedAt: string;
    dateFrom: string;
    dateTo: string;
    /** ANA-39: who built the snapshot (user email in cabinet mode, null otherwise). */
    author?: string | null;
  }>;
  generate: (snapshotId: string, format: ReportFormat) => Promise<{ filePath: string } | undefined>;
  /** Generate + persist the AI narrative for a snapshot (ANA-33: `providerId` pins a provider). */
  insights: (snapshotId: string, providerId?: AiProviderChoice) => Promise<InsightsResult>;
  /** Generate + persist the AI hypotheses for a snapshot (returns existing if already generated). */
  hypotheses: (snapshotId: string, providerId?: AiProviderChoice) => Promise<HypothesesResult>;
  /** Render a snapshot to DOCX/PDF bytes for download (undefined when the snapshot is missing).
   *  `locale` (ANA-42) selects the report language; Russian stays the default. */
  download: (
    snapshotId: string,
    format: ReportFormat,
    locale?: ReportLocale,
  ) => Promise<ReportDownload | undefined>;
  /** REG-10: delete a snapshot row by id (false when the id is unknown). Related report data
   *  is never touched. */
  remove: (id: string) => boolean;
}

export interface ReportRouteOptions {
  readonly runner: ReportRunner;
  /** REG-10: cabinet users repo — gates DELETE on the admin role and writes the audit entry.
   *  Absent in legacy single-user mode, where deletion is allowed without roles. */
  readonly users?: UsersRepo;
}

/** Build/fetch immutable report snapshots and generate report files. */
export async function reportRoutes(app: FastifyInstance, opts: ReportRouteOptions): Promise<void> {
  app.post('/report/snapshot', async (req, reply) => {
    const parsed = SnapshotBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    // ANA-39: remember who built the snapshot so History can filter by author.
    const author = (req.user as { email?: string } | undefined)?.email ?? null;
    const snapshot = await opts.runner.build({ ...parsed.data, by: author });
    return reply.code(201).send(snapshot);
  });

  app.get('/report/snapshot/:id', async (req, reply) => {
    const snap = opts.runner.get((req.params as { id: string }).id);
    return snap ?? reply.code(404).send({ error: 'not found' });
  });

  /** List all report snapshots (for the "History" page). */
  app.get('/report/snapshots', async () => opts.runner.list());

  /**
   * REG-10: delete a snapshot (History page, admin only; REG-11 reuses it for one-off cleanup).
   * /api/report sits outside the ADMIN_RULES prefixes, so the admin role is checked here.
   * Legacy single-user mode has no users repo and no roles — deletion is allowed there.
   */
  app.delete('/report/snapshots/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (opts.users && req.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden', code: 'ADMIN_ONLY' });
    }
    if (!opts.runner.remove(id)) return reply.code(404).send({ error: 'snapshot not found' });
    opts.users?.audit(req.user ?? null, 'report.snapshot_delete', id);
    return { ok: true };
  });

  app.post('/report/generate', async (req, reply) => {
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    const result = await opts.runner.generate(parsed.data.snapshotId, parsed.data.format);
    return result ?? reply.code(404).send({ error: 'snapshot not found' });
  });

  app.get('/report/download/:snapshotId/:format', async (req, reply) => {
    const params = z
      .object({ snapshotId: z.string(), format: z.enum(['docx', 'pdf']) })
      .safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid format' });
    // ANA-42: report language at export time (?lang=en), Russian stays the default.
    const rawLang = (req.query as { lang?: string } | undefined)?.lang;
    const locale: ReportLocale = isReportLocale(rawLang) ? rawLang : 'ru';
    const file = await opts.runner.download(params.data.snapshotId, params.data.format, locale);
    if (!file) return reply.code(404).send({ error: 'snapshot not found' });
    return reply
      .header('content-type', file.contentType)
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .send(file.body);
  });

  app.post('/report/insights', async (req, reply) => {
    const parsed = InsightsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    const result = await opts.runner.insights(parsed.data.snapshotId, parsed.data.providerId);
    if (result.ok) return { narrative: result.narrative, generatedBy: result.generatedBy };
    return reply.code(result.reason === 'not_found' ? 404 : 503).send({ error: result.message });
  });

  app.post('/report/hypotheses', async (req, reply) => {
    const parsed = HypothesesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    const result = await opts.runner.hypotheses(parsed.data.snapshotId, parsed.data.providerId);
    if (result.ok) return { hypotheses: result.hypotheses };
    return reply.code(result.reason === 'not_found' ? 404 : 503).send({ error: result.message });
  });
}
