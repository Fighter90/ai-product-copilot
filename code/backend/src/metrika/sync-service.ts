import { selectPrimaryGoal, type Goal } from '@pca/shared';
import type { ChannelStat, GeoDeviceStat, PageStat, SyncStepError, UtmStat } from '@pca/shared';
import type { MetricsRepo, UpsertOptions } from '../db/repositories/metrics-repo';
import { dayChunks } from '../utils/date-range';
import { RANGE_MAX_DAYS } from './queries/date-dimension';
import { stableHash } from '../utils/hash';
import type { MetrikaClient } from './client';
import { ENDPOINTS } from './endpoints';
import { GoalsResponseSchema, type GoalsResponse } from './schemas';
import { trafficBySource, mergeChannelStats } from './queries/traffic-by-source';
import { utmBreakdown, mergeUtmStats } from './queries/utm-breakdown';
import { geoDeviceBreakdown, mergeGeoDeviceStats } from './queries/geo-device-breakdown';
import { pageBehavior } from './queries/page-behavior';
import { exitPageBehavior } from './queries/exit-page-behavior';
import { mergePageStats } from './queries/normalize-page';
import {
  batchGoalIds,
  goalReachesByDay,
  mergeGoalDayRows,
  type GoalDayRow,
} from './queries/goal-reaches-by-day';
import { browserOsBreakdown, mergeBrowserOsStats } from './queries/browser-os-breakdown';
import { newReturningBreakdown, mergeNewReturningStats } from './queries/new-returning';

export interface SyncDeps {
  readonly client: MetrikaClient;
  readonly metrics: MetricsRepo;
  readonly counterId: number;
  /**
   * FALLBACK archive heuristic (§5.5) used only when a goal carries neither Metrika's own
   * `archived` flag nor a `status` field — both are authoritative when present (ANA-23).
   */
  readonly archivedThreshold: number;
  /** ISO timestamp source (injectable for deterministic tests). */
  readonly now: () => string;
}

export interface SyncSummary {
  readonly goals: number;
  /**
   * The goal id whose reaches were synced. Either the explicit goalId passed in, or — when none was
   * given — the primary KPI goal auto-detected from the goals list ({@link selectPrimaryGoal}), or
   * undefined if neither applies (no KPI-looking goal found → goal metrics skipped).
   */
  readonly resolvedGoalId: number | undefined;
  readonly days: number;
  readonly channelRows: number;
  readonly utmRows: number;
  readonly geoDeviceRows: number;
  readonly pageRows: number;
  readonly exitPageRows: number;
  /**
   * (date, goal) reach pairs synced from bytime — one request per batch of ≤10 goals.
   * Optional for backward compatibility with existing SyncSummary literals (0/undefined = skipped).
   */
  readonly goalReachesRows?: number;
  readonly browserOsRows?: number;
  readonly newReturningRows?: number;
  /**
   * ANA-153: zero-visits rows skipped by zero-protection across the five stat tables — a wide
   * sync over the reset counter (Metrika answers zeros for the pre-reset dates) leaves the
   * restored non-zero history intact; `0`/undefined = nothing needed protection. The defended
   * dates are audited in `protected_days` and surfaced via /metrics/coverage protectedDays.
   */
  readonly skippedZero?: number;
  /**
   * ANA-15: per-step failures of the optional (`best`) steps — surfaced in the sync status UI
   * (GET /api/sync/status) instead of living only in console output. Empty when every step passed.
   */
  readonly errors?: SyncStepError[];
}

/** Pulls Metrika data into SQLite: raw responses (for traceability) + derived channel stats. */
export class SyncService {
  constructor(private readonly deps: SyncDeps) {}

  /**
   * Archive state of a goal. Metrika's own `archived` flag / `status` ("Active"/"Archived") wins;
   * only when the API provides neither does the legacy id-threshold fallback apply. On counter
   * 54280963 every goal id is ≥ 173M, so the threshold alone flagged nothing — and the admin UI
   * showed the same 163 goals in both the active and archive views (ANA-23).
   */
  private isArchived(g: GoalsResponse['goals'][number]): boolean {
    if (g.archived !== undefined) return g.archived;
    if (g.status !== undefined) return g.status.trim().toLowerCase() !== 'active';
    return g.id < this.deps.archivedThreshold;
  }

