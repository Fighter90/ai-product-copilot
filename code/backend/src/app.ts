import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { MetricsRepo } from './db/repositories/metrics-repo';
import type { HypothesesRepo } from './db/repositories/hypotheses-repo';
import type { DecisionsRepo } from './db/repositories/decisions-repo';
import type { B2bRepo } from './db/repositories/b2b-repo';
import type { SyncRunner } from './routes/sync';
import type { ReportRunner } from './routes/report';
import type { DB } from './db/connection';
import type { UsersRepo } from './auth/users-repo';
import type { AppSettings } from './settings/app-settings';
import type { LlmService } from './llm/service';
import { healthRoutes } from './routes/health';
import { metricsRoutes } from './routes/metrics';
import { hypothesesRoutes } from './routes/hypotheses';
import { decisionsRoutes } from './routes/decisions';
import { b2bRoutes } from './routes/b2b';
import { syncRoutes } from './routes/sync';
import { reportRoutes } from './routes/report';
import { settingsRoutes } from './routes/settings';
import { metrikaGoalsRoutes } from './routes/metrika-goals';
import { registerAuth } from './auth/auth';
import { appSettingsRoutes } from './settings/routes';
import { llmRoutes } from './llm/routes';
import { helpRoutes } from './help/help';
import { liveRoutes } from './live/live';
import { dataLensRoutes } from './integrations/datalens';
import { APP_VERSION } from './config';

/** v3 cabinet dependencies (auth, runtime settings, AI providers, help, live mode, DataLens). */
export interface CabinetDeps {
  readonly db: DB;
  readonly users: UsersRepo;
  readonly settings: AppSettings;
  readonly llm: LlmService;
  readonly helpDir: string;
  readonly cookieSecure: boolean;
  readonly sessionDays: number;
  readonly tz: string;
  /** Called after an admin changes settings (rebuild cached Metrika clients). */
  readonly onSettingsChange?: () => void;
}

export interface AppDeps {
  readonly metrics: MetricsRepo;
  readonly hypotheses: HypothesesRepo;
  readonly decisions: DecisionsRepo;
  readonly b2b: B2bRepo;
  readonly runSync: SyncRunner;
  readonly report: ReportRunner;
  /** When present the app runs in multi-user cabinet mode (login required). */
  readonly cabinet?: CabinetDeps;
}

/**
 * Build the Fastify app from injected repositories — no IO at construction, so it is
 * fully testable with an in-memory database. Logger defaults to off for quiet tests.
 */
export function buildServer(
  deps: AppDeps,
  logger: FastifyServerOptions['logger'] = false,
): FastifyInstance {
  // Доверять X-Forwarded-For только при явном реверс-прокси (TRUST_PROXY=1), иначе req.ip
  // подменяется клиентом и обходится rate-limit логина/help.
  const app = Fastify({
    logger,
    trustProxy: process.env.TRUST_PROXY === '1',
    bodyLimit: 2 * 1024 * 1024,
  });
  const cab = deps.cabinet;

  app.register(swagger, {
    openapi: { info: { title: 'ProductCamp Analytics Copilot API', version: APP_VERSION } },
  });
  // Swagger UI только вне production (на проде API-документация не для публики).
  if (process.env.NODE_ENV !== 'production') {
    app.register(swaggerUi, { routePrefix: '/docs' });
  }

  if (cab) {
    registerAuth(app, {
      users: cab.users,
      cookieSecure: cab.cookieSecure,
      sessionDays: cab.sessionDays,
    });
  }

  app.register(healthRoutes, {
    prefix: '/api',
    ...(cab
      ? {
          counterId: () => cab.settings.getNumber('COUNTER_ID'),
          tokenPresent: () => !!cab.settings.get('YANDEX_OAUTH_TOKEN'),
        }
      : {}),
  });
  app.register(metricsRoutes, { prefix: '/api', repo: deps.metrics });
  app.register(hypothesesRoutes, { prefix: '/api', repo: deps.hypotheses });
  app.register(decisionsRoutes, { prefix: '/api', repo: deps.decisions });
  app.register(b2bRoutes, { prefix: '/api', repo: deps.b2b });
  app.register(syncRoutes, { prefix: '/api', runSync: deps.runSync });
  app.register(reportRoutes, { prefix: '/api', runner: deps.report });

  if (cab) {
    app.register(appSettingsRoutes, {
      prefix: '/api',
      settings: cab.settings,
      users: cab.users,
      db: cab.db,
      onChange: cab.onSettingsChange,
    });
    // Admin-only goal management (create/archive/restore) — guarded by the /api/admin ADMIN_RULES.
    app.register(metrikaGoalsRoutes, {
      prefix: '/api',
      token: () => cab.settings.get('YANDEX_OAUTH_TOKEN'),
      counterId: () => cab.settings.getNumber('COUNTER_ID'),
      users: cab.users,
    });
    app.register(llmRoutes, { prefix: '/api', llm: cab.llm, users: cab.users });
    app.register(helpRoutes, {
      prefix: '/api',
      dir: cab.helpDir,
      complete: (req) => cab.llm.complete(req, { purpose: 'help-assistant' }),
    });
    app.register(liveRoutes, {
      prefix: '/api',
      token: () => cab.settings.get('YANDEX_OAUTH_TOKEN'),
      counterId: () => cab.settings.getNumber('COUNTER_ID'),
      orderGoalId: () =>
        cab.settings.getNumber('ORDER_GOAL_ID') || cab.settings.getNumber('GOAL_ID'),
      tz: cab.tz,
    });
    app.register(dataLensRoutes, {
      prefix: '/api',
      db: cab.db,
      settings: cab.settings,
      users: cab.users,
    });
  } else {
    // Legacy single-user mode (local ./run.sh without cabinet): .env-backed settings.
    app.register(settingsRoutes, { prefix: '/api' });
  }

  return app;
}
