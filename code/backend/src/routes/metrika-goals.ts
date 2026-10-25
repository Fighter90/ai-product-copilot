import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { UsersRepo } from '../auth/users-repo';
import { MetrikaClient } from '../metrika/client';
import {
  archiveGoal,
  createGoal,
  describeGoalError,
  GoalInputError,
  parseGoalSpec,
  unarchiveGoal,
} from '../metrika/goals-management';

/**
 * Admin-only Management-API routes for counter goals (create / archive / restore).
 *
 * Role enforcement: every path below lives under the `/api/admin` prefix, which the global
 * session guard (registerAuth → requiresAdmin → ADMIN_RULES) already restricts to role=admin —
 * the same mechanism that protects /api/admin/audit and /api/users. No per-route check needed.
 *
 * Contract mirrors live.ts: token/counterId are injectable getters (admin edits at runtime are
 * picked up on the next request), `clientFactory` is injectable for tests.
 */
export interface MetrikaGoalsDeps {
  readonly token: () => string;
  readonly counterId: () => number;
  readonly users: UsersRepo;
  readonly clientFactory?: (token: string) => MetrikaClient;
}

/** Accept both a bare spec and the API envelope `{"goal": {...}}` — the route wraps it anyway. */
const CreateBody = z.union([
  z.object({ goal: z.record(z.unknown()) }).passthrough(),
  z.record(z.unknown()),
]);

const GoalIdParam = z.coerce.number().int().positive();
const ArchiveBody = z.object({ folderId: z.number().int().min(0).optional() }).optional();

export async function metrikaGoalsRoutes(
  app: FastifyInstance,
  deps: MetrikaGoalsDeps,
): Promise<void> {
  const client = () =>
    (deps.clientFactory ?? ((t) => new MetrikaClient({ token: t, retries: 2 })))(deps.token());

  const ready = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }): boolean => {
    if (!deps.token() || !deps.counterId()) {
      reply.code(409).send({ error: 'Metrika is not configured', code: 'METRIKA_NOT_CONFIGURED' });
      return false;
    }
    return true;
  };

  /** Map a Metrika failure onto the HTTP response; unknown errors bubble to the default handler. */
  const fail = (
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    err: unknown,
  ): unknown => {
    const mapped = describeGoalError(err);
    if (!mapped) throw err;
    return reply.code(mapped.status).send({ error: mapped.message, code: mapped.code });
  };

  /** POST /api/admin/metrika/goals — create a goal on the configured counter. */
  app.post('/admin/metrika/goals', async (req, reply) => {
    if (!ready(reply)) return;
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    }
    const raw = 'goal' in parsed.data ? parsed.data.goal : parsed.data;
    let spec;
    try {
      spec = parseGoalSpec(raw);
    } catch (err) {
      if (err instanceof GoalInputError) {
        return reply.code(400).send({ error: err.message, code: 'BAD_INPUT', issues: err.issues });
      }
      throw err;
    }
    try {
      const goal = await createGoal(client(), deps.counterId(), spec);
      deps.users.audit(req.user ?? null, 'metrika.goal_created', goal.name, {
        goalId: goal.id,
        type: goal.type,
      });
      return reply.code(201).send({ goal });
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** POST /api/admin/metrika/goals/:id/archive — archive a goal (body: { folderId? }). */
  app.post('/admin/metrika/goals/:id/archive', async (req, reply) => {
    if (!ready(reply)) return;
    const id = GoalIdParam.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid goal id', code: 'BAD_INPUT' });
    const body = ArchiveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    try {
      await archiveGoal(client(), deps.counterId(), id.data, body.data?.folderId);
      deps.users.audit(req.user ?? null, 'metrika.goal_archived', String(id.data));
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** POST /api/admin/metrika/goals/:id/restore — restore an archived goal. */
  app.post('/admin/metrika/goals/:id/restore', async (req, reply) => {
    if (!ready(reply)) return;
    const id = GoalIdParam.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid goal id', code: 'BAD_INPUT' });
    try {
      await unarchiveGoal(client(), deps.counterId(), id.data);
      deps.users.audit(req.user ?? null, 'metrika.goal_restored', String(id.data));
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
