import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Role, User, UsersRepo } from './users-repo';
import { randomPassword } from '../security/crypto';

export const SESSION_COOKIE = 'pca_session';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

/** Parse a Cookie header into a map (no dependency on @fastify/cookie). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue; // « =value»: пробел перед «=» давал пустой ключ-мусор
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionCookie(token: string, opts: { secure: boolean; maxAgeSec: number }): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAgeSec}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Paths reachable without a session. Everything else under /api requires login. */
const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/help',
  '/api/integrations/datalens/webhook',
];

export function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (!path.startsWith('/api/')) return true; // swagger UI etc. handled by nginx in prod
  // /api/help/ask остаётся ПУБЛИЧНЫМ (пользовательское решение): ассистент отвечает и гостю.
  // Расход LLM ограничен: help.ts — гость 5 / юзер 20 вопросов за 10 мин по IP; nginx limit_req.
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Session probe: `GET /api/auth/me` answers guests with 200 `{ user: null }` instead of 401, so
 * public pages don't log a console error on every visit. Exact path only — `PATCH /api/auth/me`
 * and every other protected route still 401 without a session.
 */
export function isSessionProbe(method: string, url: string): boolean {
  const m = method.toUpperCase();
  return (m === 'GET' || m === 'HEAD') && normalizePath(url) === '/api/auth/me';
}

/**
 * Paths that require the admin role (method + raw path prefix — deliberately loose, so a new
 * `/api/admin-x` route is protected by default). Everything that changes infrastructure or kicks off a Metrika pull is admin-only; analysts keep
 * write access to their own work (hypotheses, decisions, B2B, reports, notifications).
 */
const ADMIN_RULES: Array<{ method?: string; prefix: string }> = [
  { prefix: '/api/admin' },
  { prefix: '/api/users' },
  { prefix: '/api/settings', method: 'POST' },
  { prefix: '/api/settings', method: 'PUT' },
  { prefix: '/api/settings', method: 'PATCH' },
  { prefix: '/api/settings', method: 'DELETE' },
  { prefix: '/api/ai/providers', method: 'PUT' },
  { prefix: '/api/ai/providers', method: 'POST' },
  { prefix: '/api/data', method: 'DELETE' },
  // Sync wipes and reloads every Metrika table and spends API quota — admin only.
  { prefix: '/api/sync' },
  // ANA-73: the marketing sync may trigger a Metrika backfill window — admin only; analysts
  // keep hand-edit rights on the grid itself (PUT /api/marketing/weekly).
  { prefix: '/api/marketing/weekly/sync' },
  // Импорт реальных значений листа «стата» — массовая запись, только админ.
  { prefix: '/api/marketing/weekly/import-sheet' },
];

/**
 * Normalise a request URL for rule matching the way the router does: strip the query, decode
 * percent-escapes (`/api/%73ync` routes to `/api/sync`) and collapse duplicate slashes.
 */
export function normalizePath(url: string): string {
  const raw = url.split('?')[0] ?? '';
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // Malformed escape: keep the raw path (the router 400s/404s it anyway).
  }
  return path.replace(/\/{2,}/g, '/');
}

export function requiresAdmin(method: string, url: string): boolean {
  const path = normalizePath(url);
  const m = method.toUpperCase();
  return ADMIN_RULES.some((r) => path.startsWith(r.prefix) && (!r.method || r.method === m));
}

/** Simple in-memory login rate limiter: N failures per window per key (ip+email). */
export class LoginLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}
  blocked(key: string): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    this.hits.set(key, list);
    return list.length >= this.max;
  }
  fail(key: string): void {
    const list = (this.hits.get(key) ?? []).filter((x) => this.now() - x < this.windowMs);
    list.push(this.now());
    this.hits.set(key, list);
    // Periodic sweep: unbounded key growth (spoofed ips/emails) would leak memory.
    if (this.hits.size > 10_000) {
      const t = this.now();
      for (const [k, l] of this.hits) {
        const alive = l.filter((x) => t - x < this.windowMs);
        if (alive.length === 0) this.hits.delete(k);
        else this.hits.set(k, alive);
      }
    }
  }
  reset(key: string): void {
    this.hits.delete(key);
  }
}

export interface AuthOptions {
  readonly users: UsersRepo;
  readonly cookieSecure: boolean;
  readonly sessionDays: number;
  readonly limiter?: LoginLimiter;
  /** ANA-29: called after POST /api/users with the requested counter access (undefined = default). */
  readonly onUserCreated?: (user: User, counterIds: number[] | undefined, by: User) => void;
}

const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  locale: u.locale,
  isActive: u.isActive,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

/**
 * Registers the session guard (onRequest hook on the root instance) and auth/users routes.
 * Must be registered with `fastify-plugin`-like semantics: we call it directly on the root app.
 */
