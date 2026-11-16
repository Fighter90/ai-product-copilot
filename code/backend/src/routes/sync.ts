import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SyncRunStatus, SyncStepError } from '@pca/shared';
import type { SyncSummary } from '../metrika/sync-service';
import { contiguousRanges, dayChunks, isIsoDay, type DateChunk } from '../utils/date-range';

const SyncBody = z.object({
  from: z.string(),
  to: z.string(),
  goalId: z.number().int().optional(),
  /**
   * ANA-153: bypass zero-protection — overwrite the restored non-zero history with whatever
   * Metrika returns (even zeros). Admin-explicit only: an ordinary re-sync never zeroes the
   * stored history after the counter reset.
   */
  force: z.boolean().optional(),
});

/** ANA-139: same body as /sync — the refill endpoint pulls exactly the missing days instead. */
const SyncGapsBody = z.object({
  // Round-3 review: a garbage date iterates zero hole days and no-ops with 200 — validate
  // the window before the holes source (unlike /sync, whose runner reports a bad window).
  from: z.string().refine(isIsoDay, 'date must be YYYY-MM-DD'),
  to: z.string().refine(isIsoDay, 'date must be YYYY-MM-DD'),
  force: z.boolean().optional(),
});

/**
 * ANA-139: how many separate hole windows the refill may pull individually before it falls back
 * to ONE whole-window sync — many scattered 1-day holes cost more Metrika calls (pages/exit stay
 * per-day loops) than a single range pass over the whole period.
 */
export const MAX_GAP_RANGES = 16;

/** ANA-139: what POST /api/sync/gaps did — the echoed hole report plus each refill run. */
export interface SyncGapsResult {
  readonly from: string;
  readonly to: string;
  readonly gaps: Record<string, DateChunk[]>;
  readonly synced: Array<{ from: string; to: string; summary: SyncSummary }>;
}

export type SyncRunner = (body: z.infer<typeof SyncBody>) => Promise<SyncSummary>;

/** Final status of a recorded run (partial = some optional steps failed, see SyncSummary.errors). */
export type SyncRunOutcome = 'ok' | 'partial' | 'failed';

/**
 * REG-05: one source of truth for the recorded outcome — «partial» when any optional step failed
 * (`summary.errors`), «ok» otherwise. Used by the route and the CLI sync (`pnpm sync`) so both
 * record the same status for the same summary.
 */
export const outcomeOf = (summary: SyncSummary): SyncRunOutcome =>
  (summary.errors ?? []).length > 0 ? 'partial' : 'ok';

/**
 * ANA-15: persistence boundary for sync runs (implemented by SyncRunRepo). The route records the
 * outcome around the runner call so the admin UI can show the last result and its step errors.
 */
export interface SyncRunRecorder {
  start(from: string, to: string): number;
  finish(
    id: number,
    status: SyncRunOutcome,
    summary?: Record<string, unknown>,
    errors?: SyncStepError[],
  ): void;
  latest(): SyncRunStatus | undefined;
}

/**
 * Apply the runtime GOAL_ID setting: an explicit positive `goalId` in the request wins, else the
 * admin-pinned goal (read per call, so a settings change applies without a restart). 0 / empty /
 * invalid means "auto-detect" — `goalId` is then omitted and the sync picks the KPI goal itself.
 */
export function withDefaultGoal(run: SyncRunner, pinnedGoalId: () => number): SyncRunner {
  const valid = (n: number | undefined): n is number => Number.isInteger(n) && (n as number) > 0;
  return ({ from, to, goalId, force }) => {
    const pinned = pinnedGoalId();
    const resolved = valid(goalId) ? goalId : valid(pinned) ? pinned : undefined;
    const body = resolved === undefined ? { from, to } : { from, to, goalId: resolved };
    // ANA-153: force is admin-explicit — pass it through only when actually requested, so the
    // runner never sees a stray `force: false` where a plain body is expected.
    return run(force === true ? { ...body, force: true } : body);
  };
}

