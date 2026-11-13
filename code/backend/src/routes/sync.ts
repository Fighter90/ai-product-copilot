import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SyncRunStatus, SyncStepError } from '@pca/shared';
import type { SyncSummary } from '../metrika/sync-service';

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
