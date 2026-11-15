import { randomUUID } from 'node:crypto';
import { config } from '../config';

/**
 * ANA-133: AI generation on a 1-CPU server degraded every concurrent HTTP request
 * (browser-regression saw 30s+ page.goto timeouts as soon as a report AI analysis started).
 * This queue moves the generation out of the HTTP request context: the route enqueues the
 * work, answers immediately with a `jobId`, and the client polls GET /report/ai-jobs/:jobId.
 *
 * Capacity is exactly ONE concurrent generation — the second caller gets «busy» (HTTP 429
 * with Retry-After) instead of queueing behind an unbounded wait. The deferral via
 * setImmediate guarantees the HTTP response is sent before any generation work begins.
 * Honest caveat (ANA-155): the watchdog frees the slot of a hung holder WITHOUT aborting
 * its in-flight provider request, so until the zombie settles a promoted successor can
 * run concurrently with it — the cap is strict for healthy runs and best-effort during a
 * watchdog takeover.
 *
 * Jobs are in-memory only: a pca-api restart loses them and the poll answers 404 — the
 * client then reports the generation as honestly failed (the user retries), which is the
 * accepted trade-off vs. persisting job state for a minutes-long interactive call.
 *
 * ANA-155 (bug: «429 Другая генерация выполняется» until a server restart):
 * 1. Watchdog — a job holding the slot longer than `maxRunMs` is marked failed («превышен
 *    таймаут») and the slot is freed; a run that settles later can neither resurrect the
 *    entry nor release the slot under its successor.
 * 2. Auto fallback — a user request with `queueIfBusy` (the routes set it for the «Авто»
 *    choice only) parks as a `pending` job (depth 1) and is promoted automatically when the
 *    slot frees; the promotion context tells the runner whether the previous holder was
 *    watchdog-killed (and its provider), so the Auto chain can skip the hung provider.
 *    Known limitation: the queue only knows the REQUESTED provider choice, not the actual
 *    chain winner — a holder requested as «auto» yields `previousProvider: 'auto'`, which
 *    the routes cannot skip, so the promoted job retries the full chain. The provider-skip
 *    therefore only works for holders pinned to a concrete provider; wiring the sniffed
 *    winner (ANA-33 `AiCallInfo`) into the takeover context is a follow-up.
 * 3. `current()` — the holder's provider/kind/startedAt/expected release for the enriched
 *    429 body and the poll views.
 */

export type AiJobKind = 'insights' | 'hypotheses';
export type AiJobStatus = 'pending' | 'running' | 'done' | 'failed';

/** Poll-facing view of one background AI job (JSON-serializable, no internals). */
export interface AiJobView {
  readonly id: string;
  readonly kind: AiJobKind;
  readonly status: AiJobStatus;
  /** ANA-155: requested provider choice («auto» or a pinned provider id) of this job. */
  readonly provider?: string;
  /** ANA-155: ISO time the job actually took the slot (absent while pending). */
  readonly startedAt?: string;
  /** Set when `status === 'done'` — whatever the enqueued runner returned. */
  readonly result?: unknown;
  /** Set when `status === 'failed'` — the extracted error message. */
  readonly error?: string;
}

/**
 * ANA-155: handed to a promoted run. `previousTimedOut` distinguishes a watchdog takeover
 * (the previous holder hung and was killed) from a normal completion — the routes use it to
 * skip the hung provider in the Auto fallback chain. Limitation: `previousProvider` is the
 * holder's REQUESTED choice — for an «auto» holder the routes cannot skip anything and the
 * promoted job retries the whole chain (the actual chain winner is not recorded here).
 */
export interface AiJobRunContext {
  readonly previousTimedOut: boolean;
  readonly previousProvider?: string;
}

export type AiJobRun = (ctx?: AiJobRunContext) => Promise<unknown>;

