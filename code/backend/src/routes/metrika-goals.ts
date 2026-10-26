import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { UsersRepo } from '../auth/users-repo';
import { MetrikaClient, MetrikaHttpError } from '../metrika/client';
import { ENDPOINTS } from '../metrika/endpoints';
import { auditGoals, fetchGoalReaches } from '../metrika/goals-audit';
import {
  archiveGoal,
  assertWritePermission,
  counterPermission,
  createGoal,
  describeGoalError,
  GoalInputError,
  isArchivedGoal,
  listGoals,
  parseGoalSpec,
  unarchiveGoal,
  type GoalSpec,
} from '../metrika/goals-management';
import { findRef, refGoalSpec } from '../metrika/pc-goals-reference';

/**
 * Admin-only Management-API routes for counter goals: audit vs the pc-goals reference, preview,
 * create, archive (single / bulk) and restore.
 *
 * Role enforcement: every path below lives under the `/api/admin` prefix, which the global
 * session guard (registerAuth → requiresAdmin → ADMIN_RULES) already restricts to role=admin —
 * the same mechanism that protects /api/admin/audit and /api/users. No per-route check needed.
 *
 * Safety (ANA-36 «ни одной записи в Метрику без подтверждения»): every write requires an explicit
 * confirmation in the body — `confirm: true` for create/restore, the typed word `confirm: "АРХИВ"`
 * for archive — and checks the counter permission before the first write. Preview never writes.
 *
 * Contract mirrors live.ts: token/counterId are injectable getters (admin edits at runtime are
 * picked up on the next request), `clientFactory` is injectable for tests.
 */
export interface MetrikaGoalsDeps {
  readonly token: () => string;
  readonly counterId: () => number;
  readonly users: UsersRepo;
  readonly clientFactory?: (token: string) => MetrikaClient;
  /** Reaches per goal over `days` days; defaults to the Reporting API. */
  readonly goalReaches?: (goalIds: readonly number[], days: number) => Promise<Map<number, number>>;
}

export const ARCHIVE_CONFIRM_WORD = 'АРХИВ';

const SpecBody = z.record(z.string(), z.unknown());
const GoalIdParam = z.coerce.number().int().positive();
const ArchiveBody = z
  .object({ confirm: z.unknown().optional(), folderId: z.number().int().min(0).optional() })
  .optional();
const RestoreBody = z.object({ confirm: z.unknown().optional() }).optional();
const BulkBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  confirm: z.unknown().optional(),
  folderId: z.number().int().min(0).optional(),
});
const AuditQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) });

type Reply = FastifyReply;

