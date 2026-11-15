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
import { reportAiJobs, type AiJobQueue } from '../report/ai-job-queue';
import { logger } from '../utils/logger';

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
  /** Generate + persist the AI narrative for a snapshot (ANA-33: `providerId` pins a provider).
   *  ANA-155: `excludeProvider` skips one provider in the Auto chain — the queued job runs it
   *  after a watchdog takeover, so the provider whose generation hung is not retried. */
  insights: (
    snapshotId: string,
    providerId?: AiProviderChoice,
    opts?: { excludeProvider?: string },
  ) => Promise<InsightsResult>;
  /** Generate + persist the AI hypotheses for a snapshot (returns existing if already generated).
   *  ANA-155: `excludeProvider` — see insights. */
  hypotheses: (
    snapshotId: string,
    providerId?: AiProviderChoice,
    opts?: { excludeProvider?: string },
  ) => Promise<HypothesesResult>;
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
  /** ANA-133: single-slot background AI queue. Absent → the shared production instance;
   *  tests pass a fresh one to stay isolated. */
  readonly aiJobs?: AiJobQueue;
}

/**
 * ANA-133: how long a throttled client should wait before retrying a busy AI endpoint.
 * The value is mirrored in the Retry-After header of the 429 responses.
 */
const AI_BUSY_RETRY_AFTER_SECONDS = 30;
const AI_BUSY_MESSAGE =
  'AI-генерация уже выполняется — дождитесь её завершения и попробуйте снова.';

/**
 * ANA-155: the enriched 429 payload — WHO holds the slot, since when and when the watchdog
 * would free it. The pinned provider's concrete model is only known after the provider
 * answers, so the honest identifier here is the requested choice («auto» or a provider id).
 */
function busyBody(aiJobs: AiJobQueue): {
  error: string;
  code: 'AI_BUSY';
  job?: { kind: string; provider: string; startedAt: string; expectedReleaseAt: string };
} {
  const holder = aiJobs.current();
  return {
    error: AI_BUSY_MESSAGE,
    code: 'AI_BUSY',
    ...(holder
      ? {
          job: {
            kind: holder.kind,
            provider: holder.provider ?? 'auto',
            startedAt: new Date(holder.startedAt).toISOString(),
            expectedReleaseAt: new Date(holder.expectedReleaseAt).toISOString(),
          },
        }
      : {}),
  };
}

/**
 * ANA-155: the queued Auto job skips the provider whose generation was watchdog-killed —
 * retrying a provider that just hung would likely hang again; the chain falls through to
 * the next usable one. A normal completion implies the provider is healthy → no skip.
 * Limitation: the queue records the REQUESTED provider choice, not the actual chain
 * winner — the skip works only for holders pinned to a concrete provider; an «auto»
 * holder (`previousProvider === 'auto'`) retries the full chain (follow-up: wire the
 * ANA-33 sniffed winner into the takeover context).
 */
function skipOpts(
  ctx: { previousTimedOut: boolean; previousProvider?: string } | undefined,
): { excludeProvider: string } | undefined {
  if (!ctx?.previousTimedOut) return undefined;
  const provider = ctx.previousProvider;
  return provider && provider !== 'auto' ? { excludeProvider: provider } : undefined;
}

