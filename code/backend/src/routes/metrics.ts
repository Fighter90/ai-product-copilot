import type { FastifyInstance } from 'fastify';
import { KPI_TARGET_PAID_TICKETS, resolveKpiTarget } from '@pca/shared';
import type { MetricsRepo } from '../db/repositories/metrics-repo';
import { resolvePrimaryGoal } from '../metrika/primary-goal';
import { PC_GOALS_REFERENCE } from '../metrika/pc-goals-reference';

export interface MetricsRouteOptions {
  readonly repo: MetricsRepo;
  /** Admin-pinned KPI goal (runtime GOAL_ID; 0 = auto-detect). */
  readonly primaryGoalId?: () => number;
  /** Raw «Цель по оплатам» setting (runtime KPI_TARGET); normalised, defaults to 300. */
  readonly kpiTarget?: () => number | string;
}

/** Read-only metrics endpoints backed by the cached SQLite tables. */
export async function metricsRoutes(
  app: FastifyInstance,
  opts: MetricsRouteOptions,
): Promise<void> {
  app.get(
    '/metrics/channels',
    { schema: { tags: ['metrics'], summary: 'Channel stats' } },
    async (req) => {
      const q = req.query as { from?: string; to?: string };
      const range = q.from && q.to ? { from: q.from, to: q.to } : undefined;
      return opts.repo.listChannelStats(range);
    },
  );

  app.get(
    '/metrics/utm',
    { schema: { tags: ['metrics'], summary: 'UTM-source/medium/campaign breakdown' } },
    async (req) => {
      const q = req.query as { from?: string; to?: string };
      const range = q.from && q.to ? { from: q.from, to: q.to } : undefined;
      return opts.repo.listUtmStats(range);
    },
  );

  app.get(
    '/metrics/geo-device',
    { schema: { tags: ['metrics'], summary: 'Geo (country) + device-category breakdown' } },
    async (req) => {
      const q = req.query as { from?: string; to?: string };
      const range = q.from && q.to ? { from: q.from, to: q.to } : undefined;
      return opts.repo.listGeoDeviceStats(range);
    },
  );

  app.get(
    '/metrics/pages',
    { schema: { tags: ['metrics'], summary: 'Entry-page (startURL) behaviour' } },
    async (req) => {
      const q = req.query as { from?: string; to?: string };
      const range = q.from && q.to ? { from: q.from, to: q.to } : undefined;
      return opts.repo.listPageStats(range);
    },
  );

  app.get(
    '/metrics/exit-pages',
    { schema: { tags: ['metrics'], summary: 'Exit-page (exitURL) behaviour' } },
    async (req) => {
      const q = req.query as { from?: string; to?: string };
      const range = q.from && q.to ? { from: q.from, to: q.to } : undefined;
      return opts.repo.listExitPageStats(range);
    },
  );

  app.get('/metrics/goals', { schema: { tags: ['metrics'], summary: 'Goals' } }, async (req) => {
    const archived = (req.query as { archived?: string }).archived === 'true';
    return opts.repo.listGoals(archived);
  });

  app.get(
    '/metrics/primary-goal',
    {
      schema: { tags: ['metrics'], summary: 'Primary KPI goal (pinned GOAL_ID or auto-detected)' },
    },
    async (_req, reply) => {
      const primary = resolvePrimaryGoal(opts.repo.listGoals(), opts.primaryGoalId?.());
      return primary ?? reply.code(404).send({ error: 'no primary goal detected' });
    },
  );

  // Analyst-readable: the admin's «Цель по оплатам» (GET /settings carries it too, but that view
  // is meant for the admin UI and is absent in legacy mode).
  app.get(
    '/metrics/kpi-target',
    { schema: { tags: ['metrics'], summary: 'KPI target (paid tickets)' } },
    async () => ({
      target: opts.kpiTarget ? resolveKpiTarget(opts.kpiTarget()) : KPI_TARGET_PAID_TICKETS,
    }),
  );

  app.get(
    '/metrics/raw/:id',
    { schema: { tags: ['metrics'], summary: 'Raw response' } },
    async (req, reply) => {
      const raw = opts.repo.getRawResponse(Number((req.params as { id: string }).id));
      return raw ?? reply.code(404).send({ error: 'not found' });
    },
  );

  // ANA-34: pc-goals reference — funnel role of each JS-event goal. The Goals page joins this by
  // `event` to fill the «Роль в воронке» column. Static, read-only, no Metrika calls.
  app.get(
    '/metrics/goal-roles',
    { schema: { tags: ['metrics'], summary: 'pc-goals reference: funnel role per goal event' } },
    async () => ({
      roles: PC_GOALS_REFERENCE.map((r) => ({
        code: r.code,
        event: r.event,
        ru: r.ru,
        en: r.en,
        group: r.group,
      })),
    }),
  );

  // ANA-49: how far back the cached data reaches, so the FilterBar can offer «Догрузить N дней»
  // when the selected period starts before the first synced day. 200 with nulls while empty.
  app.get(
    '/metrics/coverage',
    { schema: { tags: ['metrics'], summary: 'Cached data coverage (first/last synced day)' } },
    async () => opts.repo.statsCoverage() ?? { from: null, to: null, days: 0 },
  );
}
