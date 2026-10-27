import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizePath } from './auth';
import type { User, UsersRepo } from './users-repo';
import type { UserCountersRepo } from './user-counters-repo';
import { MetrikaClient, type FetchLike } from '../metrika/client';

/**
 * Endpoints that read data of the configured Metrika counter. An analyst needs a `user_counters`
 * row for that counter; admins always pass. Loose prefix match (as ADMIN_RULES) so new routes
 * under these prefixes are protected by default.
 */
const COUNTER_DATA_PREFIXES = [
  '/api/metrics',
  '/api/live',
  '/api/report',
  '/api/integrations/datalens',
];

export function isCounterDataPath(url: string): boolean {
  const path = normalizePath(url);
  return COUNTER_DATA_PREFIXES.some((p) => path.startsWith(p));
}

export interface CounterGuardOptions {
  readonly access: UserCountersRepo;
  /** Effective COUNTER_ID (runtime settings → .env); 0 = not configured. */
  readonly counterId: () => number;
}

/**
 * Server-side counter access check. Must be added on the ROOT instance after `registerAuth`, so
 * it runs once `req.user` is resolved and only for requests the session guard let through.
 */
export function registerCounterGuard(app: FastifyInstance, opts: CounterGuardOptions): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user;
    // No user: a public path (e.g. the DataLens webhook) — the session guard already decided.
    if (!user || user.role === 'admin') return;
    if (!isCounterDataPath(req.url)) return;
    const counterId = opts.counterId();
    if (!(counterId > 0)) return; // nothing configured → no counter data to protect
    opts.access.applyLegacyGrant(counterId);
    if (!opts.access.has(user.id, counterId)) {
      return reply.code(403).send({
        error: 'no access to this Metrika counter — ask an administrator',
        code: 'COUNTER_FORBIDDEN',
      });
    }
  });
}

/**
 * Default access for a user created via POST /api/users: an explicit `counterIds` list wins;
 * otherwise a new analyst gets the configured counter (single-counter deployments keep working).
 */
export function grantOnCreate(
  access: UserCountersRepo,
  counterId: () => number,
): (user: User, counterIds: number[] | undefined, by: User) => void {
  return (user, counterIds, by) => {
    const configured = counterId();
    const ids = counterIds ?? (user.role === 'analyst' && configured > 0 ? [configured] : []);
    if (ids.length) access.set(user.id, ids, by.email);
  };
}

export interface CounterOption {
  readonly id: number;
  readonly name: string | null;
  readonly site: string | null;
  /** Configured as COUNTER_ID right now (the counter the data endpoints serve). */
  readonly configured: boolean;
  readonly source: 'settings' | 'metrika' | 'assigned';
}

const CountersResponse = z
  .object({
    counters: z.array(
      z
        .object({
          id: z.number().int(),
          name: z.string().nullish(),
          site: z.string().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Management API: counters visible to the token (GET /management/v1/counters). */
export async function fetchMetrikaCounters(
  token: string,
  fetchFn?: FetchLike,
  timeoutMs = 8000,
): Promise<Array<{ id: number; name: string | null; site: string | null }>> {
  const client = new MetrikaClient({ token, retries: 0, ...(fetchFn ? { fetchFn } : {}) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Metrika counters: timeout')), timeoutMs);
  });
  try {
    const res = await Promise.race([
      client.get('/management/v1/counters', { per_page: 1000 }, CountersResponse),
      timeout,
    ]);
    return res.counters.map((c) => ({ id: c.id, name: c.name ?? null, site: c.site ?? null }));
  } finally {
    clearTimeout(timer);
  }
}

export interface UserCountersRoutesDeps {
  readonly access: UserCountersRepo;
  readonly users: UsersRepo;
  readonly counterId: () => number;
  readonly token: () => string;
  readonly fetchFn?: FetchLike;
}

const SetCounters = z.object({
  counterIds: z.array(z.number().int().positive()).max(100),
});

/** Admin API (guarded by ADMIN_RULES: /api/admin, /api/users). Register with prefix `/api`. */
export async function userCountersRoutes(
  app: FastifyInstance,
  deps: UserCountersRoutesDeps,
): Promise<void> {
  /** Counters an admin can hand out: configured COUNTER_ID + Metrika list + already assigned. */
  app.get('/admin/counters', async () => {
    const configured = deps.counterId();
    const byId = new Map<number, CounterOption>();
    const rank = { settings: 0, metrika: 1, assigned: 2 } as const;
    const put = (o: Omit<CounterOption, 'configured'>) => {
      const prev = byId.get(o.id);
      byId.set(o.id, {
        id: o.id,
        name: o.name ?? prev?.name ?? null,
        site: o.site ?? prev?.site ?? null,
        source: prev && rank[prev.source] < rank[o.source] ? prev.source : o.source,
        configured: o.id === configured,
      });
    };
    if (configured > 0) put({ id: configured, name: null, site: null, source: 'settings' });
    let metrikaError: string | undefined;
    const token = deps.token();
    if (token) {
      try {
        for (const c of await fetchMetrikaCounters(token, deps.fetchFn)) {
          put({ ...c, source: 'metrika' });
        }
      } catch (err) {
        // Never echo the token; a short reason is enough for the admin.
        metrikaError = String((err as Error).message ?? err).slice(0, 200);
      }
    }
    for (const id of deps.access.assignedCounterIds()) {
      if (!byId.has(id)) put({ id, name: null, site: null, source: 'assigned' });
    }
    return {
      configured,
      counters: [...byId.values()].sort(
        (a, b) => Number(b.configured) - Number(a.configured) || a.id - b.id,
      ),
      ...(metrikaError ? { metrikaError } : {}),
    };
  });

  app.get('/admin/user-counters', async () => deps.access.allByUser());

  app.put('/users/:id/counters', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = SetCounters.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    const target = Number.isInteger(id) ? deps.users.getById(id) : undefined;
    if (!target) return reply.code(404).send({ error: 'not found' });
    const counterIds = deps.access.set(id, body.data.counterIds, req.user?.email);
    deps.users.audit(req.user ?? null, 'users.counters', target.email, { counterIds });
    return { userId: id, counterIds };
  });
}
