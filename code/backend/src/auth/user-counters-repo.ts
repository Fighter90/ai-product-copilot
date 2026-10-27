import type { DB } from '../db/connection';

/** Which Metrika counters each analyst may read (ANA-29). Admins bypass this table entirely. */
export class UserCountersRepo {
  /** Set once the one-off legacy grant has been applied (or found absent) in this process. */
  private legacyChecked = false;

  constructor(
    private readonly db: DB,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(userId: number): number[] {
    return (
      this.db
        .prepare('SELECT counter_id FROM user_counters WHERE user_id = ? ORDER BY counter_id')
        .all(userId) as Array<{ counter_id: number }>
    ).map((r) => r.counter_id);
  }

  has(userId: number, counterId: number): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM user_counters WHERE user_id = ? AND counter_id = ?')
      .get(userId, counterId);
  }

  /** userId → assigned counter ids (users without rows are absent). */
  allByUser(): Record<number, number[]> {
    const out: Record<number, number[]> = {};
    const rows = this.db
      .prepare('SELECT user_id, counter_id FROM user_counters ORDER BY user_id, counter_id')
      .all() as Array<{ user_id: number; counter_id: number }>;
    for (const r of rows) (out[r.user_id] ??= []).push(r.counter_id);
    return out;
  }

  /** Distinct counters that appear in any assignment. */
  assignedCounterIds(): number[] {
    return (
      this.db
        .prepare('SELECT DISTINCT counter_id FROM user_counters ORDER BY counter_id')
        .all() as Array<{ counter_id: number }>
    ).map((r) => r.counter_id);
  }

  grant(userId: number, counterId: number, by?: string): void {
    this.db
      .prepare(
        // ON CONFLICT (not OR IGNORE): OR IGNORE would also swallow the schema CHECK
        // counter_id > 0 as a silent no-op, while only the (user_id, counter_id) duplicate
        // is meant to be idempotent here.
        `INSERT INTO user_counters (user_id, counter_id, granted_at, granted_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, counter_id) DO NOTHING`,
      )
      .run(userId, counterId, this.now().toISOString(), by ?? null);
  }

  /** Replace the user's assignments with `counterIds` (deduplicated); returns the stored list. */
  set(userId: number, counterIds: readonly number[], by?: string): number[] {
    const unique = [...new Set(counterIds)].filter((id) => Number.isInteger(id) && id > 0);
    this.db.transaction(() => {
      const keep = new Set(unique);
      for (const id of this.list(userId)) {
        if (!keep.has(id)) {
          this.db
            .prepare('DELETE FROM user_counters WHERE user_id = ? AND counter_id = ?')
            .run(userId, id);
        }
      }
      for (const id of unique) this.grant(userId, id, by);
    })();
    return this.list(userId);
  }

  /**
   * One-off upgrade grant (migration 013): while the marker row exists and a counter is
   * configured, every analyst gets access to that counter and the marker is consumed — so
   * analysts who could read the dashboard before ANA-29 keep doing so. Returns users granted.
   */
  applyLegacyGrant(counterId: number): number {
    if (this.legacyChecked || !(counterId > 0)) return 0;
    const pending = this.db.prepare('SELECT 1 FROM user_counters_legacy_grant WHERE id = 1').get();
    if (!pending) {
      this.legacyChecked = true;
      return 0;
    }
    let granted = 0;
    this.db.transaction(() => {
      const analysts = this.db
        .prepare("SELECT id FROM users WHERE role = 'analyst'")
        .all() as Array<{ id: number }>;
      for (const a of analysts) {
        if (!this.has(a.id, counterId)) {
          this.grant(a.id, counterId, 'migration:013');
          granted += 1;
        }
      }
      this.db.prepare('DELETE FROM user_counters_legacy_grant WHERE id = 1').run();
    })();
    this.legacyChecked = true;
    return granted;
  }
}
