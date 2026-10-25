import { selectPrimaryGoal, type Goal } from '@pca/shared';
import type { MetricsRepo } from '../db/repositories/metrics-repo';
import { dayChunks } from '../utils/date-range';
import { stableHash } from '../utils/hash';
import type { MetrikaClient } from './client';
import { ENDPOINTS } from './endpoints';
import { GoalsResponseSchema } from './schemas';
import { trafficBySource } from './queries/traffic-by-source';
import { utmBreakdown } from './queries/utm-breakdown';
import { geoDeviceBreakdown } from './queries/geo-device-breakdown';
import { pageBehavior } from './queries/page-behavior';
import { exitPageBehavior } from './queries/exit-page-behavior';
import { batchGoalIds, goalReachesByDay } from './queries/goal-reaches-by-day';
import { browserOsBreakdown } from './queries/browser-os-breakdown';
import { newReturningBreakdown } from './queries/new-returning';

export interface SyncDeps {
  readonly client: MetrikaClient;
  readonly metrics: MetricsRepo;
  readonly counterId: number;
  /** Goals with id below this threshold are flagged archived (§5.5). */
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
      isArchived: g.id < this.deps.archivedThreshold,
      syncedAt: this.deps.now(),
    }));
  }

  async syncGoals(): Promise<Goal[]> {
    const goals = await this.fetchGoals();
    this.deps.metrics.upsertGoals(goals);
    return goals;
  }

  async syncTraffic(
    from: string,
    to: string,
    goalId?: number,
  ): Promise<{ days: number; rows: number }> {
    const chunks = dayChunks(from, to);
    let rows = 0;
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
      this.deps.metrics.upsertChannelStats(stats);
      rows += stats.length;
    }
    return { days: chunks.length, rows };
  }

  async syncUtm(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    let rows = 0;
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
      this.deps.metrics.upsertUtmStats(stats);
      rows += stats.length;
    }
    return { rows };
  }

  async syncGeoDevice(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    let rows = 0;
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
      this.deps.metrics.upsertGeoDeviceStats(stats);
      rows += stats.length;
    }
    return { rows };
  }

  async syncPages(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    let rows = 0;
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
      this.deps.metrics.upsertPageStats(stats);
      rows += stats.length;
    }
    return { rows };
  }

  async syncExitPages(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    let rows = 0;
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
      this.deps.metrics.upsertExitPageStats(stats);
      rows += stats.length;
    }
    return { rows };
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
    let rows = 0;
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
      rows += batchRows.length;
    }
    return { batches: batches.length, rows };
  }

  async syncBrowserOs(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    let rows = 0;
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
      rows += stats.length;
    }
    return { rows };
  }

  async syncNewReturning(from: string, to: string, goalId?: number): Promise<{ rows: number }> {
    const chunks = dayChunks(from, to);
    let rows = 0;
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
      rows += stats.length;
    }
    return { rows };
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
    // Full wipe of all synced data (stat tables + goals + raw_responses) before reloading so a
    // re-sync always yields a fresh, duplicate-free dataset. SQLite treats NULL as distinct in the
    // (date, channel, utm_*) primary key, so INSERT OR REPLACE cannot dedupe rows with NULL UTM —
    // a full wipe+reload is the reliable guarantee. User-entered data (b2b/hypotheses/decisions/
    // snapshots) is preserved.
    this.deps.metrics.resetSyncedData();
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
