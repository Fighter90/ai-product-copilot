import { randomUUID } from 'node:crypto';

/**
 * ANA-133: AI generation on a 1-CPU server degraded every concurrent HTTP request
 * (browser-regression saw 30s+ page.goto timeouts as soon as a report AI analysis started).
 * This queue moves the generation out of the HTTP request context: the route enqueues the
 * work, answers immediately with a `jobId`, and the client polls GET /report/ai-jobs/:jobId.
 *
 * Capacity is exactly ONE concurrent generation — the second caller gets «busy» (HTTP 429
 * with Retry-After) instead of queueing behind an unbounded wait. The deferral via
 * setImmediate guarantees the HTTP response is sent before any generation work begins.
 *
 * Jobs are in-memory only: a pca-api restart loses them and the poll answers 404 — the
 * client then reports the generation as honestly failed (the user retries), which is the
 * accepted trade-off vs. persisting job state for a minutes-long interactive call.
 */

export type AiJobKind = 'insights' | 'hypotheses';
export type AiJobStatus = 'running' | 'done' | 'failed';

/** Poll-facing view of one background AI job (JSON-serializable, no internals). */
export interface AiJobView {
  readonly id: string;
  readonly kind: AiJobKind;
  readonly status: AiJobStatus;
  /** Set when `status === 'done'` — whatever the enqueued runner returned. */
  readonly result?: unknown;
  /** Set when `status === 'failed'` — the extracted error message. */
  readonly error?: string;
}

interface JobEntry {
  readonly id: string;
  readonly kind: AiJobKind;
  status: AiJobStatus;
  result?: unknown;
  error?: string;
  /** `now()` timestamp of completion; running jobs never carry one and are never pruned. */
  finishedAt?: number;
}

export interface AiJobQueue {
  /**
   * Start a background job. Returns the jobId, or `null` when another generation already
   * holds the single slot — the caller answers HTTP 429 (Retry-After).
   */
  start: (kind: AiJobKind, run: () => Promise<unknown>) => string | null;
  /** Current view of a job, or undefined when unknown (never started / pruned / lost). */
  get: (id: string) => AiJobView | undefined;
}

export interface AiJobQueueOptions {
  /** Clock for the finished-job TTL; defaults to Date.now (injected in tests). */
  readonly now?: () => number;
  /** How long a finished job stays pollable. Default: 15 minutes. */
  readonly ttlMs?: number;
}

export const AI_JOB_TTL_MS = 15 * 60_000;

export function createAiJobQueue(opts: AiJobQueueOptions = {}): AiJobQueue {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? AI_JOB_TTL_MS;
  const jobs = new Map<string, JobEntry>();
  let running = false;

  /** Drop finished jobs past the TTL so the in-memory map cannot grow unbounded. */
  const prune = (): void => {
    const t = now();
    for (const [id, job] of jobs) {
      if (job.finishedAt !== undefined && t - job.finishedAt > ttlMs) jobs.delete(id);
    }
  };

  return {
    start: (kind, run) => {
      prune();
      // The single slot is the ANA-133 concurrency cap: one generation at a time.
      if (running) return null;
      running = true;
      const id = randomUUID();
      const entry: JobEntry = { id, kind, status: 'running' };
      jobs.set(id, entry);
      // ANA-133: step off the HTTP request context — the 202 response is sent first, and
      // interleaved event-loop turns keep concurrent page/API requests responsive.
      setImmediate(() => {
        void run()
          .then((result) => {
            entry.status = 'done';
            entry.result = result;
          })
          .catch((err: unknown) => {
            entry.status = 'failed';
            entry.error = err instanceof Error ? err.message : String(err);
          })
          .finally(() => {
            entry.finishedAt = now();
            running = false;
          });
      });
      return id;
    },
    get: (id) => {
      prune();
      const job = jobs.get(id);
      if (!job) return undefined;
      const view: AiJobView = {
        id: job.id,
        kind: job.kind,
        status: job.status,
        ...(job.status === 'done' ? { result: job.result } : {}),
        ...(job.status === 'failed' ? { error: job.error } : {}),
      };
      return view;
    },
  };
}

/**
 * The production shared instance: the report routes (user-triggered jobs) and the snapshot
 * build's fire-and-forget auto-generation both take their slot here, so «one concurrent AI
 * generation» holds across all entry points (tests inject their own fresh queue instead).
 */
export const reportAiJobs = createAiJobQueue();
