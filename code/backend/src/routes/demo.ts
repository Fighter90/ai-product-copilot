import type { FastifyInstance } from 'fastify';
import type { MetricsRepo } from '../db/repositories/metrics-repo';

export interface DemoRouteOptions {
  readonly metrics: MetricsRepo;
}

/**
 * ANA-18: «Демо-данные» banner source — counts of demo-marked rows per dataset. The cabinet
 * layout polls this (demo: true → yellow banner on every screen) so made-up seed rows can never
 * be mistaken for live Metrika data.
 */
export async function demoRoutes(app: FastifyInstance, opts: DemoRouteOptions): Promise<void> {
  app.get(
    '/demo/status',
    { schema: { tags: ['metrics'], summary: 'Demo-data presence (ANA-18 banner)' } },
    async () => opts.metrics.demoStatus(),
  );
}
