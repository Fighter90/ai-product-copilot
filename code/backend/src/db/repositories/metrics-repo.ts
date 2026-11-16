import type { DB } from '../connection';
import { contiguousRanges, MS_PER_DAY, type DateChunk } from '../../utils/date-range';
import type {
  ChannelStat,
  DemoStatus,
  GeoDeviceStat,
  Goal,
  NewRawResponse,
  PageStat,
  RawResponse,
  UtmStat,
} from '@pca/shared';

interface GoalRow {
  id: number;
  name: string;
  type: string;
  is_b2b: number;
  is_archived: number;
  synced_at: string;
}

interface RawRow {
  id: number;
  endpoint: string;
  query_hash: string;
  date_from: string;
  date_to: string;
  payload: string;
  fetched_at: string;
}

interface ChannelRow {
  date: string;
  channel: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  visits: number;
  users: number;
  bounce_rate: number;
  avg_duration: number;
  goal_reaches: number;
  conversion_rate: number;
  is_demo: number;
}

interface UtmRow {
  date: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  visits: number;
  users: number;
  goal_reaches: number;
  conversion_rate: number;
  is_demo: number;
}

function toUtmStat(r: UtmRow): UtmStat {
  return {
    date: r.date,
    utmSource: r.utm_source,
    utmMedium: r.utm_medium,
    utmCampaign: r.utm_campaign,
    visits: r.visits,
    users: r.users,
    goalReaches: r.goal_reaches,
    conversionRate: r.conversion_rate,
    isDemo: r.is_demo === 1,
  };
}

interface GeoDeviceRow {
  date: string;
  country: string;
  device: string;
  visits: number;
  users: number;
  goal_reaches: number;
  conversion_rate: number;
  is_demo: number;
}

function toGeoDeviceStat(r: GeoDeviceRow): GeoDeviceStat {
  return {
    date: r.date,
    country: r.country,
    device: r.device,
    visits: r.visits,
    users: r.users,
    goalReaches: r.goal_reaches,
    conversionRate: r.conversion_rate,
    isDemo: r.is_demo === 1,
  };
}

interface PageRow {
  date: string;
  page: string;
  visits: number;
  users: number;
  bounce_rate: number;
  goal_reaches: number;
  conversion_rate: number;
  is_demo: number;
}

function toPageStat(r: PageRow): PageStat {
  return {
    date: r.date,
    page: r.page,
    visits: r.visits,
    users: r.users,
    bounceRate: r.bounce_rate,
    goalReaches: r.goal_reaches,
    conversionRate: r.conversion_rate,
    isDemo: r.is_demo === 1,
  };
}

function toGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    isB2b: r.is_b2b === 1,
    isArchived: r.is_archived === 1,
    syncedAt: r.synced_at,
  };
}

function toChannelStat(r: ChannelRow): ChannelStat {
  return {
    date: r.date,
    channel: r.channel,
    utmSource: r.utm_source,
    utmMedium: r.utm_medium,
    utmCampaign: r.utm_campaign,
    visits: r.visits,
    users: r.users,
    bounceRate: r.bounce_rate,
    avgDuration: r.avg_duration,
    goalReaches: r.goal_reaches,
    conversionRate: r.conversion_rate,
    isDemo: r.is_demo === 1,
  };
}

/**
 * ANA-154 (round 2): the cache hands the SAME mapped array — and the same element objects — to
 * every caller within the TTL, so an in-place caller mutation (rows.sort(), a numeric write)
 * would silently corrupt every later answer, including the KPI/B2B aggregates. Mapped stat rows
 * are flat primitives, so a shallow freeze is a complete one: a mutating caller throws (strict
 * mode) instead of poisoning the shared cache answer.
 */
function freezeMapped(rows: readonly unknown[]): void {
  Object.freeze(rows);
  for (const r of rows) Object.freeze(r);
}

/** Inclusive day count between two ISO dates (ANA-49). */
function coverageWindow(
  minDate: string,
  maxDate: string,
): { from: string; to: string; days: number } {
  const days =
    Math.round((new Date(maxDate).getTime() - new Date(minDate).getTime()) / 86_400_000) + 1; // inclusive both ends
  return { from: minDate, to: maxDate, days };
}

/**
 * ANA-148: TTL of the in-process derived-stats read cache (the issue allows 60–120s). A sync
 * invalidates explicitly, so the TTL is only a safety net for out-of-band writes (e.g. the
 * seeder running while a server stays up).
 */
export const STAT_CACHE_TTL_MS = 120_000;

/** Repository for Metrika-derived data: goals, raw API responses, channel stats. */
/** Rows removed by resetSyncedWindow(), keyed by table — see snapshotWindow(). */
export interface SyncedWindowBackup {
  readonly from: string;
  readonly to: string;
  readonly tables: Record<string, Record<string, unknown>[]>;
}

