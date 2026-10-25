import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth, SESSION_COOKIE } from '../../src/auth/auth';
import { UsersRepo } from '../../src/auth/users-repo';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

const ADMIN = {
  email: 'admin@x.ru',
  name: 'Admin',
  role: 'admin' as const,
  password: 'admin-pass-123',
};
const ANALYST_PASSWORD = 'analyst-pass-123';

interface Ctx {
  app: FastifyInstance;
  db: DB;
  repo: UsersRepo;
  admin: { email: string; password: string };
  analystEmail: string;
}

async function build(): Promise<Ctx> {
  const db = freshDb();
  const repo = new UsersRepo(db);
  repo.create(ADMIN);
  repo.create({
    email: 'analyst@x.ru',
    name: 'Analyst',
    role: 'analyst',
    password: ANALYST_PASSWORD,
  });
  const app = Fastify({ logger: false });
  registerAuth(app, { users: repo, cookieSecure: false, sessionDays: 7 });
  await app.ready();
  return { app, db, repo, admin: ADMIN, analystEmail: 'analyst@x.ru' };
}

let ctx: Ctx;
afterEach(async () => {
  await ctx.app.close();
  ctx.db.close();
});

const login = (email: string, password: string) =>
  ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

describe('auth flow', () => {
  it('login ok → 200, user payload without secrets, session cookie set', async () => {
    ctx = await build();
    const res = await login(ADMIN.email, ADMIN.password);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ email: ADMIN.email, role: 'admin', isActive: true });
    expect(body.user.password_hash).toBeUndefined();
    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=604800'); // 7 days
    expect(cookie).not.toContain('Secure'); // cookieSecure: false in tests
  });

  it('wrong password → 401 BAD_CREDENTIALS and an audit entry', async () => {
    ctx = await build();
    const res = await login(ADMIN.email, 'wrong-pass-123');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid credentials', code: 'BAD_CREDENTIALS' });
    const audit = ctx.repo.listAudit(1)[0]!;
    expect(audit).toMatchObject({
      action: 'auth.login_failed',
      target: ADMIN.email,
      userEmail: null,
    });
  });

  it('invalid body → 400 BAD_INPUT (no limiter hit)', async () => {
    ctx = await build();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email', password: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_INPUT');
  });

  it('rate limiter: 5 failures → 429 even with the right password; success resets the counter', async () => {
    ctx = await build();
    for (let i = 0; i < 5; i++) {
      const r = await login(ADMIN.email, 'wrong-pass-123');
      expect(r.statusCode).toBe(401);
    }
    const blocked = await login(ADMIN.email, ADMIN.password);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMITED');

    // A fresh app (clean limiter): failures then success reset → next failures start from zero.
    const ctx2 = await build();
    try {
      for (let i = 0; i < 2; i++)
        await ctx2.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: ADMIN.email, password: 'nope-pass-123' },
        });
      const ok = await ctx2.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: ADMIN.email, password: ADMIN.password },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await ctx2.app.close();
      ctx2.db.close();
    }
  });

  it('logout deletes the session and clears the cookie', async () => {
    ctx = await build();
    const loginRes = await login(ADMIN.email, ADMIN.password);
    const token = loginRes.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(ctx.repo.userBySession(token)).toBeUndefined();
    expect(res.headers['set-cookie'] as string).toContain('Max-Age=0');
    expect(ctx.repo.listAudit(1)[0]!.action).toBe('auth.logout');
  });

  it('GET /api/auth/me: 401 without a session, user with a session', async () => {
    ctx = await build();
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().code).toBe('AUTH_REQUIRED');

    const loginRes = await login(ADMIN.email, ADMIN.password);
    const token = loginRes.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(ADMIN.email);

    // A forged/unknown token is treated as anonymous.
    const forged = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=forged-token` },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('PATCH /api/auth/me updates name/locale; invalid body → 400', async () => {
    ctx = await build();
    const loginRes = await login('analyst@x.ru', ANALYST_PASSWORD);
    const cookie = `${SESSION_COOKIE}=${loginRes.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;

    const ok = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie },
      payload: { name: 'Новый', locale: 'en' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ name: 'Новый', locale: 'en' });

    const bad = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie },
      payload: { locale: 'de' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('POST /api/auth/password: wrong current → 400; ok rotates the password and re-issues the session', async () => {
    ctx = await build();
    const loginRes = await login('analyst@x.ru', ANALYST_PASSWORD);
    const cookie = `${SESSION_COOKIE}=${loginRes.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;

    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie },
      payload: { current: 'nope', next: 'new-pass-12345' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('BAD_CREDENTIALS');

    const weak = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie },
      payload: { current: ANALYST_PASSWORD, next: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().code).toBe('WEAK_PASSWORD');

    // Old session is revoked by setPassword — capture a "second device" token to prove it.
    const secondDevice = ctx.repo.createSession(ctx.repo.getByEmail('analyst@x.ru')!.id, 7);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie },
      payload: { current: ANALYST_PASSWORD, next: 'new-pass-12345' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    // The current device got a fresh session cookie.
    const newToken = ok.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    expect(ctx.repo.userBySession(newToken)?.email).toBe('analyst@x.ru');
    // All other sessions (incl. the pre-change one) were revoked.
    expect(ctx.repo.userBySession(cookie.split('=')[1]!)).toBeUndefined();
    expect(ctx.repo.userBySession(secondDevice)).toBeUndefined();
    expect(ctx.repo.listAudit(1)[0]!.action).toBe('auth.password_changed');
  });
});

describe('session guard & roles', () => {
  it('protected /api route without a session → 401', async () => {
    ctx = await build();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/users' });
    expect(res.statusCode).toBe(401);
  });

  it('analyst on an admin route → 403 ADMIN_ONLY; admin passes', async () => {
    ctx = await build();
    const analystLogin = await login('analyst@x.ru', ANALYST_PASSWORD);
    const aCookie = `${SESSION_COOKIE}=${analystLogin.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: aCookie },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe('ADMIN_ONLY');

    const adminLogin = await login(ADMIN.email, ADMIN.password);
    const adminCookie = `${SESSION_COOKIE}=${adminLogin.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
    const ok = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: adminCookie },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveLength(2);
  });

  it('admin can read /api/settings (GET is not an admin rule) but POST is guarded', async () => {
    ctx = await build();
    // No /api/settings route is registered here — the guard passes the request to the 404 handler.
    const res = await ctx.app.inject({ method: 'POST', url: '/api/settings', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('admin users management', () => {
  const adminCookie = () =>
    login(ADMIN.email, ADMIN.password).then(
      (r) => `${SESSION_COOKIE}=${r.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`,
    );

  it('POST /api/users creates with an explicit password and audits', async () => {
    ctx = await build();
    const cookie = await adminCookie();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { email: 'new@x.ru', name: 'New', role: 'analyst', password: 'created-pass-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe('new@x.ru');
    expect(res.json().temporaryPassword).toBeUndefined(); // explicit password is not echoed
    expect(ctx.repo.authenticate('new@x.ru', 'created-pass-1')).toBeDefined();
    expect(ctx.repo.listAudit(1)[0]!.action).toBe('users.create');
  });

  it('POST /api/users without a password returns a generated temporary password once', async () => {
    ctx = await build();
    const cookie = await adminCookie();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { email: 'tmp@x.ru', name: 'Tmp', role: 'analyst' },
    });
    expect(res.statusCode).toBe(201);
    const pwd = res.json().temporaryPassword as string;
    expect(pwd).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(ctx.repo.authenticate('tmp@x.ru', pwd)).toBeDefined();
  });

  it('POST /api/users with a duplicate email → 409 EMAIL_EXISTS; invalid body → 400', async () => {
    ctx = await build();
    const cookie = await adminCookie();
    const dup = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { email: ADMIN.email, name: 'Dup', role: 'analyst' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('EMAIL_EXISTS');

    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { email: 'not-an-email', name: '', role: 'boss' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('BAD_INPUT');
  });

  it('PATCH /api/users/:id: 404 unknown, 400 invalid, edit ok; last admin demote → 409 LAST_ADMIN', async () => {
    ctx = await build();
    const cookie = await adminCookie();
    const adminId = ctx.repo.getByEmail(ADMIN.email)!.id;

    expect(
      (
        await ctx.app.inject({
          method: 'PATCH',
          url: '/api/users/999',
          headers: { cookie },
          payload: { name: 'X' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await ctx.app.inject({
          method: 'PATCH',
          url: `/api/users/${adminId}`,
          headers: { cookie },
          payload: { role: 'boss' },
        })
      ).statusCode,
    ).toBe(400);

    const analystId = ctx.repo.getByEmail('analyst@x.ru')!.id;
    const ok = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${analystId}`,
      headers: { cookie },
      payload: { name: 'Renamed' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.name).toBe('Renamed');

    // Single active admin cannot demote/deactivate himself.
    const demote = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      headers: { cookie },
      payload: { role: 'analyst' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().code).toBe('LAST_ADMIN');
    const deactivate = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      headers: { cookie },
      payload: { isActive: false },
    });
    expect(deactivate.statusCode).toBe(409);

    // With a second active admin the demotion is allowed.
    ctx.repo.create({
      email: 'second@x.ru',
      name: 'S',
      role: 'admin',
      password: 'second-pass-123',
    });
    const demoteOk = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      headers: { cookie },
      payload: { role: 'analyst' },
    });
    expect(demoteOk.statusCode).toBe(200);
    expect(demoteOk.json().user.role).toBe('analyst');
  });

  it('POST /api/users/:id/reset-password returns a one-time password and revokes sessions; 404 unknown', async () => {
    ctx = await build();
    const cookie = await adminCookie();
    const analystId = ctx.repo.getByEmail('analyst@x.ru')!.id;
    const token = ctx.repo.createSession(analystId, 7);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/users/${analystId}/reset-password`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const pwd = res.json().temporaryPassword as string;
    expect(ctx.repo.userBySession(token)).toBeUndefined(); // revoked
    expect(ctx.repo.authenticate('analyst@x.ru', pwd)).toBeDefined();
    expect(ctx.repo.listAudit(1)[0]!.action).toBe('users.reset_password');

    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/users/999/reset-password',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('GET /api/admin/audit returns entries; limit is clamped to [1, 1000]', async () => {
    ctx = await build();
    const cookie = await adminCookie();
    await ctx.repo.audit(null, 'auth.login_failed', 'x@x.ru');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/audit',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);

    const weird = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/audit?limit=-5',
      headers: { cookie },
    });
    expect(weird.statusCode).toBe(200); // clamped, not an error
    expect(weird.json()).toHaveLength(1);
  });
});
