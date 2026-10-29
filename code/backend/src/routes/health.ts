import type { FastifyInstance, FastifyRequest } from 'fastify';
import { APP_VERSION, config, hasMetrikaToken } from '../config';

/**
 * Liveness + minimal readiness signal. Mounted under the `/api` prefix → `GET /api/health`.
 * REG-18: the endpoint is public, so the default payload carries no configuration —
 * `counterId` / `metrikaTokenPresent` go only to a caller with a valid admin session
 * (cabinet mode). Legacy mode (no auth at all) keeps the historical payload: there is
 * no session to check and local monitoring relies on it.
 */
export async function healthRoutes(
  app: FastifyInstance,
  opts: { counterId?: () => number; tokenPresent?: () => boolean } = {},
): Promise<void> {
  app.get('/health', async (req: FastifyRequest) => {
    const base = {
      status: 'ok',
      service: 'productcamp-analytics-backend',
      version: APP_VERSION,
      build: process.env.BUILD_SHA ?? null,
      timestamp: new Date().toISOString(),
    };
    // Cabinet mode registers auth and passes runtime getters (see app.ts); without
    // them we are in legacy mode → fall back to static config as before.
    const cabinet = opts.counterId !== undefined || opts.tokenPresent !== undefined;
    if (cabinet && req.user?.role !== 'admin') return base;
    return {
      ...base,
      counterId: opts.counterId ? opts.counterId() : config.COUNTER_ID,
      metrikaTokenPresent: opts.tokenPresent ? opts.tokenPresent() : hasMetrikaToken(),
    };
  });
}