  /** Fetch + map goals from the API without persisting — lets callers validate auth before any write. */
  private async fetchGoals(): Promise<Goal[]> {
    const res = await this.deps.client.get(
      ENDPOINTS.goals(this.deps.counterId),
      {},
      GoalsResponseSchema,
    );
    return res.goals.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      isB2b: false,
      isArchived: this.isArchived(g),
      syncedAt: this.deps.now(),
    }));
  }

  async syncGoals(): Promise<Goal[]> {
    const goals = await this.fetchGoals();
    this.deps.metrics.upsertGoals(goals);
    return goals;
  }

  /**
   * Accumulate rows across the day chunks and upsert ONE merged batch per table: rows are
   * deduplicated on the table's natural key before the write (ANA-16), so a re-run or repeated
   * keys can never inflate the tables with duplicates.
   */
  async syncTraffic(
    from: string,
    to: string,
    goalId?: number,
    opts: UpsertOptions = {},
  ): Promise<{ days: number; rows: number; truncated?: boolean; skippedZero: number }> {
    const chunks = dayChunks(from, to);
    const acc: ChannelStat[] = [];
    let truncated = false;
    if (chunks.length <= RANGE_MAX_DAYS) {
      // ANA-113: одно range-обращение на всё окно (`ym:s:date`) вместо запроса на каждый
      // день — квота Метрики (quota_requests_by_uid, 5000/сутки) тратится на данные,
      // а не на per-day чанки.
      const { raw, stats } = await trafficBySource(this.deps.client, {
        counterId: this.deps.counterId,
        from,
        to,
        goalId,
        dateDimension: true,
      });
      this.deps.metrics.saveRawResponse({
        endpoint: ENDPOINTS.statData,
        queryHash: stableHash({ q: 'traffic-by-source', goalId, from, to }),
        dateFrom: from,
        dateTo: to,
        payload: raw,
        fetchedAt: this.deps.now(),
      });
      acc.push(...stats);
      if (raw.total_rows !== undefined && raw.total_rows > raw.data.length) {
        console.warn(
          `[sync] traffic-by-source: range-ответ усечён (${raw.data.length}/${raw.total_rows} строк) — окно неполное`,
        );
        truncated = true;
      }
    } else {
      // Широкие окна — прежний цикл per-day: у больших диапазонов row-cap range-ответа
      // может не хватить (10 000 строк).
      for (const chunk of chunks) {
        const { raw, stats } = await trafficBySource(this.deps.client, {
          counterId: this.deps.counterId,
          from: chunk.from,
          to: chunk.to,
          goalId,
        });
        this.deps.metrics.saveRawResponse({
          endpoint: ENDPOINTS.statData,
          queryHash: stableHash({ q: 'traffic-by-source', goalId, from: chunk.from, to: chunk.to }),
          dateFrom: chunk.from,
          dateTo: chunk.to,
          payload: raw,
          fetchedAt: this.deps.now(),
        });
        acc.push(...stats);
      }
    }
    const merged = mergeChannelStats(acc);
    const { skippedZero } = this.deps.metrics.upsertChannelStats(merged, opts);
    return { days: chunks.length, rows: merged.length, truncated, skippedZero };
  }

  async syncUtm(
    from: string,
    to: string,
    goalId?: number,
    opts: UpsertOptions = {},
  ): Promise<{ rows: number; truncated?: boolean; skippedZero: number }> {
    const chunks = dayChunks(from, to);
    const acc: UtmStat[] = [];
    let truncated = false;
    if (chunks.length <= RANGE_MAX_DAYS) {
      // ANA-113: одно range-обращение на всё окно (`ym:s:date`) вместо запроса на каждый
      // день — квота Метрики (quota_requests_by_uid, 5000/сутки) тратится на данные,
      // а не на per-day чанки.
      const { raw, stats } = await utmBreakdown(this.deps.client, {
        counterId: this.deps.counterId,
        from,
        to,
        goalId,
        dateDimension: true,
      });
      this.deps.metrics.saveRawResponse({
        endpoint: ENDPOINTS.statData,
        queryHash: stableHash({ q: 'utm-breakdown', goalId, from, to }),
        dateFrom: from,
        dateTo: to,
        payload: raw,
        fetchedAt: this.deps.now(),
      });
      acc.push(...stats);
      if (raw.total_rows !== undefined && raw.total_rows > raw.data.length) {
        console.warn(
          `[sync] utm-breakdown: range-ответ усечён (${raw.data.length}/${raw.total_rows} строк) — окно неполное`,
        );
        truncated = true;
      }
    } else {
      // Широкие окна — прежний цикл per-day: у больших диапазонов row-cap range-ответа
      // может не хватить (10 000 строк).
      for (const chunk of chunks) {
        const { raw, stats } = await utmBreakdown(this.deps.client, {
          counterId: this.deps.counterId,
          from: chunk.from,
          to: chunk.to,
          goalId,
        });
        this.deps.metrics.saveRawResponse({
          endpoint: ENDPOINTS.statData,
          queryHash: stableHash({ q: 'utm-breakdown', goalId, from: chunk.from, to: chunk.to }),
          dateFrom: chunk.from,
          dateTo: chunk.to,
          payload: raw,
          fetchedAt: this.deps.now(),
        });
        acc.push(...stats);
      }
    }
    const merged = mergeUtmStats(acc);
    const { skippedZero } = this.deps.metrics.upsertUtmStats(merged, opts);
    return { rows: merged.length, truncated, skippedZero };
  }

  async syncGeoDevice(
    from: string,
    to: string,
    goalId?: number,
    opts: UpsertOptions = {},
  ): Promise<{ rows: number; truncated?: boolean; skippedZero: number }> {
    const chunks = dayChunks(from, to);
    const acc: GeoDeviceStat[] = [];
    let truncated = false;
    if (chunks.length <= RANGE_MAX_DAYS) {
      // ANA-113: одно range-обращение на всё окно (`ym:s:date`) вместо запроса на каждый
      // день — квота Метрики (quota_requests_by_uid, 5000/сутки) тратится на данные,
      // а не на per-day чанки.
      const { raw, stats } = await geoDeviceBreakdown(this.deps.client, {
        counterId: this.deps.counterId,
        from,
        to,
        goalId,
        dateDimension: true,
      });
      this.deps.metrics.saveRawResponse({
        endpoint: ENDPOINTS.statData,
        queryHash: stableHash({ q: 'geo-device', goalId, from, to }),
        dateFrom: from,
        dateTo: to,
        payload: raw,
        fetchedAt: this.deps.now(),
      });
      acc.push(...stats);
      if (raw.total_rows !== undefined && raw.total_rows > raw.data.length) {
        console.warn(
          `[sync] geo-device: range-ответ усечён (${raw.data.length}/${raw.total_rows} строк) — окно неполное`,
        );
        truncated = true;
      }
    } else {
      // Широкие окна — прежний цикл per-day: у больших диапазонов row-cap range-ответа
      // может не хватить (10 000 строк).
      for (const chunk of chunks) {
        const { raw, stats } = await geoDeviceBreakdown(this.deps.client, {
          counterId: this.deps.counterId,
          from: chunk.from,
          to: chunk.to,
          goalId,
        });
        this.deps.metrics.saveRawResponse({
          endpoint: ENDPOINTS.statData,
          queryHash: stableHash({ q: 'geo-device', goalId, from: chunk.from, to: chunk.to }),
          dateFrom: chunk.from,
          dateTo: chunk.to,
          payload: raw,
          fetchedAt: this.deps.now(),
        });
        acc.push(...stats);
      }
    }
    const merged = mergeGeoDeviceStats(acc);
    const { skippedZero } = this.deps.metrics.upsertGeoDeviceStats(merged, opts);
    return { rows: merged.length, truncated, skippedZero };
  }

  async syncPages(
    from: string,
    to: string,
    goalId?: number,
    opts: UpsertOptions = {},
  ): Promise<{ rows: number; skippedZero: number }> {
    const chunks = dayChunks(from, to);
    const acc: PageStat[] = [];
    for (const chunk of chunks) {
      const { raw, stats } = await pageBehavior(this.deps.client, {
        counterId: this.deps.counterId,
        from: chunk.from,
        to: chunk.to,
        goalId,
      });
      this.deps.metrics.saveRawResponse({
        endpoint: ENDPOINTS.statData,
        queryHash: stableHash({ q: 'page-behavior', goalId, from: chunk.from, to: chunk.to }),
        dateFrom: chunk.from,
        dateTo: chunk.to,
        payload: raw,
        fetchedAt: this.deps.now(),
      });
      acc.push(...stats);
    }
    const merged = mergePageStats(acc);
    const { skippedZero } = this.deps.metrics.upsertPageStats(merged, opts);
    return { rows: merged.length, skippedZero };
  }

  async syncExitPages(
    from: string,
    to: string,
    goalId?: number,
    opts: UpsertOptions = {},
  ): Promise<{ rows: number; skippedZero: number }> {
    const chunks = dayChunks(from, to);
    const acc: PageStat[] = [];
    for (const chunk of chunks) {
      const { raw, stats } = await exitPageBehavior(this.deps.client, {
        counterId: this.deps.counterId,
        from: chunk.from,
        to: chunk.to,
        goalId,
      });
      this.deps.metrics.saveRawResponse({
        endpoint: ENDPOINTS.statData,
        queryHash: stableHash({ q: 'exit-page-behavior', goalId, from: chunk.from, to: chunk.to }),
        dateFrom: chunk.from,
        dateTo: chunk.to,
        payload: raw,
        fetchedAt: this.deps.now(),
      });
      acc.push(...stats);
    }
    const merged = mergePageStats(acc);
    const { skippedZero } = this.deps.metrics.upsertExitPageStats(merged, opts);
    return { rows: merged.length, skippedZero };
  }

  /**
   * Daily reaches for EVERY goal on the counter via /stat/v1/data/bytime (group=day). One request
   * returns the whole daily series for a batch of ≤10 goal metrics (the API's metric cap), so a
   * 163-goal counter costs ~17 requests regardless of the period length.
   */
  async syncGoalReachesByDay(
    from: string,
    to: string,
    goalIds: readonly number[],
  ): Promise<{ batches: number; rows: number }> {
    const batches = batchGoalIds(goalIds);
    const acc: GoalDayRow[] = [];
    for (const batch of batches) {
      const { raw, rows: batchRows } = await goalReachesByDay(this.deps.client, {
        counterId: this.deps.counterId,
        from,
        to,
        goalIds: batch,
      });
      this.deps.metrics.saveRawResponse({
        endpoint: ENDPOINTS.statByTime,
        queryHash: stableHash({ q: 'goal-reaches-by-day', goals: batch, from, to }),
        dateFrom: from,
        dateTo: to,
        payload: raw,
        fetchedAt: this.deps.now(),
      });
      acc.push(...batchRows);
    }
    const merged = mergeGoalDayRows(acc);
    return { batches: batches.length, rows: merged.length };
  }

  async syncBrowserOs(
    from: string,
    to: string,
    goalId?: number,
  ): Promise<{ rows: number; truncated?: boolean }> {
    const chunks = dayChunks(from, to);
    const acc: Awaited<ReturnType<typeof browserOsBreakdown>>['stats'] = [];
    let truncated = false;
    if (chunks.length <= RANGE_MAX_DAYS) {
      // ANA-113: одно range-обращение на всё окно (`ym:s:date`) вместо запроса на каждый
      // день — квота Метрики (quota_requests_by_uid, 5000/сутки) тратится на данные,
      // а не на per-day чанки.
      const { raw, stats } = await browserOsBreakdown(this.deps.client, {
        counterId: this.deps.counterId,
        from,
        to,
        goalId,
        dateDimension: true,
      });
      this.deps.metrics.saveRawResponse({
        endpoint: ENDPOINTS.statData,
        queryHash: stableHash({ q: 'browser-os', goalId, from, to }),
        dateFrom: from,
        dateTo: to,
        payload: raw,
        fetchedAt: this.deps.now(),
      });
      acc.push(...stats);
      if (raw.total_rows !== undefined && raw.total_rows > raw.data.length) {
        console.warn(
          `[sync] browser-os: range-ответ усечён (${raw.data.length}/${raw.total_rows} строк) — окно неполное`,
        );
        truncated = true;
      }
    } else {
      // Широкие окна — прежний цикл per-day: у больших диапазонов row-cap range-ответа
      // может не хватить (10 000 строк).
      for (const chunk of chunks) {
        const { raw, stats } = await browserOsBreakdown(this.deps.client, {
          counterId: this.deps.counterId,
          from: chunk.from,
          to: chunk.to,
          goalId,
        });
        this.deps.metrics.saveRawResponse({
          endpoint: ENDPOINTS.statData,
          queryHash: stableHash({ q: 'browser-os', goalId, from: chunk.from, to: chunk.to }),
          dateFrom: chunk.from,
          dateTo: chunk.to,
          payload: raw,
          fetchedAt: this.deps.now(),
        });
        acc.push(...stats);
      }
    }
    const merged = mergeBrowserOsStats(acc);
    return { rows: merged.length, truncated };
  }

  async syncNewReturning(
    from: string,
    to: string,
    goalId?: number,
  ): Promise<{ rows: number; truncated?: boolean }> {
    const chunks = dayChunks(from, to);
    const acc: Awaited<ReturnType<typeof newReturningBreakdown>>['stats'] = [];
    let truncated = false;
    if (chunks.length <= RANGE_MAX_DAYS) {
      // ANA-113: одно range-обращение на всё окно (`ym:s:date`) вместо запроса на каждый
      // день — квота Метрики (quota_requests_by_uid, 5000/сутки) тратится на данные,
      // а не на per-day чанки.
      const { raw, stats } = await newReturningBreakdown(this.deps.client, {
        counterId: this.deps.counterId,
        from,
        to,
        goalId,
        dateDimension: true,
      });
      this.deps.metrics.saveRawResponse({
        endpoint: ENDPOINTS.statData,
        queryHash: stableHash({ q: 'new-returning', goalId, from, to }),
        dateFrom: from,
        dateTo: to,
        payload: raw,
        fetchedAt: this.deps.now(),
      });
      acc.push(...stats);
      if (raw.total_rows !== undefined && raw.total_rows > raw.data.length) {
        console.warn(
          `[sync] new-returning: range-ответ усечён (${raw.data.length}/${raw.total_rows} строк) — окно неполное`,
        );
        truncated = true;
      }
    } else {
      // Широкие окна — прежний цикл per-day: у больших диапазонов row-cap range-ответа
      // может не хватить (10 000 строк).
      for (const chunk of chunks) {
        const { raw, stats } = await newReturningBreakdown(this.deps.client, {
          counterId: this.deps.counterId,
          from: chunk.from,
          to: chunk.to,
          goalId,
        });
        this.deps.metrics.saveRawResponse({
          endpoint: ENDPOINTS.statData,
          queryHash: stableHash({ q: 'new-returning', goalId, from: chunk.from, to: chunk.to }),
          dateFrom: chunk.from,
          dateTo: chunk.to,
          payload: raw,
          fetchedAt: this.deps.now(),
        });
        acc.push(...stats);
      }
    }
    const merged = mergeNewReturningStats(acc);
    return { rows: merged.length, truncated };
  }

  /**
   * Run an optional breakdown sync best-effort: a counter-specific failure (an attribute the API
   * rejects, an unavailable goal) is logged and skipped rather than aborting the whole pipeline,
   * so the dashboard still gets every dataset that IS available. Goals + traffic stay required.
   * ANA-15: the failure is also pushed into `errors` so the sync status UI can show it.
   */
  private async best(
    label: string,
    fn: () => Promise<{ rows: number; truncated?: boolean; skippedZero?: number }>,
    errors: SyncStepError[] = [],
  ): Promise<{ rows: number; skippedZero?: number }> {
    try {
      const res = await fn();
      // ANA-113: усечённый range-ответ (row-cap 10000) — данные частичные; делает это видимым
      // в /api/sync/status, не роняя синк (частичные данные лучше нулей).
      if (res.truncated) {
        errors.push({
          step: label,
          message: 'range-ответ усечён (row-cap 10000): данные окна неполные',
        });
      }
      return res;
    } catch (err) {
      const message = (err as Error).message;
      console.warn(`[sync] ${label} skipped: ${message}`);
      errors.push({ step: label, message });
      return { rows: 0 };
    }
  }

  async syncAll(
    from: string,
    to: string,
    goalId?: number,
    opts: UpsertOptions = {},
  ): Promise<SyncSummary> {
    // Validate connectivity + auth with the (required) goals call BEFORE wiping anything, so a
    // failed sync (e.g. expired token) leaves the existing dataset intact instead of an empty DB.
    const goals = await this.fetchGoals();
    // Wipe only the [from, to] window (+ the goals catalog) before reloading: the window is
    // duplicate-free (SQLite treats NULL as distinct in the (date, channel, utm_*) key, so
    // INSERT OR REPLACE alone can't dedupe), while history outside the window survives — the
    // scheduled 14-day sync used to erase everything older (only 14 days were ever available).
    // User-entered data (b2b/hypotheses/decisions/snapshots) is never touched.
    // ANA-153: the wipe only removes ZERO rows (force restores the unrestricted wipe) — the
    // restored pre-reset history must survive until the protected upserts decide per row.
    // Keep an in-memory copy of the window: if the required traffic step fails (e.g. Metrika 429
    // quota) everything is restored; optional steps that come back empty after a failure get their
    // own table restored below. A failed sync must never leave less data than before.
    const backup = this.deps.metrics.snapshotWindow(from, to);
    this.deps.metrics.resetSyncedWindow(from, to, opts);
    this.deps.metrics.upsertGoals(goals);
    // Auto-detect the KPI goal when the caller didn't pin one — so the user never hand-picks a
    // GOAL_ID. An explicit goalId always wins; otherwise pick the payment/purchase goal.
    const resolvedGoalId = goalId ?? selectPrimaryGoal(goals)?.id;
    let traffic: { days: number; rows: number; skippedZero: number };
    try {
      traffic = await this.syncTraffic(from, to, resolvedGoalId, opts);
    } catch (err) {
      this.deps.metrics.restoreWindow(backup);
      throw err;
    }
    const { days, rows } = traffic;
    const errors: SyncStepError[] = [];
    const utm = await this.best('utm', () => this.syncUtm(from, to, resolvedGoalId, opts), errors);
    const geo = await this.best(
      'geo-device',
      () => this.syncGeoDevice(from, to, resolvedGoalId, opts),
      errors,
    );
    const pages = await this.best(
      'pages',
      () => this.syncPages(from, to, resolvedGoalId, opts),
      errors,
    );
    const exitPages = await this.best(
      'exit-pages',
      () => this.syncExitPages(from, to, resolvedGoalId, opts),
      errors,
    );
    const goalReaches = await this.best(
      'goal-reaches-by-day',
      () =>
        this.syncGoalReachesByDay(
          from,
          to,
          goals.map((g) => g.id),
        ),
      errors,
    );
    const browserOs = await this.best(
      'browser-os',
      () => this.syncBrowserOs(from, to, resolvedGoalId),
      errors,
    );
    const newReturning = await this.best(
      'new-returning',
      () => this.syncNewReturning(from, to, resolvedGoalId),
      errors,
    );
    // Optional step failed (best() → 0 rows) where the window previously had data → restore it.
    const optional: Array<[string, number]> = [
      ['utm_stats', utm.rows],
      ['geo_device_stats', geo.rows],
      ['page_stats', pages.rows],
      ['exit_page_stats', exitPages.rows],
    ];
    for (const [table, n] of optional) {
      if (n === 0 && (backup.tables[table]?.length ?? 0) > 0) {
        this.deps.metrics.restoreWindowTable(backup, table);
      }
    }
    // ANA-18: real Metrika data has arrived → the demo dataset must never mix into the KPIs.
    // Live (is_demo = 0) rows are untouched; this is the documented «demo is removed on the first
    // sync» moment. Only runs when the required steps succeeded (traffic throw → early re-throw).
    this.deps.metrics.deleteDemoRows();
    return {
      goals: goals.length,
      resolvedGoalId,
      days,
      channelRows: rows,
      utmRows: utm.rows,
      geoDeviceRows: geo.rows,
      pageRows: pages.rows,
      exitPageRows: exitPages.rows,
      goalReachesRows: goalReaches.rows,
      browserOsRows: browserOs.rows,
      newReturningRows: newReturning.rows,
      // ANA-153: how many zero rows the protection skipped across the five stat tables.
      skippedZero:
        traffic.skippedZero +
        (utm.skippedZero ?? 0) +
        (geo.skippedZero ?? 0) +
        (pages.skippedZero ?? 0) +
        (exitPages.skippedZero ?? 0),
      errors,
    };
  }
}