export interface SyncRouteOptions {
  readonly runSync: SyncRunner;
  /** ANA-15: when present, every run is recorded and readable via GET /sync/status. */
  readonly recordRun?: SyncRunRecorder;
  /**
   * ANA-139: per-table missing-day ranges (MetricsRepo.statsCoverageGaps) — the refill endpoint's
   * source. Absent in legacy test wirings: POST /api/sync/gaps answers 503 there.
   */
  readonly coverageGaps?: (from: string, to: string) => Record<string, DateChunk[]>;
}

/** `POST /api/sync` — pull Metrika data into SQLite for the given period. */
export async function syncRoutes(app: FastifyInstance, opts: SyncRouteOptions): Promise<void> {
  app.post('/sync', async (req, reply) => {
    const parsed = SyncBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    }
    const { from, to } = parsed.data;
    const runId = opts.recordRun?.start(from, to) ?? -1;
    try {
      const summary = await opts.runSync(parsed.data);
      const errors = summary.errors ?? [];
      opts.recordRun?.finish(
        runId,
        outcomeOf(summary),
        summary as unknown as Record<string, unknown>,
        errors,
      );
      return reply.code(200).send(summary);
    } catch (err) {
      opts.recordRun?.finish(runId, 'failed', undefined, [
        { step: 'sync', message: (err as Error).message },
      ]);
      throw err;
    }
  });

  // ANA-139 (12.11 prod feedback): refill the derived stat tables EXACTLY where they have holes —
  // an interior run of missing days (an optional sync step failed while the local machine was off)
  // is invisible to per-table min/max and a full-window re-sync would spend Metrika quota on days
  // that are already good. The holes of all tables are unioned into the fewest contiguous windows
  // (one refill fills every table's hole in that window), synced oldest-first; the good history
  // around the holes is never re-fetched, so the refill is idempotent («дыры → дозагрузка»).
  // Admin-only like /sync (same prefix, ADMIN_RULES) — a refill spends Metrika quota.
  app.post('/sync/gaps', async (req, reply) => {
    const parsed = SyncGapsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    }
    if (!opts.coverageGaps) {
      return reply.code(503).send({ error: 'gap detection is not wired' });
    }
    const { from, to, force } = parsed.data;
    const gaps = opts.coverageGaps(from, to);
    // Union of the missing days across tables → the fewest refill windows (oldest first).
    const days = new Set<string>();
    for (const ranges of Object.values(gaps)) {
      for (const r of ranges) {
        for (const chunk of dayChunks(r.from, r.to)) days.add(chunk.from);
      }
    }
    const merged = contiguousRanges([...days]);
    const windows = merged.length > MAX_GAP_RANGES ? [{ from, to }] : merged;
    const synced: SyncGapsResult['synced'] = [];
    for (const window of windows) {
      const body = force === true ? { ...window, force: true } : window;
      // REG-05 parity with /sync: every refill run is recorded (it spends Metrika quota) and the
      // admin sync-status UI shows it; a failed window re-throws after its failed record.
      const runId = opts.recordRun?.start(window.from, window.to) ?? -1;
      try {
        const summary = await opts.runSync(body);
        const errors = summary.errors ?? [];
        opts.recordRun?.finish(
          runId,
          outcomeOf(summary),
          summary as unknown as Record<string, unknown>,
          errors,
        );
        synced.push({ from: window.from, to: window.to, summary });
      } catch (err) {
        opts.recordRun?.finish(runId, 'failed', undefined, [
          { step: 'sync', message: (err as Error).message },
        ]);
        throw err;
      }
    }
    return reply.code(200).send({ from, to, gaps, synced } satisfies SyncGapsResult);
  });

  // ANA-15: the last sync outcome (status + per-step errors) for the admin sync-status UI.
  app.get(
    '/sync/status',
    { schema: { tags: ['sync'], summary: 'Latest sync run (status + errors)' } },
    async () => {
      const run = opts.recordRun?.latest() ?? null;
      // ANA-68 style: «ещё не запускался» — это нормальное состояние, а не ошибка. 404 здесь
      // рисовал красную строку в консоли браузера на каждой загрузке админ-страницы.
      return { run };
    },
  );
}
