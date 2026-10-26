import { selectPrimaryGoal, type Goal } from '@pca/shared';
import type { ChannelStat, GeoDeviceStat, PageStat, UtmStat } from '@pca/shared';
import type { MetricsRepo } from '../db/repositories/metrics-repo';
import { dayChunks } from '../utils/date-range';
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
  ): Promise<{ days: number; rows: number }> {
    const chunks = dayChunks(from, to);
    const acc: ChannelStat[] = [];
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
    const merged = mergeChannelStats(acc);
    this.deps.metrics.upsertChannelStats(merged);
    return { days: chunks.length, rows: merged.length };
  }

  async syncUtm(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    const acc: UtmStat[] = [];
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
    const merged = mergeUtmStats(acc);
    this.deps.metrics.upsertUtmStats(merged);
    return { rows: merged.length };
  }

  async syncGeoDevice(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    const acc: GeoDeviceStat[] = [];
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
    const merged = mergeGeoDeviceStats(acc);
    this.deps.metrics.upsertGeoDeviceStats(merged);
    return { rows: merged.length };
  }

  async syncPages(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
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
    this.deps.metrics.upsertPageStats(merged);
    return { rows: merged.length };
  }

  async syncExitPages(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
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
    this.deps.metrics.upsertExitPageStats(merged);
    return { rows: merged.length };
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

  async syncBrowserOs(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    const acc: Awaited<ReturnType<typeof browserOsBreakdown>>['stats'] = [];
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
    const merged = mergeBrowserOsStats(acc);
    return { rows: merged.length };
  }

  async syncNewReturning(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    const acc: Awaited<ReturnType<typeof newReturningBreakdown>>['stats'] = [];
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
    const merged = mergeNewReturningStats(acc);
    return { rows: merged.length };
  }

  /**
   * Run an optional breakdown sync best-effort: a counter-specific failure (an attribute the API
   * rejects, an unavailable goal) is logged and skipped rather than aborting the whole pipeline,
   * so the dashboard still gets every dataset that IS available. Goals + traffic stay required.
   */
  private async best(
    label: string,
    fn: () => Promise<{ rows: number }>,
  ): Promise<{ rows: number }> {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[sync] ${label} skipped: ${(err as Error).message}`);
      return { rows: 0 };
    }
  }

  async syncAll(from: string, to: string, goalId?: number): Promise<SyncSummary> {
    // Validate connectivity + auth with the (required) goals call BEFORE wiping anything, so a
    // failed sync (e.g. expired token) leaves the existing dataset intact instead of an empty DB.
    const goals = await this.fetchGoals();
    // Wipe only the [from, to] window (+ the goals catalog) before reloading: the window is
    // duplicate-free (SQLite treats NULL as distinct in the (date, channel, utm_*) key, so
    // INSERT OR REPLACE alone can't dedupe), while history outside the window survives — the
    // scheduled 14-day sync used to erase everything older (only 14 days were ever available).
    // User-entered data (b2b/hypotheses/decisions/snapshots) is never touched.
    this.deps.metrics.resetSyncedWindow(from, to);
    this.deps.metrics.upsertGoals(goals);
    // Auto-detect the KPI goal when the caller didn't pin one — so the user never hand-picks a
    // GOAL_ID. An explicit goalId always wins; otherwise pick the payment/purchase goal.
    const resolvedGoalId = goalId ?? selectPrimaryGoal(goals)?.id;
    const { days, rows } = await this.syncTraffic(from, to, resolvedGoalId);
    const utm = await this.best('utm', () => this.syncUtm(from, to, resolvedGoalId));
    const geo = await this.best('geo-device', () => this.syncGeoDevice(from, to, resolvedGoalId));
    const pages = await this.best('pages', () => this.syncPages(from, to, resolvedGoalId));
    const exitPages = await this.best('exit-pages', () =>
      this.syncExitPages(from, to, resolvedGoalId),
    );
    const goalReaches = await this.best('goal-reaches-by-day', () =>
      this.syncGoalReachesByDay(
        from,
        to,
        goals.map((g) => g.id),
      ),
    );
    const browserOs = await this.best('browser-os', () =>
      this.syncBrowserOs(from, to, resolvedGoalId),
    );
    const newReturning = await this.best('new-returning', () =>
      this.syncNewReturning(from, to, resolvedGoalId),
    );
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
    };
  }
}
