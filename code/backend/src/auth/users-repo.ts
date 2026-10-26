import type { DB } from '../db/connection';
import { hashPassword, randomToken, sha256, verifyPassword } from '../security/crypto';

export type Role = 'admin' | 'analyst';
export type Locale = 'ru' | 'en';

export interface User {
  readonly id: number;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly isActive: boolean;
  readonly locale: Locale;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  is_active: number;
  locale: Locale;
  created_at: string;
  last_login_at: string | null;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  isActive: r.is_active === 1,
  locale: r.locale,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

export interface AuditEntry {
  readonly id: number;
  readonly at: string;
  readonly userEmail: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly details: string | null;
}

/** Users, sessions and the audit log. All timestamps are injected for deterministic tests. */
export class UsersRepo {
  constructor(
    private readonly db: DB,
    private readonly now: () => Date = () => new Date(),
  ) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  countActiveAdmins(): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1")
        .get() as { n: number }
    ).n;
  }

  list(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]).map(toUser);
  }

  getById(id: number): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  getByEmail(email: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as
      UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  create(input: {
    email: string;
    name: string;
    role: Role;
    password: string;
    locale?: Locale;
  }): User {
    const info = this.db
      .prepare(
        'INSERT INTO users (email, name, role, password_hash, is_active, locale, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      )
      .run(
        input.email.trim(),
        input.name.trim(),
        input.role,
        hashPassword(input.password),
        input.locale ?? 'ru',
        this.now().toISOString(),
      );
    return this.getById(Number(info.lastInsertRowid))!;
  }

  update(
    id: number,
    patch: Partial<{ name: string; role: Role; isActive: boolean; locale: Locale }>,
  ): User | undefined {
    const cur = this.getById(id);
    if (!cur) return undefined;
    this.db
      .prepare('UPDATE users SET name = ?, role = ?, is_active = ?, locale = ? WHERE id = ?')
      .run(
        patch.name ?? cur.name,
        patch.role ?? cur.role,
        (patch.isActive ?? cur.isActive) ? 1 : 0,
        patch.locale ?? cur.locale,
        id,
      );
    if (patch.isActive === false) this.revokeSessions(id);
    return this.getById(id);
  }

  setPassword(id: number, password: string): void {
    this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(password), id);
    this.revokeSessions(id);
  }

  /** Verified once at boot: unknown users cost the same scrypt time (anti-enumeration). */
  private readonly dummyHash: string = hashPassword('timing-equalizer');

  /** Verify credentials; returns the user only when active and the password matches. */
  authenticate(email: string, password: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as
      UserRow | undefined;
    // Always run the expensive check — even for missing/inactive users — so response
    // timing does not reveal which e-mails exist.
    const stored = row && row.is_active === 1 ? row.password_hash : this.dummyHash;
    if (!verifyPassword(password, stored)) return undefined;
    if (!row || row.is_active !== 1) return undefined;
    this.db
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(this.now().toISOString(), row.id);
    return toUser({ ...row, last_login_at: this.now().toISOString() });
  }

  // --- sessions ---------------------------------------------------------------------------

  /** Create a session; returns the raw token (only its hash is stored). */
  createSession(
    userId: number,
    days: number,
    meta: { ip?: string; userAgent?: string } = {},
  ): string {
    const token = randomToken(32);
    const now = this.now();
    const expires = new Date(now.getTime() + days * 86_400_000);
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        sha256(token),
        userId,
        now.toISOString(),
        expires.toISOString(),
        meta.ip ?? null,
        (meta.userAgent ?? '').slice(0, 200),
      );
    return token;
  }

  /** Resolve a session token to an active user (expired sessions are deleted). */
  userBySession(token: string): User | undefined {
    const row = this.db
      .prepare(
        'SELECT u.*, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      )
      .get(sha256(token)) as (UserRow & { s_exp: string }) | undefined;
    if (!row) return undefined;
    if (row.s_exp <= this.now().toISOString() || row.is_active !== 1) {
      this.deleteSession(token);
      return undefined;
    }
    return toUser(row);
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  revokeSessions(userId: number): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  // --- audit ------------------------------------------------------------------------------

  audit(
    user: Pick<User, 'id' | 'email'> | null,
    action: string,
    target?: string,
    details?: unknown,
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (at, user_id, user_email, action, target, details) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        this.now().toISOString(),
        user?.id ?? null,
        user?.email ?? null,
        action,
        target ?? null,
        details === undefined ? null : JSON.stringify(details),
      );
  }

  listAudit(limit = 200): AuditEntry[] {
    return (
      this.db
        .prepare(
          'SELECT id, at, user_email AS userEmail, action, target, details FROM audit_log ORDER BY id DESC LIMIT ?',
        )
        .all(limit) as AuditEntry[]
    ).map((r) => ({ ...r }));
  }
}

/**
 * Bootstrap accounts on start: the first admin (when the table is empty and a password is set)
 * and optional demo accounts. Idempotent — existing emails are left untouched.
 */
export function ensureBootstrapUsers(
  repo: UsersRepo,
  opts: {
    adminEmail: string;
    adminName: string;
    adminPassword: string;
    demo: boolean;
    demoAdminPassword: string;
    demoAnalystPassword: string;
  },
): string[] {
  const created: string[] = [];
  if (repo.count() === 0 && opts.adminPassword) {
    repo.create({
      email: opts.adminEmail,
      name: opts.adminName,
      role: 'admin',
      password: opts.adminPassword,
    });
    created.push(opts.adminEmail);
  }
  if (opts.demo) {
    const demo: Array<[string, string, Role, string]> = [
      ['admin@dashboardcamp.ru', 'Демо-администратор', 'admin', opts.demoAdminPassword],
      ['analyst@dashboardcamp.ru', 'Демо-аналитик', 'analyst', opts.demoAnalystPassword],
    ];
    for (const [email, name, role, password] of demo) {
      if (password && !repo.getByEmail(email)) {
        repo.create({ email, name, role, password });
        created.push(email);
      }
    }
  }
  return created;
}