export interface AiJobStartMeta {
  /** Requested provider choice, reported in views and the 429 body ('auto' by default). */
  readonly provider?: string;
  /** ANA-155: park instead of returning null when the slot is busy (the Auto fallback). */
  readonly queueIfBusy?: boolean;
}

/** ANA-155: who holds the slot right now — the enriched 429 payload's source of truth. */
export interface AiCurrentJob {
  readonly kind: AiJobKind;
  readonly provider?: string;
  /** `now()` ms when the holder took the slot. */
  readonly startedAt: number;
  /** `now()` ms when the watchdog would free the slot (startedAt + maxRunMs). */
  readonly expectedReleaseAt: number;
}

interface JobEntry {
  readonly id: string;
  readonly kind: AiJobKind;
  status: AiJobStatus;
  result?: unknown;
  error?: string;
  provider?: string;
  /** `now()` ms when the job took the slot; pending jobs don't have one. */
  startedAt?: number;
  /** `now()` timestamp of completion; running jobs never carry one and are never pruned. */
  finishedAt?: number;
  /** ANA-155: set when the watchdog killed the job (drives the Auto provider skip). */
  timedOut?: boolean;
  /** Parked run, kept until the slot frees (ANA-155 depth-1 queue). */
  run?: AiJobRun;
  timer?: ReturnType<typeof setTimeout>;
}

export interface AiJobQueue {
  /**
   * Start a background job. Returns the jobId, or `null` when another generation already
   * holds the single slot AND the request may not park (`queueIfBusy` off, or the depth-1
   * park is taken) — the caller answers HTTP 429 (Retry-After). A parked request returns
   * its own jobId with the entry visible as `pending` until the slot frees.
   */
  start: (kind: AiJobKind, run: AiJobRun, meta?: AiJobStartMeta) => string | null;
  /** Current view of a job, or undefined when unknown (never started / pruned / lost). */
  get: (id: string) => AiJobView | undefined;
  /** ANA-155: the job that holds the slot right now, or null when the slot is free. */
  current: () => AiCurrentJob | null;
}

export interface AiJobQueueOptions {
  /** Clock for the finished-job TTL; defaults to Date.now (injected in tests). */
  readonly now?: () => number;
  /** How long a finished job stays pollable. Default: 15 minutes. */
  readonly ttlMs?: number;
  /**
   * ANA-155: watchdog budget for one running job. A generation that exceeds it is marked
   * failed («превышен таймаут») and the slot is freed. Default: 15 minutes (env
   * AI_JOB_MAX_RUN_MS) — above the provider-level timeouts (≤240 s) plus the ANA-156
   * follow-up, so only a truly hung run is killed.
   */
  readonly maxRunMs?: number;
}

export const AI_JOB_TTL_MS = 15 * 60_000;
export const AI_JOB_MAX_RUN_MS = 15 * 60_000;

