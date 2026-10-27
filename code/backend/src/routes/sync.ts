import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SyncRunStatus, SyncStepError } from '@pca/shared';
import type { SyncSummary } from '../metrika/sync-service';

const SyncBody = z.object({
  from: z.string(),
  to: z.string(),
  goalId: z.number().int().optional(),
});

export type SyncRunner = (body: z.infer<typeof SyncBody>) => Promise<SyncSummary>;

/** Final status of a recorded run (partial = some optional steps failed, see SyncSummary.errors). */
export type SyncRunOutcome = 'ok' | 'partial' | 'failed';

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
  return ({ from, to, goalId }) => {
    const pinned = pinnedGoalId();
    const resolved = valid(goalId) ? goalId : valid(pinned) ? pinned : undefined;
    return run(resolved === undefined ? { from, to } : { from, to, goalId: resolved });
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
        errors.length > 0 ? 'partial' : 'ok',
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
    async (_req, reply) => {
      const run = opts.recordRun?.latest();
      return run ?? reply.code(404).send({ error: 'no sync has been run yet' });
    },
  );
}