/** Build/fetch immutable report snapshots and generate report files. */
export async function reportRoutes(app: FastifyInstance, opts: ReportRouteOptions): Promise<void> {
  const aiJobs = opts.aiJobs ?? reportAiJobs;
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

  /**
   * ANA-133: AI narrative generation moved out of the HTTP request context into the
   * single-slot background queue. The handler validates, rejects a missing snapshot
   * synchronously (404, unchanged contract) and answers 202 {jobId}; the client polls
   * GET /report/ai-jobs/:jobId. While a generation holds the slot → 429 + Retry-After.
   */
  app.post('/report/insights', async (req, reply) => {
    const parsed = InsightsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    if (!opts.runner.get(parsed.data.snapshotId)) {
      return reply.code(404).send({ error: 'snapshot not found' });
    }
    const jobId = aiJobs.start(
      'insights',
      async (ctx) => {
        // ANA-155: a queued Auto job that got the slot after a watchdog takeover skips the
        // provider whose generation hung (see skipOpts) — the chain falls to the next one.
        const skip = skipOpts(ctx);
        const result = await opts.runner.insights(
          parsed.data.snapshotId,
          parsed.data.providerId,
          skip,
        );
        // A runner failure («no key», provider error) fails the job with its message instead
        // of the old synchronous 503 — the poll reports it as {status:'failed', error}.
        if (!result.ok) throw new Error(result.message);
        // ANA-156: the analysis must leave AI drafts in the backlog (ANA-128) — «после AI-анализа
        // 0 гипотез с source=ai» on prod had this contract gap: only the browser's fire-and-forget
        // (БАГ-21) drove POST /report/hypotheses, so a pure-API analysis (the admin checklist) or
        // a closed tab silently skipped auto-population. Run the runner right here, in the same
        // job and slot: it returns the already-generated hypotheses without regenerating (ANA-128
        // backfill) and dedupes drafts by content hash. Best-effort (ANA-128: auto-population
        // must never break the report) — a failure here keeps the narrative job done, the
        // browser follow-up stays as a second chance, and the miss is observable in the log.
        try {
          await opts.runner.hypotheses(parsed.data.snapshotId, parsed.data.providerId, skip);
        } catch (err) {
          logger.warn(
            { err, snapshotId: parsed.data.snapshotId },
            'ai-autopopulate after insights failed — narrative kept, backlog left without AI drafts',
          );
        }
        return { narrative: result.narrative, generatedBy: result.generatedBy };
      },
      // ANA-155: the «Авто» choice falls back instead of failing — the request parks (depth 1)
      // and runs when the slot frees. A pinned provider keeps the immediate 429 + Retry-After.
      {
        provider: parsed.data.providerId ?? 'auto',
        queueIfBusy: !parsed.data.providerId || parsed.data.providerId === 'auto',
      },
    );
    if (jobId === null) {
      return reply
        .code(429)
        .header('retry-after', String(AI_BUSY_RETRY_AFTER_SECONDS))
        .send(busyBody(aiJobs));
    }
    return reply.code(202).send({ jobId });
  });

  /** ANA-133: poll a background AI job (result payload / failure message / 404 when lost). */
  app.get('/report/ai-jobs/:jobId', async (req, reply) => {
    const jobId = (req.params as { jobId: string }).jobId;
    const job = aiJobs.get(jobId);
    return job ?? reply.code(404).send({ error: 'job not found' });
  });

  /**
   * ANA-133: hypotheses generation uses the same background queue as insights (one shared
   * slot — the CPU cap covers every AI entry point). Missing snapshot → sync 404.
   */
  app.post('/report/hypotheses', async (req, reply) => {
    const parsed = HypothesesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    if (!opts.runner.get(parsed.data.snapshotId)) {
      return reply.code(404).send({ error: 'snapshot not found' });
    }
    const jobId = aiJobs.start(
      'hypotheses',
      async (ctx) => {
        // ANA-155: same watchdog-takeover provider skip as the insights job.
        const result = await opts.runner.hypotheses(
          parsed.data.snapshotId,
          parsed.data.providerId,
          skipOpts(ctx),
        );
        if (!result.ok) throw new Error(result.message);
        return { hypotheses: result.hypotheses };
      },
      {
        provider: parsed.data.providerId ?? 'auto',
        queueIfBusy: !parsed.data.providerId || parsed.data.providerId === 'auto',
      },
    );
    if (jobId === null) {
      return reply
        .code(429)
        .header('retry-after', String(AI_BUSY_RETRY_AFTER_SECONDS))
        .send(busyBody(aiJobs));
    }
    return reply.code(202).send({ jobId });
  });
}