export function createAiJobQueue(opts: AiJobQueueOptions = {}): AiJobQueue {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? AI_JOB_TTL_MS;
  const maxRunMs = opts.maxRunMs ?? AI_JOB_MAX_RUN_MS;
  const jobs = new Map<string, JobEntry>();
  let running = false;
  /** ANA-155: id of the entry that owns the slot — guards releases against zombie runs. */
  let ownerId: string | null = null;
  let parked: JobEntry | null = null;

  /** Drop finished jobs past the TTL so the in-memory map cannot grow unbounded. */
  const prune = (): void => {
    const t = now();
    for (const [id, job] of jobs) {
      if (job.finishedAt !== undefined && t - job.finishedAt > ttlMs) jobs.delete(id);
    }
  };

  const releaseIfOwner = (entry: JobEntry): void => {
    if (ownerId !== entry.id) return; // a zombie settled after the watchdog — nothing to do
    ownerId = null;
    running = false;
    // ANA-155: promote the parked Auto request, telling it why the slot freed.
    const next = parked;
    parked = null;
    if (next?.run)
      launch(next, {
        previousTimedOut: entry.timedOut === true,
        ...(entry.provider !== undefined ? { previousProvider: entry.provider } : {}),
      });
  };

  /** Mark a watchdog-dead entry failed. Runs on the timer, before any late settlement. */
  const takeOver = (entry: JobEntry): void => {
    if (entry.status !== 'running' || ownerId !== entry.id) return;
    const minutes = Math.max(1, Math.round(maxRunMs / 60_000));
    entry.status = 'failed';
    entry.error = `AI-генерация прервана: превышен таймаут (${minutes} мин) — слот освобождён, попробуйте ещё раз.`;
    entry.timedOut = true;
    entry.finishedAt = now();
    releaseIfOwner(entry);
  };

  const launch = (entry: JobEntry, ctx?: AiJobRunContext): void => {
    running = true;
    ownerId = entry.id;
    entry.status = 'running';
    entry.startedAt = now();
    const timer = setTimeout(() => takeOver(entry), maxRunMs);
    timer.unref();
    entry.timer = timer;
    const run = entry.run;
    entry.run = undefined;
    // ANA-133: step off the HTTP request context — the 202 response is sent first, and
    // interleaved event-loop turns keep concurrent page/API requests responsive.
    setImmediate(() => {
      void (run ?? (async () => undefined))(ctx)
        .then((result) => {
          if (entry.status !== 'running') return; // watchdog already closed the job
          entry.status = 'done';
          entry.result = result;
          entry.finishedAt = now();
        })
        .catch((err: unknown) => {
          if (entry.status !== 'running') return; // watchdog already closed the job
          entry.status = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
          entry.finishedAt = now();
        })
        .finally(() => {
          if (entry.timer) clearTimeout(entry.timer);
          releaseIfOwner(entry);
        });
    });
  };

  return {
    start: (kind, run, meta = {}) => {
      prune();
      // The single slot is the ANA-133 concurrency cap: one generation at a time.
      if (running) {
        // ANA-155: the Auto fallback parks (depth 1) instead of failing with 429.
        if (meta.queueIfBusy && !parked) {
          const id = randomUUID();
          const entry: JobEntry = {
            id,
            kind,
            status: 'pending',
            run,
            ...(meta.provider !== undefined ? { provider: meta.provider } : {}),
          };
          jobs.set(id, entry);
          parked = entry;
          return id;
        }
        return null;
      }
      const id = randomUUID();
      const entry: JobEntry = {
        id,
        kind,
        status: 'pending',
        run,
        ...(meta.provider !== undefined ? { provider: meta.provider } : {}),
      };
      jobs.set(id, entry);
      launch(entry);
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
        ...(job.provider !== undefined ? { provider: job.provider } : {}),
        ...(job.startedAt !== undefined
          ? { startedAt: new Date(job.startedAt).toISOString() }
          : {}),
        ...(job.status === 'done' ? { result: job.result } : {}),
        ...(job.status === 'failed' ? { error: job.error } : {}),
      };
      return view;
    },
    current: () => {
      const owner = ownerId === null ? undefined : jobs.get(ownerId);
      if (!owner || owner.status !== 'running' || owner.startedAt === undefined) return null;
      return {
        kind: owner.kind,
        ...(owner.provider !== undefined ? { provider: owner.provider } : {}),
        startedAt: owner.startedAt,
        expectedReleaseAt: owner.startedAt + maxRunMs,
      };
    },
  };
}

/**
 * The production shared instance: the report routes (user-triggered jobs) and the snapshot
 * build's fire-and-forget auto-generation both take their slot here, so «one concurrent AI
 * generation» holds across all entry points (tests inject their own fresh queue instead).
 * ANA-155: the watchdog budget is env-tunable (AI_JOB_MAX_RUN_MS, default 15 min).
 */
export const reportAiJobs = createAiJobQueue({ maxRunMs: config.AI_JOB_MAX_RUN_MS });