export async function metrikaGoalsRoutes(
  app: FastifyInstance,
  deps: MetrikaGoalsDeps,
): Promise<void> {
  const client = () =>
    (deps.clientFactory ?? ((t) => new MetrikaClient({ token: t, retries: 2 })))(deps.token());

  const ready = (reply: Reply): boolean => {
    if (!deps.token() || !deps.counterId()) {
      reply.code(409).send({ error: 'Metrika is not configured', code: 'METRIKA_NOT_CONFIGURED' });
      return false;
    }
    return true;
  };

  /** Map a Metrika failure onto the HTTP response; unknown errors bubble to the default handler. */
  const fail = (reply: Reply, err: unknown): unknown => {
    const mapped = describeGoalError(err);
    if (!mapped) throw err;
    return reply.code(mapped.status).send({ error: mapped.message, code: mapped.code });
  };

  const confirmRequired = (reply: Reply, expected: string): unknown =>
    reply.code(400).send({
      error: `Нужно подтверждение: передайте confirm: ${expected}`,
      code: 'CONFIRM_REQUIRED',
    });

  /**
   * Resolve a create/preview body to a validated spec: `{ref: "G-01"|"price_view"}` (reference
   * goal), the API envelope `{goal: {...}}`, or a bare spec. Control keys (`confirm`, `ref`) are
   * stripped so they never reach Metrika. Returns undefined after replying 400.
   */
  const resolveSpec = (reply: Reply, body: unknown): GoalSpec | undefined => {
    const parsed = SpecBody.safeParse(body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
      return undefined;
    }
    const { confirm: _c, ref, goal, ...rest } = parsed.data;
    if (typeof ref === 'string') {
      const found = findRef(ref);
      if (!found) {
        reply.code(400).send({ error: `unknown pc-goals reference: ${ref}`, code: 'BAD_INPUT' });
        return undefined;
      }
      return refGoalSpec(found);
    }
    const raw = goal && typeof goal === 'object' ? goal : rest;
    try {
      return parseGoalSpec(raw);
    } catch (err) {
      if (err instanceof GoalInputError) {
        reply.code(400).send({ error: err.message, code: 'BAD_INPUT', issues: err.issues });
        return undefined;
      }
      throw err;
    }
  };

  /** GET /api/admin/metrika/goals/audit?days=90 — reference vs counter, dead goals, duplicates. */
  app.get('/admin/metrika/goals/audit', async (req, reply) => {
    if (!ready(reply)) return;
    const query = AuditQuery.safeParse(req.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'invalid days', code: 'BAD_INPUT' });
    const days = query.data.days;
    const c = client();
    const counterId = deps.counterId();
    let goals;
    try {
      goals = await listGoals(c, counterId);
    } catch (err) {
      return fail(reply, err);
    }
    const warnings: string[] = [];
    const activeIds = goals.filter((g) => !isArchivedGoal(g)).map((g) => g.id);
    let reaches = new Map<number, number>();
    try {
      reaches = await (deps.goalReaches
        ? deps.goalReaches(activeIds, days)
        : fetchGoalReaches(c, counterId, activeIds, days));
    } catch (err) {
      warnings.push(`reaches unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
    let permission: string | null = null;
    try {
      permission = (await counterPermission(c, counterId)) ?? null;
    } catch {
      warnings.push('counter permission unavailable');
    }
    return {
      ...auditGoals(goals, reaches),
      days,
      permission,
      canWrite: permission === null ? null : permission !== 'view',
      warnings,
    };
  });

  /** POST /api/admin/metrika/goals/preview — validate and return the exact request; never writes. */
  app.post('/admin/metrika/goals/preview', async (req, reply) => {
    if (!ready(reply)) return;
    const spec = resolveSpec(reply, req.body);
    if (!spec) return;
    return {
      method: 'POST',
      path: ENDPOINTS.goals(deps.counterId()),
      body: { goal: spec },
      confirm: 'true',
    };
  });

  /** POST /api/admin/metrika/goals — create a goal (body: spec | {goal} | {ref}, confirm: true). */
  app.post('/admin/metrika/goals', async (req, reply) => {
    if (!ready(reply)) return;
    const spec = resolveSpec(reply, req.body);
    if (!spec) return;
    if ((req.body as { confirm?: unknown }).confirm !== true) return confirmRequired(reply, 'true');
    try {
      const c = client();
      await assertWritePermission(c, deps.counterId());
      const goal = await createGoal(c, deps.counterId(), spec);
      deps.users.audit(req.user ?? null, 'metrika.goal_created', goal.name, {
        goalId: goal.id,
        type: goal.type,
      });
      return reply.code(201).send({ goal });
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** POST /api/admin/metrika/goals/archive-bulk — archive several goals ({ids, confirm: "АРХИВ"}). */
  app.post('/admin/metrika/goals/archive-bulk', async (req, reply) => {
    if (!ready(reply)) return;
    const body = BulkBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    if (body.data.confirm !== ARCHIVE_CONFIRM_WORD) {
      return confirmRequired(reply, `"${ARCHIVE_CONFIRM_WORD}"`);
    }
    const ids = [...new Set(body.data.ids)];
    const c = client();
    try {
      await assertWritePermission(c, deps.counterId());
    } catch (err) {
      return fail(reply, err);
    }
    const archived: number[] = [];
    const failed: Array<{ id: number; code: string; error: string }> = [];
    const skipped: number[] = [];
    for (const [i, id] of ids.entries()) {
      try {
        await archiveGoal(c, deps.counterId(), id, body.data.folderId);
        archived.push(id);
        deps.users.audit(req.user ?? null, 'metrika.goal_archived', String(id), { bulk: true });
      } catch (err) {
        const mapped = describeGoalError(err);
        if (!mapped) throw err;
        failed.push({ id, code: mapped.code, error: mapped.message });
        // Auth/permission failures will repeat for every remaining goal — stop writing.
        if (err instanceof MetrikaHttpError && (err.status === 401 || err.status === 403)) {
          skipped.push(...ids.slice(i + 1));
          if (archived.length === 0) {
            return reply.code(mapped.status).send({ error: mapped.message, code: mapped.code });
          }
          break;
        }
      }
    }
    deps.users.audit(req.user ?? null, 'metrika.goals_archived_bulk', `${archived.length}`, {
      archived,
      failed: failed.map((f) => f.id),
      skipped,
    });
    return { archived, failed, skipped };
  });

  /** POST /api/admin/metrika/goals/:id/archive — archive a goal ({confirm: "АРХИВ", folderId?}). */
  app.post('/admin/metrika/goals/:id/archive', async (req, reply) => {
    if (!ready(reply)) return;
    const id = GoalIdParam.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid goal id', code: 'BAD_INPUT' });
    const body = ArchiveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    if (body.data?.confirm !== ARCHIVE_CONFIRM_WORD) {
      return confirmRequired(reply, `"${ARCHIVE_CONFIRM_WORD}"`);
    }
    try {
      const c = client();
      await assertWritePermission(c, deps.counterId());
      await archiveGoal(c, deps.counterId(), id.data, body.data.folderId);
      deps.users.audit(req.user ?? null, 'metrika.goal_archived', String(id.data));
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** POST /api/admin/metrika/goals/:id/restore — restore an archived goal ({confirm: true}). */
  app.post('/admin/metrika/goals/:id/restore', async (req, reply) => {
    if (!ready(reply)) return;
    const id = GoalIdParam.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid goal id', code: 'BAD_INPUT' });
    const body = RestoreBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    if (body.data?.confirm !== true) return confirmRequired(reply, 'true');
    try {
      const c = client();
      await assertWritePermission(c, deps.counterId());
      await unarchiveGoal(c, deps.counterId(), id.data);
      deps.users.audit(req.user ?? null, 'metrika.goal_restored', String(id.data));
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
