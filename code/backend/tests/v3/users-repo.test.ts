import { describe, it, expect } from 'vitest';
import { ensureBootstrapUsers, UsersRepo } from '../../src/auth/users-repo';
import { freshDb } from '../db/helpers';

describe('UsersRepo', () => {
  it('create / getById / getByEmail / list / count', () => {
    const repo = new UsersRepo(freshDb());
    expect(repo.count()).toBe(0);
    const u = repo.create({
      email: '  A@B.RU  ',
      name: ' Анна ',
      role: 'admin',
      password: 'password-123',
    });
    expect(u.email).toBe('A@B.RU'); // trimmed
    expect(u.name).toBe('Анна');
    expect(u.isActive).toBe(true);
    expect(u.locale).toBe('ru');
    expect(u.lastLoginAt).toBeNull();
    expect(repo.count()).toBe(1);
    expect(repo.getById(u.id)?.email).toBe('A@B.RU');
    expect(repo.getById(999)).toBeUndefined();
    expect(repo.getByEmail('a@b.ru')?.id).toBe(u.id); // case-insensitive lookup by trim
    expect(repo.getByEmail('missing@x.ru')).toBeUndefined();
    expect(repo.list()).toHaveLength(1);
  });

  it('create honours an explicit locale; email UNIQUE constraint throws', () => {
    const repo = new UsersRepo(freshDb());
    repo.create({
      email: 'a@b.ru',
      name: 'A',
      role: 'analyst',
      password: 'password-123',
      locale: 'en',
    });
    expect(repo.getByEmail('a@b.ru')?.locale).toBe('en');
    expect(() =>
      repo.create({ email: 'a@b.ru', name: 'B', role: 'analyst', password: 'password-456' }),
    ).toThrowError(/UNIQUE/);
  });

  it('update patches fields, deactivate revokes sessions', () => {
    const repo = new UsersRepo(freshDb());
    const u = repo.create({ email: 'a@b.ru', name: 'A', role: 'admin', password: 'password-123' });
    const token = repo.createSession(u.id, 7);
    expect(repo.userBySession(token)?.id).toBe(u.id);

    const updated = repo.update(u.id, { name: 'B', role: 'analyst', locale: 'en' });
    expect(updated).toMatchObject({ name: 'B', role: 'analyst', locale: 'en', isActive: true });
    // Sessions survive a plain update.
    expect(repo.userBySession(token)?.id).toBe(u.id);

    expect(repo.update(999, { name: 'ghost' })).toBeUndefined();

    const deactivated = repo.update(u.id, { isActive: false });
    expect(deactivated?.isActive).toBe(false);
    expect(repo.userBySession(token)).toBeUndefined(); // revoked
  });

  it('setPassword changes the hash and revokes all sessions', () => {
    const repo = new UsersRepo(freshDb());
    const u = repo.create({
      email: 'a@b.ru',
      name: 'A',
      role: 'analyst',
      password: 'old-password',
    });
    const token = repo.createSession(u.id, 7);
    repo.setPassword(u.id, 'new-password-10');
    expect(repo.authenticate('a@b.ru', 'old-password')).toBeUndefined();
    expect(repo.authenticate('a@b.ru', 'new-password-10')?.id).toBe(u.id);
    expect(repo.userBySession(token)).toBeUndefined();
  });

  it('remove hard-deletes the user; sessions cascade; unknown id → undefined (ANA-123)', () => {
    const repo = new UsersRepo(freshDb());
    const u = repo.create({ email: 'a@b.ru', name: 'A', role: 'analyst', password: 'password-123' });
    const token = repo.createSession(u.id, 7);
    expect(repo.remove(u.id)).toMatchObject({ id: u.id, email: 'a@b.ru' });
    expect(repo.getById(u.id)).toBeUndefined();
    expect(repo.authenticate('a@b.ru', 'password-123')).toBeUndefined();
    expect(repo.userBySession(token)).toBeUndefined(); // FK ON DELETE CASCADE
    expect(repo.remove(999)).toBeUndefined();
  });

  it('authenticate: ok / wrong password / unknown user / inactive user (all return undefined safely)', () => {
    const repo = new UsersRepo(freshDb());
    const u = repo.create({
      email: 'a@b.ru',
      name: 'A',
      role: 'analyst',
      password: 'right-password',
    });
    expect(repo.authenticate('a@b.ru', 'right-password')?.id).toBe(u.id);
    // last_login_at stamped on success
    expect(repo.getById(u.id)!.lastLoginAt).not.toBeNull();
    expect(repo.authenticate('a@b.ru', 'wrong-password')).toBeUndefined();
    expect(repo.authenticate('ghost@x.ru', 'right-password')).toBeUndefined();
    repo.update(u.id, { isActive: false });
    expect(repo.authenticate('a@b.ru', 'right-password')).toBeUndefined();
  });

  it('sessions: expiry deletes the row; deleteSession works', () => {
    let now = new Date('2025-06-01T12:00:00Z');
    const repo = new UsersRepo(freshDb(), () => now);
    const u = repo.create({
      email: 'a@b.ru',
      name: 'A',
      role: 'analyst',
      password: 'password-123',
    });
    const token = repo.createSession(u.id, 1, { ip: '127.0.0.1', userAgent: 'vitest-agent-long' });
    expect(repo.userBySession(token)?.id).toBe(u.id);

    now = new Date('2025-06-03T12:00:00Z'); // > 1 day later
    expect(repo.userBySession(token)).toBeUndefined();
    // Expired row was deleted — recreating a session works cleanly.
    const fresh = repo.createSession(u.id, 1);
    expect(repo.userBySession(fresh)?.id).toBe(u.id);
    repo.deleteSession(fresh);
    expect(repo.userBySession(fresh)).toBeUndefined();
    repo.deleteSession('no-such-token'); // no-op, no throw
  });

  it('userBySession of a deactivated user is rejected', () => {
    const repo = new UsersRepo(freshDb());
    const u = repo.create({
      email: 'a@b.ru',
      name: 'A',
      role: 'analyst',
      password: 'password-123',
    });
    const token = repo.createSession(u.id, 7);
    repo.update(u.id, { isActive: false });
    expect(repo.userBySession(token)).toBeUndefined();
  });

  it('audit + listAudit (latest first, limit, details JSON)', () => {
    let t = 0;
    const repo = new UsersRepo(freshDb(), () => new Date(2025, 0, 1, 0, 0, t++));
    const u = repo.create({ email: 'a@b.ru', name: 'A', role: 'admin', password: 'password-123' });
    repo.audit(u, 'auth.login');
    repo.audit(null, 'auth.login_failed', 'bad@x.ru');
    repo.audit(u, 'settings.update', 'COUNTER_ID', { from: 1, to: 2 });

    const entries = repo.listAudit();
    expect(entries.map((e) => e.action)).toEqual([
      'settings.update',
      'auth.login_failed',
      'auth.login',
    ]);
    expect(entries[0]!.userEmail).toBe('a@b.ru');
    expect(JSON.parse(entries[0]!.details!)).toEqual({ from: 1, to: 2 });
    expect(entries[1]!.userEmail).toBeNull();
    expect(entries[1]!.target).toBe('bad@x.ru');
    expect(entries[2]!.details).toBeNull();
    expect(repo.listAudit(1)).toHaveLength(1);
  });

  it('countActiveAdmins', () => {
    const repo = new UsersRepo(freshDb());
    const a = repo.create({ email: 'a@b.ru', name: 'A', role: 'admin', password: 'password-123' });
    repo.create({ email: 'b@b.ru', name: 'B', role: 'analyst', password: 'password-123' });
    expect(repo.countActiveAdmins()).toBe(1);
    repo.create({ email: 'c@b.ru', name: 'C', role: 'admin', password: 'password-123' });
    expect(repo.countActiveAdmins()).toBe(2);
    repo.update(a.id, { isActive: false });
    expect(repo.countActiveAdmins()).toBe(1);
  });
});

