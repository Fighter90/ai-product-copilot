import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SyncSummary } from '../metrika/sync-service';

const SyncBody = z.object({
  from: z.string(),
  to: z.string(),
  goalId: z.number().int().optional(),
});

export type SyncRunner = (body: z.infer<typeof SyncBody>) => Promise<SyncSummary>;

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
}

/** `POST /api/sync` — pull Metrika data into SQLite for the given period. */
export async function syncRoutes(app: FastifyInstance, opts: SyncRouteOptions): Promise<void> {
  app.post('/sync', async (req, reply) => {
    const parsed = SyncBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    }
    return reply.code(200).send(await opts.runSync(parsed.data));
  });
}