/**
 * ANA-153: options for the protected derived-stat writes. By default the zero-protection is ON:
 * the counter's statistics were RESET (~2026-11-06) while the real history was restored into
 * SQLite from raw_responses, so Metrika answers zeros for the pre-reset dates and a wide sync
 * must not turn them into the stored rows. Only an explicit admin action (CLI `pnpm sync
 * --force`, POST /api/sync `"force": true`) may bypass it.
 */
export interface UpsertOptions {
  /** Overwrite even a non-zero row with a zero one — admin-explicit only. */
  readonly force?: boolean;
}

/** ANA-153: what a protected stat-table upsert did. */
export interface UpsertOutcome {
  /** Rows actually written (inserted or replaced). */
  readonly written: number;
  /** Zero-visits rows skipped because the stored row for the same key carries real visits. */
  readonly skippedZero: number;
}

export class MetricsRepo {
  /** ANA-148: table+range → last computed rows; dropped by every write path below. */
  private readonly statCache = new Map<string, { at: number; rows: unknown[] }>();

  constructor(
    private readonly db: DB,
    /** Injectable clock (tests); keeps the TTL deterministic without sleeping. */
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * ANA-153 zero-protection decision: may the incoming row replace the stored one? A zero-visits
   * row (what Metrika answers for a date whose statistics were RESET) must never overwrite a
   * stored row that still carries real visits — that row is the ANA-150-restored history, and
   * once zeroed it is unrecoverable (the counter no longer serves those dates). Everything else
   * writes normally: a missing row, zero→zero, and any non-zero incoming row (a real re-sync
   * replacing old values by key stays a plain replace).
   */
  private mayWrite(
    existing: { visits: number } | undefined,
    incomingVisits: number,
    force: boolean,
  ): boolean {
    if (force || incomingVisits !== 0) return true;
    return existing === undefined || existing.visits === 0;
  }

  /**
   * ANA-153 audit: record a defended DATE (append-only, INSERT OR IGNORE — a date is protected
   * once no matter how many of its rows were skipped). GET /metrics/coverage reports the count
   * as protectedDays; the FilterBar shows «N дней защищены от перезаписи».
   */
  private noteProtectedDate(date: string): void {
    this.db.prepare('INSERT OR IGNORE INTO protected_days (date) VALUES (?)').run(date);
  }

  /** ANA-153: distinct dates zero-protection has defended (see the 023 migration). */
  countProtectedDays(): number {
    const key = 'coverage|protectedDays';
    const hit = this.statCache.get(key);
    if (hit && this.now() - hit.at < STAT_CACHE_TTL_MS) return hit.rows[0] as number;
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM protected_days').get() as { n: number };
    this.statCache.set(key, { at: this.now(), rows: [row.n] });
    return row.n;
  }

  upsertGoals(goals: readonly Goal[]): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO goals (id, name, type, is_b2b, is_archived, synced_at, is_demo)
       VALUES (@id, @name, @type, @is_b2b, @is_archived, @synced_at, @is_demo)`,
    );
    const tx = this.db.transaction((rows: readonly Goal[]) => {
      for (const g of rows) {
        stmt.run({
          id: g.id,
          name: g.name,
          type: g.type,
          is_b2b: g.isB2b ? 1 : 0,
          is_archived: g.isArchived ? 1 : 0,
          synced_at: g.syncedAt,
          is_demo: g.isDemo ? 1 : 0,
        });
      }
    });
    tx(goals);
  }

  listGoals(includeArchived = false): Goal[] {
    const sql = includeArchived
      ? 'SELECT * FROM goals ORDER BY id'
      : 'SELECT * FROM goals WHERE is_archived = 0 ORDER BY id';
    return (this.db.prepare(sql).all() as GoalRow[]).map(toGoal);
  }

  /** Idempotent cache write keyed by (query_hash, date_from, date_to). Returns the row id. */
  saveRawResponse(r: NewRawResponse): number {
    const row = this.db
      .prepare(
        `INSERT INTO raw_responses (endpoint, query_hash, date_from, date_to, payload, fetched_at)
         VALUES (@endpoint, @query_hash, @date_from, @date_to, @payload, @fetched_at)
         ON CONFLICT(query_hash, date_from, date_to) DO UPDATE SET
           endpoint = excluded.endpoint,
           payload = excluded.payload,
           fetched_at = excluded.fetched_at
         RETURNING id`,
      )
      .get({
        endpoint: r.endpoint,
        query_hash: r.queryHash,
        date_from: r.dateFrom,
        date_to: r.dateTo,
        payload: JSON.stringify(r.payload),
        fetched_at: r.fetchedAt,
      }) as { id: number };
    return row.id;
  }

  getRawResponse(id: number): RawResponse | undefined {
    const r = this.db.prepare('SELECT * FROM raw_responses WHERE id = ?').get(id) as
      RawRow | undefined;
    if (!r) return undefined;
    return {
      id: r.id,
      endpoint: r.endpoint,
      queryHash: r.query_hash,
      dateFrom: r.date_from,
      dateTo: r.date_to,
      payload: JSON.parse(r.payload),
      fetchedAt: r.fetched_at,
    };
  }

  /**
   * ANA-150: stream raw responses fully inside [from, to] (id order), payloads parsed lazily —
   * read-only access to the audit trail for the one-off history recovery, so thousands of stored
   * chunks never sit in memory at once. Never writes to raw_responses.
   */
  *iterateRawResponsesBetween(from: string, to: string): Generator<RawResponse> {
    const stmt = this.db.prepare(
      'SELECT * FROM raw_responses WHERE date_from >= ? AND date_to <= ? ORDER BY id',
    );
    for (const r of stmt.iterate(from, to) as IterableIterator<RawRow>) {
      yield {
        id: r.id,
        endpoint: r.endpoint,
        queryHash: r.query_hash,
        dateFrom: r.date_from,
        dateTo: r.date_to,
        payload: JSON.parse(r.payload),
        fetchedAt: r.fetched_at,
      };
    }
  }

  /** Derived per-period stat tables — all re-fetched on each sync. */
  private static readonly DERIVED_STAT_TABLES = [
    'channel_stats',
    'utm_stats',
    'geo_device_stats',
    'page_stats',
    'exit_page_stats',
  ] as const;

  /**
   * Full wipe of everything a sync re-fetches: the derived stat tables PLUS `goals` and
   * `raw_responses`. This guarantees a re-sync always produces a fresh, duplicate-free dataset
   * (SQLite treats NULL as distinct in composite keys, so INSERT OR REPLACE alone can't dedupe).
   *
   * PRESERVES user-entered data — `b2b_manual`, `hypotheses`, `decisions`, `report_snapshots` —
   * which is never sourced from Metrika and must survive a re-sync.
   */
  resetSyncedData(): void {
    const tables = [...MetricsRepo.DERIVED_STAT_TABLES, 'goals', 'raw_responses'];
    const tx = this.db.transaction(() => {
      for (const t of tables) this.db.prepare(`DELETE FROM ${t}`).run();
    });
    tx();
    this.invalidateStatCache();
  }

  /**
   * Windowed wipe used by every sync: removes only the rows the sync is about to re-fetch —
   * per-day stat rows inside [from, to], raw responses fully inside the window, and the goals
   * catalog (always reloaded in full). History OUTSIDE the window is preserved, so a scheduled
   * 14-day sync no longer erases a one-off 365-day backfill. Dedupe inside the window is still
   * guaranteed (the NULL-UTM composite-key caveat only matters for rows we re-insert).
   *
   * ANA-153: by default the stat-table part of the wipe only removes ZERO rows — the wipe runs
   * BEFORE the upserts, so an unrestricted delete would erase the restored non-zero history for
   * the pre-reset dates before the zero-protection in the upserts even gets a chance to defend
   * it. Every re-fetched row still replaces its stored predecessor by key (INSERT OR REPLACE /
   * the NULL-safe channel upsert), so the sync result is unchanged for live dates; only rows
   * Metrika stopped serving (or now serves as zeros) survive instead of being destroyed.
   * `{ force: true }` restores the unrestricted wipe for an admin-explicit re-sync.
   */
  resetSyncedWindow(from: string, to: string, opts: UpsertOptions = {}): void {
    const visitsGuard = opts.force === true ? '' : ' AND visits = 0';
    const tx = this.db.transaction(() => {
      for (const t of MetricsRepo.DERIVED_STAT_TABLES) {
        this.db
          .prepare(`DELETE FROM ${t} WHERE date >= ? AND date <= ?${visitsGuard}`)
          .run(from, to);
      }
      this.db
        .prepare('DELETE FROM raw_responses WHERE date_from >= ? AND date_to <= ?')
        .run(from, to);
      this.db.prepare('DELETE FROM goals').run();
    });
    tx();
    this.invalidateStatCache();
  }

  /** In-memory copy of everything resetSyncedWindow() would delete — restored if a sync fails. */
  snapshotWindow(from: string, to: string): SyncedWindowBackup {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const t of MetricsRepo.DERIVED_STAT_TABLES) {
      tables[t] = this.db
        .prepare(`SELECT * FROM ${t} WHERE date >= ? AND date <= ?`)
        .all(from, to) as Record<string, unknown>[];
    }
    tables.raw_responses = this.db
      .prepare('SELECT * FROM raw_responses WHERE date_from >= ? AND date_to <= ?')
      .all(from, to) as Record<string, unknown>[];
    tables.goals = this.db.prepare('SELECT * FROM goals').all() as Record<string, unknown>[];
    return { from, to, tables };
  }

  /**
   * Put back one table's window rows from a backup (the window part of that table is replaced).
   * Used when a sync step failed after the window was wiped — a failed/quota-limited sync must
   * never leave the cabinet with less data than before.
   */
  restoreWindowTable(backup: SyncedWindowBackup, table: string): void {
    this.invalidateStatCache();
    const rows = backup.tables[table];
    if (!rows) return;
    const tx = this.db.transaction(() => {
      if (table === 'goals') this.db.prepare('DELETE FROM goals').run();
      else if (table === 'raw_responses') {
        this.db
          .prepare('DELETE FROM raw_responses WHERE date_from >= ? AND date_to <= ?')
          .run(backup.from, backup.to);
      } else {
        this.db
          .prepare(`DELETE FROM ${table} WHERE date >= ? AND date <= ?`)
          .run(backup.from, backup.to);
      }
      for (const r of rows) {
        const cols = Object.keys(r);
        this.db
          .prepare(
            `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          )
          .run(...cols.map((c) => r[c]));
      }
    });
    tx();
  }

  /** Restore the whole window (all tables) from a backup. */
  restoreWindow(backup: SyncedWindowBackup): void {
    for (const t of Object.keys(backup.tables)) this.restoreWindowTable(backup, t);
  }

  /**
   * ANA-153: protected channel_stats upsert. The sync's rows are NULL-UTM keyed (traffic-by-source
   * queries carry no UTM dimensions) and SQLite treats NULLs as DISTINCT inside the
   * (date, channel, utm_source, utm_medium, utm_campaign) key, so plain INSERT OR REPLACE can
   * never match an existing row — every write here first deletes the matching NULL-safe key row
   * (the former upsertChannelStatsNullSafe behaviour, ANA-150) and then inserts. With the ANA-153
   * protected wipe (resetSyncedWindow keeps non-zero rows) this is what makes a re-sync replace
   * the stored rows instead of doubling them.
   *
   * Zero-protection: a zero-visits row skips BOTH the delete and the insert when the stored row
   * for the same key carries real visits (the ANA-150-restored history), and the defended date
   * is audited (protected_days). `{ force: true }` writes unconditionally.
   */
  upsertChannelStats(rows: readonly ChannelStat[], opts: UpsertOptions = {}): UpsertOutcome {
    const force = opts.force === true;
    const existing = this.db.prepare(
      `SELECT visits FROM channel_stats
       WHERE date = ? AND channel = ?
         AND utm_source IS ? AND utm_medium IS ? AND utm_campaign IS ?`,
    );
    const del = this.db.prepare(
      `DELETE FROM channel_stats
       WHERE date = ? AND channel = ?
         AND utm_source IS ? AND utm_medium IS ? AND utm_campaign IS ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO channel_stats
         (date, channel, utm_source, utm_medium, utm_campaign, visits, users,
          bounce_rate, avg_duration, goal_reaches, conversion_rate, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let written = 0;
    let skippedZero = 0;
    const tx = this.db.transaction((items: readonly ChannelStat[]) => {
      for (const c of items) {
        const key = [
          c.date,
          c.channel,
          c.utmSource ?? null,
          c.utmMedium ?? null,
          c.utmCampaign ?? null,
        ];
        const cur = existing.get(...key) as { visits: number } | undefined;
        if (!this.mayWrite(cur, c.visits, force)) {
          skippedZero += 1;
          this.noteProtectedDate(c.date);
          continue;
        }
        del.run(...key);
        ins.run(
          c.date,
          c.channel,
          c.utmSource,
          c.utmMedium,
          c.utmCampaign,
          c.visits,
          c.users,
          c.bounceRate,
          c.avgDuration,
          c.goalReaches,
          c.conversionRate,
          c.isDemo ? 1 : 0,
        );
        written += 1;
      }
    });
    tx(rows);
    this.invalidateStatCache();
    return { written, skippedZero };
  }

  /**
   * ANA-142: does the scope (whole table, or the [from, to] range) contain at least one live
   * (is_demo = 0) row? Live rows win over the seeded demo dataset in every read path.
   */
  private hasLiveRows(table: string, range?: { from: string; to: string }): boolean {
    const row = range
      ? this.db
          .prepare(`SELECT 1 FROM ${table} WHERE date >= ? AND date <= ? AND is_demo = 0 LIMIT 1`)
          .get(range.from, range.to)
      : this.db.prepare(`SELECT 1 FROM ${table} WHERE is_demo = 0 LIMIT 1`).get();
    return row !== undefined;
  }

  /**
   * ANA-142: SELECT for a derived stat table — live rows win. When the scope contains any live
   * (is_demo = 0) rows, only they come back: seeded demo history (prod had 2025-04-29..2025-12-31)
   * must never blend into real Metrika reads and distort trends/KPIs. A demo-only scope (fresh
   * ./run.sh without a token) still serves the demo dataset so the cabinet stays usable — the
   * mappers keep isDemo on those rows so the UI can badge them «ДЕМО».
   *
   * Reads go through a small in-process TTL cache keyed by table+range (ANA-148): the dashboard
   * polls /metrics/utm repeatedly and the 1-CPU prod served each poll with a fresh query. The
   * cache holds exactly what a fresh read returned (anti-hallucination: numbers stay traceable
   * to SQLite), and every write path drops it via invalidateStatCache().
   *
   * ANA-154: the ROW→API mapping (toChannelStat & co.) runs inside the cached path — the cache
   * stores the mapped API rows, so a repeated GET neither re-queries SQLite nor re-maps tens of
   * thousands of rows (564-day history) per request. The cached array is frozen (see
   * freezeMapped): a mutating caller fails loudly instead of corrupting the shared answer.
   */
  private selectMapped<Raw, Out>(
    table: string,
    map: (rows: Raw[]) => Out[],
    range?: { from: string; to: string },
  ): readonly Out[] {
    const key = `${table}|${range ? `${range.from}..${range.to}` : 'all'}`;
    const hit = this.statCache.get(key);
    if (hit && this.now() - hit.at < STAT_CACHE_TTL_MS) return hit.rows as Out[];
    const live = this.hasLiveRows(table, range);
    const demoFilter = live ? 'is_demo = 0' : '';
    const rangeFilter = range ? 'date >= ? AND date <= ?' : '';
    const where = [demoFilter, rangeFilter].filter(Boolean).join(' AND ');
    const sql = `SELECT * FROM ${table}${where ? ` WHERE ${where}` : ''} ORDER BY date`;
    const raw = (
      range ? this.db.prepare(sql).all(range.from, range.to) : this.db.prepare(sql).all()
    ) as Raw[];
    const rows = map(raw);
    freezeMapped(rows as unknown[]);
    this.statCache.set(key, { at: this.now(), rows: rows as unknown[] });
    return rows;
  }

  /**
   * ANA-148/154: every write into the derived stat tables drops the WHOLE read cache — the
   * per-table/range keys AND the ANA-154 `coverage|window` / `coverage|tables` answers
   * (Map.clear, deliberately not key-selective, so a sync's new window is visible to the
   * coverage/ДЕМО logic on the very next read, not past the TTL).
   */
  private invalidateStatCache(): void {
    this.statCache.clear();
  }

  listChannelStats(range?: { from: string; to: string }): readonly ChannelStat[] {
    return this.selectMapped<ChannelRow, ChannelStat>(
      'channel_stats',
      (rows) => rows.map(toChannelStat),
      range,
    );
  }

  /**
   * ANA-150: NULL-safe channel_stats upsert. SQLite treats NULLs as DISTINCT inside the
   * (date, channel, utm_source, utm_medium, utm_campaign) key, so plain INSERT OR REPLACE cannot
   * match an existing row whose UTM columns are NULL. ANA-153: the plain upsert IS the NULL-safe
   * one now (see {@link upsertChannelStats}) — this alias stays for the history recovery call
   * site (and its ANA-150 tests); protection and the optional force bypass apply identically.
   */
  upsertChannelStatsNullSafe(
    rows: readonly ChannelStat[],
    opts: UpsertOptions = {},
  ): UpsertOutcome {
    return this.upsertChannelStats(rows, opts);
  }

  /**
   * ANA-153: zero-protection on the NOT-NULL-key stat tables (utm/geo/pages/exits): a zero-visits
   * row skips the write when the stored row for the same key carries real visits (restored
   * history), and the defended date is audited. `{ force: true }` writes unconditionally.
   */
  upsertUtmStats(rows: readonly UtmStat[], opts: UpsertOptions = {}): UpsertOutcome {
    const force = opts.force === true;
    const existing = this.db.prepare(
      `SELECT visits FROM utm_stats
       WHERE date = ? AND utm_source IS ? AND utm_medium IS ? AND utm_campaign IS ?`,
    );
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO utm_stats
         (date, utm_source, utm_medium, utm_campaign, visits, users, goal_reaches, conversion_rate, is_demo)
       VALUES (@date, @utm_source, @utm_medium, @utm_campaign, @visits, @users,
          @goal_reaches, @conversion_rate, @is_demo)`,
    );
    let written = 0;
    let skippedZero = 0;
    const tx = this.db.transaction((items: readonly UtmStat[]) => {
      for (const u of items) {
        const cur = existing.get(
          u.date,
          u.utmSource ?? null,
          u.utmMedium ?? null,
          u.utmCampaign ?? null,
        ) as { visits: number } | undefined;
        if (!this.mayWrite(cur, u.visits, force)) {
          skippedZero += 1;
          this.noteProtectedDate(u.date);
          continue;
        }
        stmt.run({
          date: u.date,
          utm_source: u.utmSource,
          utm_medium: u.utmMedium,
          utm_campaign: u.utmCampaign,
          visits: u.visits,
          users: u.users,
          goal_reaches: u.goalReaches,
          conversion_rate: u.conversionRate,
          is_demo: u.isDemo ? 1 : 0,
        });
        written += 1;
      }
    });
    tx(rows);
    this.invalidateStatCache();
    return { written, skippedZero };
  }

  listUtmStats(range?: { from: string; to: string }): readonly UtmStat[] {
    return this.selectMapped<UtmRow, UtmStat>('utm_stats', (rows) => rows.map(toUtmStat), range);
  }

  upsertGeoDeviceStats(rows: readonly GeoDeviceStat[], opts: UpsertOptions = {}): UpsertOutcome {
    const force = opts.force === true;
    const existing = this.db.prepare(
      'SELECT visits FROM geo_device_stats WHERE date = ? AND country = ? AND device = ?',
    );
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO geo_device_stats
         (date, country, device, visits, users, goal_reaches, conversion_rate, is_demo)
       VALUES (@date, @country, @device, @visits, @users, @goal_reaches, @conversion_rate, @is_demo)`,
    );
    let written = 0;
    let skippedZero = 0;
    const tx = this.db.transaction((items: readonly GeoDeviceStat[]) => {
      for (const g of items) {
        const cur = existing.get(g.date, g.country, g.device) as { visits: number } | undefined;
        if (!this.mayWrite(cur, g.visits, force)) {
          skippedZero += 1;
          this.noteProtectedDate(g.date);
          continue;
        }
        stmt.run({
          date: g.date,
          country: g.country,
          device: g.device,
          visits: g.visits,
          users: g.users,
          goal_reaches: g.goalReaches,
          conversion_rate: g.conversionRate,
          is_demo: g.isDemo ? 1 : 0,
        });
        written += 1;
      }
    });
    tx(rows);
    this.invalidateStatCache();
    return { written, skippedZero };
  }

  listGeoDeviceStats(range?: { from: string; to: string }): readonly GeoDeviceStat[] {
    return this.selectMapped<GeoDeviceRow, GeoDeviceStat>(
      'geo_device_stats',
      (rows) => rows.map(toGeoDeviceStat),
      range,
    );
  }

  upsertPageStats(rows: readonly PageStat[], opts: UpsertOptions = {}): UpsertOutcome {
    const force = opts.force === true;
    const existing = this.db.prepare('SELECT visits FROM page_stats WHERE date = ? AND page = ?');
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO page_stats
         (date, page, visits, users, bounce_rate, goal_reaches, conversion_rate, is_demo)
       VALUES (@date, @page, @visits, @users, @bounce_rate, @goal_reaches, @conversion_rate, @is_demo)`,
    );
    let written = 0;
    let skippedZero = 0;
    const tx = this.db.transaction((items: readonly PageStat[]) => {
      for (const p of items) {
        const cur = existing.get(p.date, p.page) as { visits: number } | undefined;
        if (!this.mayWrite(cur, p.visits, force)) {
          skippedZero += 1;
          this.noteProtectedDate(p.date);
          continue;
        }
        stmt.run({
          date: p.date,
          page: p.page,
          visits: p.visits,
          users: p.users,
          bounce_rate: p.bounceRate,
          goal_reaches: p.goalReaches,
          conversion_rate: p.conversionRate,
          is_demo: p.isDemo ? 1 : 0,
        });
        written += 1;
      }
    });
    tx(rows);
    this.invalidateStatCache();
    return { written, skippedZero };
  }

  listPageStats(range?: { from: string; to: string }): readonly PageStat[] {
    return this.selectMapped<PageRow, PageStat>(
      'page_stats',
      (rows) => rows.map(toPageStat),
      range,
    );
  }

  upsertExitPageStats(rows: readonly PageStat[], opts: UpsertOptions = {}): UpsertOutcome {
    const force = opts.force === true;
    const existing = this.db.prepare(
      'SELECT visits FROM exit_page_stats WHERE date = ? AND page = ?',
    );
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO exit_page_stats
         (date, page, visits, users, bounce_rate, goal_reaches, conversion_rate, is_demo)
       VALUES (@date, @page, @visits, @users, @bounce_rate, @goal_reaches, @conversion_rate, @is_demo)`,
    );
    let written = 0;
    let skippedZero = 0;
    const tx = this.db.transaction((items: readonly PageStat[]) => {
      for (const p of items) {
        const cur = existing.get(p.date, p.page) as { visits: number } | undefined;
        if (!this.mayWrite(cur, p.visits, force)) {
          skippedZero += 1;
          this.noteProtectedDate(p.date);
          continue;
        }
        stmt.run({
          date: p.date,
          page: p.page,
          visits: p.visits,
          users: p.users,
          bounce_rate: p.bounceRate,
          goal_reaches: p.goalReaches,
          conversion_rate: p.conversionRate,
          is_demo: p.isDemo ? 1 : 0,
        });
        written += 1;
      }
    });
    tx(rows);
    this.invalidateStatCache();
    return { written, skippedZero };
  }

  listExitPageStats(range?: { from: string; to: string }): readonly PageStat[] {
    return this.selectMapped<PageRow, PageStat>(
      'exit_page_stats',
      (rows) => rows.map(toPageStat),
      range,
    );
  }

  /**
   * Cached data coverage (ANA-49): the first and the last synced day across the per-day stat
   * tables. The FilterBar compares the selected period against it and offers «Догрузить N дней»
   * when the selection starts before the cache. `null` while nothing has been synced yet.
   *
   * ANA-142: the KPI base is the REAL data window — live (is_demo = 0) rows win. The seeded demo
   * «history» (prod had 2025-04-29..2025-12-31 while the counter only lives from its first real
   * day) must not stretch «данных N дней». A demo-only DB (fresh ./run.sh without a token) falls
   * back to the demo window so the cabinet keeps working, flagged by the ДЕМО banner.
   *
   * ANA-154: the whole-window MIN/MAX scans sit behind every filter-page mount and every snapshot
   * build; with the restored 564-day history each call re-scanned the stat tables on the 1-CPU
   * prod. The answer shares the ANA-148 statCache — every write path already invalidates it —
   * and is frozen like the cached stat rows (shared-object hazard, see freezeMapped).
   */
  statsCoverage(): { from: string; to: string; days: number } | null {
    const key = 'coverage|window';
    const hit = this.statCache.get(key);
    if (hit && this.now() - hit.at < STAT_CACHE_TTL_MS) {
      return (hit.rows[0] as { from: string; to: string; days: number } | null) ?? null;
    }
    const minMax = (where: string): { min_date: string | null; max_date: string | null } =>
      this.db
        .prepare(`SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM channel_stats ${where}`)
        .get() as { min_date: string | null; max_date: string | null };
    const live = minMax('WHERE is_demo = 0');
    let result: { from: string; to: string; days: number } | null = null;
    if (live.min_date && live.max_date) result = coverageWindow(live.min_date, live.max_date);
    else {
      const any = minMax('');
      if (any.min_date && any.max_date) result = coverageWindow(any.min_date, any.max_date);
    }
    this.statCache.set(key, { at: this.now(), rows: [Object.freeze(result)] });
    return result;
  }

  /**
   * ANA-139: per-table min/max of every derived stat table. The channel window alone can look
   * complete while utm_stats/geo/pages lag behind days or weeks (the optional sync steps are
   * best-effort and get skipped on failures) — GET /metrics/coverage reports the per-table
   * window so the FilterBar can surface the gap and offer a re-sync of the selected period.
   *
   * ANA-142: per table, live (is_demo = 0) rows win; a demo-only table falls back to its demo
   * window — same rule as statsCoverage().
   *
   * ANA-154: cached like statsCoverage() — 10 whole-table MIN/MAX scans per call, behind every
   * FilterBar mount; shared statCache, invalidated by every write path. The answer is frozen
   * (per-table windows + the record itself) like every cached stat read — see freezeMapped.
   */
  statsCoverageTables(): Record<string, { from: string; to: string } | null> {
    const key = 'coverage|tables';
    const hit = this.statCache.get(key);
    if (hit && this.now() - hit.at < STAT_CACHE_TTL_MS) {
      return hit.rows[0] as Record<string, { from: string; to: string } | null>;
    }
    const sources: Array<[string, string]> = [
      ['channels', 'channel_stats'],
      ['utm', 'utm_stats'],
      ['geoDevice', 'geo_device_stats'],
      ['pages', 'page_stats'],
      ['exitPages', 'exit_page_stats'],
    ];
    const out: Record<string, { from: string; to: string } | null> = {};
    for (const [keyTable, table] of sources) {
      const minMax = (where: string): { min_date: string | null; max_date: string | null } =>
        this.db
          .prepare(`SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM ${table} ${where}`)
          .get() as { min_date: string | null; max_date: string | null };
      const live = minMax('WHERE is_demo = 0');
      const win = live.min_date && live.max_date ? live : minMax('');
      out[keyTable] =
        win.min_date && win.max_date ? { from: win.min_date, to: win.max_date } : null;
    }
    for (const v of Object.values(out)) Object.freeze(v); // per-table windows freeze too
    Object.freeze(out);
    this.statCache.set(key, { at: this.now(), rows: [out] });
    return out;
  }

  /**
   * ANA-139 (12.11 prod feedback): the missing DAYS of every derived stat table inside a window —
   * per-table min/max (`statsCoverageTables`) cannot show a hole INSIDE a window: utm_stats can
   * carry day 1 and day 14 while days 2..13 are missing (an optional sync step failed on the days
   * the local machine was off), and the dashboard shows an empty UTM breakdown while Metrika has
   * the data. Each hole is reported as a contiguous [from, to] range — exactly the window a refill
   * sync must pull («дыры → дозагрузка»), so the good history around the hole is never re-fetched
   * or rewritten (idempotent refill).
   *
   * ANA-142: live (is_demo = 0) rows win per table, same rule as statsCoverageTables — when a
   * table holds ANY live row, its demo rows are noise and do not count as covered days.
   *
   * ANA-154: cached per (from, to) window in the shared statCache, frozen like every cached stat
   * read; every write path invalidates it (invalidateStatCache clears the whole map).
   */
  statsCoverageGaps(from: string, to: string): Record<string, DateChunk[]> {
    const key = `gaps|${from}|${to}`;
    const hit = this.statCache.get(key);
    if (hit && this.now() - hit.at < STAT_CACHE_TTL_MS) {
      return hit.rows[0] as Record<string, DateChunk[]>;
    }
    const sources: Array<[string, string]> = [
      ['channels', 'channel_stats'],
      ['utm', 'utm_stats'],
      ['geoDevice', 'geo_device_stats'],
      ['pages', 'page_stats'],
      ['exitPages', 'exit_page_stats'],
    ];
    const out: Record<string, DateChunk[]> = {};
    for (const [keyTable, table] of sources) {
      const hasLive = this.db
        .prepare(`SELECT EXISTS(SELECT 1 FROM ${table} WHERE is_demo = 0) AS live`)
        .get() as { live: number };
      const demoFilter = hasLive.live ? 'AND is_demo = 0' : '';
      const rows = this.db
        .prepare(
          `SELECT DISTINCT date FROM ${table}
           WHERE date >= ? AND date <= ? ${demoFilter}
           ORDER BY date`,
        )
        .all(from, to) as Array<{ date: string }>;
      // Every window day minus the covered ones → contiguous refill windows.
      const covered = new Set(rows.map((r) => r.date));
      const missing: string[] = [];
      for (
        let t = new Date(`${from}T00:00:00Z`).getTime();
        t <= new Date(`${to}T00:00:00Z`).getTime();
        t += MS_PER_DAY
      ) {
        const day = new Date(t).toISOString().slice(0, 10);
        if (!covered.has(day)) missing.push(day);
      }
      out[keyTable] = contiguousRanges(missing);
    }
    for (const ranges of Object.values(out)) {
      Object.freeze(ranges);
      for (const r of ranges) Object.freeze(r);
    }
    Object.freeze(out);
    this.statCache.set(key, { at: this.now(), rows: [out] });
    return out;
  }

  /**
   * ANA-18: count of `is_demo = 1` rows per dataset — drives the «Демо-данные» banner
   * (GET /api/demo/status). All-zero counts → demo: false.
   */
  demoStatus(): DemoStatus {
    const tables: Array<[string, string]> = [
      ['channels', 'channel_stats'],
      ['utm', 'utm_stats'],
      ['geoDevice', 'geo_device_stats'],
      ['pages', 'page_stats'],
      ['exitPages', 'exit_page_stats'],
      ['goals', 'goals'],
      ['b2b', 'b2b_manual'],
      ['b2c', 'b2c_payments'],
      ['hypotheses', 'hypotheses'],
      ['decisions', 'decisions'],
    ];
    const counts: Record<string, number> = {};
    let total = 0;
    for (const [key, table] of tables) {
      const n = (
        this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE is_demo = 1`).all() as Array<{
          n: number;
        }>
      )[0]?.n;
      counts[key] = n ?? 0;
      total += n ?? 0;
    }
    return { demo: total > 0, counts };
  }

  /**
   * ANA-18: wipe every demo-marked row across all tables. Called after a successful sync — real
   * Metrika data has arrived, so the made-up seed dataset must not mix into the KPIs anymore.
   * Live (is_demo = 0) rows are never touched. Decisions are deleted before their hypotheses.
   */
  deleteDemoRows(): void {
    const tables = [
      'channel_stats',
      'utm_stats',
      'geo_device_stats',
      'page_stats',
      'exit_page_stats',
      'goals',
      'b2b_manual',
      'b2c_payments',
      'decisions',
      'hypotheses',
    ];
    const tx = this.db.transaction(() => {
      for (const t of tables) this.db.prepare(`DELETE FROM ${t} WHERE is_demo = 1`).run();
    });
    tx();
    this.invalidateStatCache();
  }
}
