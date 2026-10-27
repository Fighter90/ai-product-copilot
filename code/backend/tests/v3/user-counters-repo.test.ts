import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UsersRepo } from '../../src/auth/users-repo';
import { UserCountersRepo } from '../../src/auth/user-counters-repo';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

let db: DB;
let users: UsersRepo;
let repo: UserCountersRepo;
const NOW = new Date('2026-10-27T10:00:00.000Z');

const mk = (email: string, role: 'admin' | 'analyst') =>
  users.create({ email, name: email, role, password: 'password-123' });

beforeEach(() => {
  db = freshDb();
  users = new UsersRepo(db);
  repo = new UserCountersRepo(db, () => NOW);
});
afterEach(() => db.close());

describe('UserCountersRepo', () => {
  it('set replaces assignments (dedup, drops non-positive), list/has reflect them', () => {
    const a = mk('a@x.ru', 'analyst');
    expect(repo.list(a.id)).toEqual([]);
    expect(repo.set(a.id, [300, 100, 100, 0, -5], 'admin@x.ru')).toEqual([100, 300]);
    expect(repo.has(a.id, 100)).toBe(true);
    expect(repo.has(a.id, 200)).toBe(false);
    expect(repo.set(a.id, [200, 300])).toEqual([200, 300]);
    expect(repo.has(a.id, 100)).toBe(false);
    expect(repo.set(a.id, [])).toEqual([]);
  });

  it('keeps granted_at/granted_by of an existing assignment when re-set', () => {
    const a = mk('a@x.ru', 'analyst');
    repo.set(a.id, [100], 'first@x.ru');
    repo.set(a.id, [100, 200], 'second@x.ru');
    const rows = db
      .prepare('SELECT counter_id, granted_by, granted_at FROM user_counters ORDER BY counter_id')
      .all();
    expect(rows).toEqual([
      { counter_id: 100, granted_by: 'first@x.ru', granted_at: NOW.toISOString() },
      { counter_id: 200, granted_by: 'second@x.ru', granted_at: NOW.toISOString() },
    ]);
  });

  it('allByUser / assignedCounterIds', () => {
    const a = mk('a@x.ru', 'analyst');
    const b = mk('b@x.ru', 'analyst');
    repo.set(a.id, [100, 200]);
    repo.set(b.id, [200, 300]);
    expect(repo.allByUser()).toEqual({ [a.id]: [100, 200], [b.id]: [200, 300] });
    expect(repo.assignedCounterIds()).toEqual([100, 200, 300]);
  });

  it('assignments are removed with the user (ON DELETE CASCADE)', () => {
    const a = mk('a@x.ru', 'analyst');
    repo.set(a.id, [100]);
    db.prepare('DELETE FROM users WHERE id = ?').run(a.id);
    expect(repo.assignedCounterIds()).toEqual([]);
  });

  it('rejects counter_id <= 0 at the schema level', () => {
    const a = mk('a@x.ru', 'analyst');
    expect(() => repo.grant(a.id, 0)).toThrow();
  });
});

describe('legacy grant (migration 013)', () => {
  it('grants every existing analyst the configured counter once and consumes the marker', () => {
    const admin = mk('admin@x.ru', 'admin');
    const a = mk('a@x.ru', 'analyst');
    const b = mk('b@x.ru', 'analyst');
    repo.grant(b.id, 777);
    expect(repo.applyLegacyGrant(54280963)).toBe(2);
    expect(repo.list(a.id)).toEqual([54280963]);
    expect(repo.list(b.id)).toEqual([777, 54280963]);
    expect(repo.list(admin.id)).toEqual([]); // admins bypass the table
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_counters_legacy_grant').get()).toEqual({
      n: 0,
    });
    expect(db.prepare('SELECT granted_by FROM user_counters WHERE user_id = ?').get(a.id)).toEqual({
      granted_by: 'migration:013',
    });

    // A later analyst is NOT auto-granted (even from a fresh repo instance).
    const c = mk('c@x.ru', 'analyst');
    expect(new UserCountersRepo(db).applyLegacyGrant(54280963)).toBe(0);
    expect(repo.applyLegacyGrant(54280963)).toBe(0);
    expect(repo.list(c.id)).toEqual([]);
  });

  it('no counter configured → waits (marker kept) until one is', () => {
    const a = mk('a@x.ru', 'analyst');
    expect(repo.applyLegacyGrant(0)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_counters_legacy_grant').get()).toEqual({
      n: 1,
    });
    expect(repo.applyLegacyGrant(100)).toBe(1);
    expect(repo.list(a.id)).toEqual([100]);
  });
});
