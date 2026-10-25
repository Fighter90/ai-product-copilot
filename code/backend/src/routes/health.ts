import type { FastifyInstance } from 'fastify';
import { APP_VERSION, config, hasMetrikaToken } from '../config';

/** Liveness + minimal readiness signal. Mounted under the `/api` prefix → `GET /api/health`. */
export async function healthRoutes(
  app: FastifyInstance,
  opts: { counterId?: () => number; tokenPresent?: () => boolean } = {},
): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'productcamp-analytics-backend',
    version: APP_VERSION,
    build: process.env.BUILD_SHA ?? null,
    counterId: opts.counterId ? opts.counterId() : config.COUNTER_ID,
    metrikaTokenPresent: opts.tokenPresent ? opts.tokenPresent() : hasMetrikaToken(),
    timestamp: new Date().toISOString(),
  }));
}