export function registerAuth(app: FastifyInstance, opts: AuthOptions): void {
  const limiter = opts.limiter ?? new LoginLimiter();
  if (!app.hasRequestDecorator('user')) app.decorateRequest('user', undefined);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const user = opts.users.userBySession(token);
      if (user) req.user = user;
    }
    if (isPublicPath(req.url) || isSessionProbe(req.method, req.url)) return;
    if (!req.user) return reply.code(401).send({ error: 'unauthorized', code: 'AUTH_REQUIRED' });
    if (requiresAdmin(req.method, req.url) && req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden', code: 'ADMIN_ONLY' });
    }
  });

  const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    const key = `${req.ip}|${parsed.data.email.toLowerCase()}`;
    // Separate whole-IP bucket: blocks key rotation across emails / spoofed X-Forwarded-For.
    const ipKey = `ip:${req.ip}`;
    if (limiter.blocked(key) || limiter.blocked(ipKey)) {
      return reply.code(429).send({ error: 'too many attempts', code: 'RATE_LIMITED' });
    }
    const user = opts.users.authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      limiter.fail(key);
      limiter.fail(ipKey);
      opts.users.audit(null, 'auth.login_failed', parsed.data.email.toLowerCase());
      return reply.code(401).send({ error: 'invalid credentials', code: 'BAD_CREDENTIALS' });
    }
    limiter.reset(key);
    limiter.reset(ipKey);
    const token = opts.users.createSession(user.id, opts.sessionDays, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    opts.users.audit(user, 'auth.login');
    reply.header(
      'set-cookie',
      sessionCookie(token, { secure: opts.cookieSecure, maxAgeSec: opts.sessionDays * 86_400 }),
    );
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) opts.users.deleteSession(token);
    if (req.user) opts.users.audit(req.user, 'auth.logout');
    reply.header('set-cookie', sessionCookie('', { secure: opts.cookieSecure, maxAgeSec: 0 }));
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (req.user) return { user: publicUser(req.user) };
    // Stale/forged cookie: drop it so the browser stops sending a dead session.
    if (parseCookies(req.headers.cookie)[SESSION_COOKIE]) {
      reply.header('set-cookie', sessionCookie('', { secure: opts.cookieSecure, maxAgeSec: 0 }));
    }
    return { user: null };
  });

  app.patch('/api/auth/me', async (req, reply) => {
    const body = z
      .object({
        locale: z.enum(['ru', 'en']).optional(),
        name: z.string().min(1).max(80).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body' });
    const u = opts.users.update(req.user!.id, body.data);
    if (!u) return reply.code(401).send({ error: 'unauthorized', code: 'AUTH_REQUIRED' });
    return { user: publicUser(u) };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const body = z
      .object({ current: z.string().min(1), next: z.string().min(10).max(200) })
      .safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid body', code: 'WEAK_PASSWORD' });
    if (!opts.users.authenticate(req.user!.email, body.data.current)) {
      return reply.code(400).send({ error: 'wrong password', code: 'BAD_CREDENTIALS' });
    }
    opts.users.setPassword(req.user!.id, body.data.next);
    opts.users.audit(req.user!, 'auth.password_changed');
    // setPassword revokes all sessions including the current one — issue a fresh session
    // so the user is not logged out of the device they are changing the password from.
    const token = opts.users.createSession(req.user!.id, opts.sessionDays, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    reply.header(
      'set-cookie',
      sessionCookie(token, { secure: opts.cookieSecure, maxAgeSec: opts.sessionDays * 86_400 }),
    );
    return { ok: true };
  });

  // --- admin: users --------------------------------------------------------------------------

  app.get('/api/users', async () => opts.users.list().map(publicUser));

  const CreateUser = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(80),
    role: z.enum(['admin', 'analyst']),
    password: z.string().min(10).max(200).optional(),
    counterIds: z.array(z.number().int().positive()).max(100).optional(),
  });

  app.post('/api/users', async (req, reply) => {
    const body = CreateUser.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    const password = body.data.password ?? randomPassword();
    const generated = !body.data.password; // generated → возвращаем один раз; явный — не возвращаем
    let user;
    try {
      // create() is the single source of truth: UNIQUE constraint → 409 (no TOCTOU gap).
      user = opts.users.create({ ...body.data, password });
    } catch (err) {
      if (String((err as { code?: string }).code ?? '').startsWith('SQLITE_CONSTRAINT')) {
        return reply.code(409).send({ error: 'email exists', code: 'EMAIL_EXISTS' });
      }
      throw err;
    }
    opts.users.audit(req.user!, 'users.create', user.email, { role: user.role });
    opts.onUserCreated?.(user, body.data.counterIds, req.user!);
    // The temporary password is returned exactly once so the admin can hand it over.
    return reply.code(201).send({
      user: publicUser(user),
      ...(generated ? { temporaryPassword: password } : {}),
    });
  });

  const PatchUser = z.object({
    name: z.string().min(1).max(80).optional(),
    role: z.enum(['admin', 'analyst']).optional(),
    isActive: z.boolean().optional(),
  });

  app.patch('/api/users/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = PatchUser.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    const target = opts.users.getById(id);
    if (!target) return reply.code(404).send({ error: 'not found' });
    const demotes =
      target.role === 'admin' && (body.data.role === 'analyst' || body.data.isActive === false);
    if (demotes && target.isActive && opts.users.countActiveAdmins() <= 1) {
      return reply.code(409).send({ error: 'last admin', code: 'LAST_ADMIN' });
    }
    const updated = opts.users.update(
      id,
      body.data as Partial<{ name: string; role: Role; isActive: boolean }>,
    );
    opts.users.audit(req.user!, 'users.update', target.email, body.data);
    return { user: publicUser(updated!) };
  });

  app.post('/api/users/:id/reset-password', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const target = opts.users.getById(id);
    if (!target) return reply.code(404).send({ error: 'not found' });
    const password = randomPassword();
    opts.users.setPassword(id, password);
    opts.users.audit(req.user!, 'users.reset_password', target.email);
    return { temporaryPassword: password };
  });

  app.get('/api/admin/audit', async (req) => {
    const raw = Number((req.query as { limit?: string }).limit ?? 200) || 200;
    const limit = Math.max(1, Math.min(raw, 1000)); // LIMIT -1 would mean "no limit" in SQLite
    return opts.users.listAudit(limit);
  });
}