describe('ensureBootstrapUsers', () => {
  const base = {
    adminEmail: 'root@x.ru',
    adminName: 'Root',
    adminPassword: 'root-password-1',
    demo: false,
    demoAdminPassword: '',
    demoAnalystPassword: '',
  };

  it('creates the first admin when the table is empty', () => {
    const repo = new UsersRepo(freshDb());
    expect(ensureBootstrapUsers(repo, base)).toEqual(['root@x.ru']);
    expect(repo.count()).toBe(1);
    expect(repo.getByEmail('root@x.ru')?.role).toBe('admin');
  });

  it('skips the admin when users exist or the password is empty; idempotent', () => {
    const repo = new UsersRepo(freshDb());
    repo.create({ email: 'seed@x.ru', name: 'S', role: 'admin', password: 'password-123' });
    expect(ensureBootstrapUsers(repo, base)).toEqual([]);
    const empty = new UsersRepo(freshDb());
    expect(ensureBootstrapUsers(empty, { ...base, adminPassword: '' })).toEqual([]);
    // Second run over the same repo changes nothing.
    expect(ensureBootstrapUsers(repo, base)).toEqual([]);
    expect(repo.count()).toBe(1);
  });

  it('creates demo accounts only with passwords and only once', () => {
    const repo = new UsersRepo(freshDb());
    const opts = {
      ...base,
      adminPassword: '',
      demo: true,
      demoAdminPassword: 'demo-admin-pass',
      demoAnalystPassword: 'demo-analyst-pass',
    };
    const created = ensureBootstrapUsers(repo, opts);
    expect(created).toEqual(['admin@dashboardcamp.ru', 'analyst@dashboardcamp.ru']);
    expect(ensureBootstrapUsers(repo, opts)).toEqual([]);
    expect(repo.count()).toBe(2);
  });

  it('demo without passwords creates nobody', () => {
    const repo = new UsersRepo(freshDb());
    const created = ensureBootstrapUsers(repo, { ...base, adminPassword: '', demo: true });
    expect(created).toEqual([]);
    expect(repo.count()).toBe(0);
  });
});
