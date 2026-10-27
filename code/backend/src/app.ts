import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { MetricsRepo } from './db/repositories/metrics-repo';
import type { HypothesesRepo } from './db/repositories/hypotheses-repo';
import type { DecisionsRepo } from './db/repositories/decisions-repo';
import type { B2bRepo } from './db/repositories/b2b-repo';
import type { MarketingRepo } from './db/repositories/marketing-repo';
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
import { marketingRoutes } from './marketing/routes';
import { syncRoutes, withDefaultGoal } from './routes/sync';
import { reportRoutes } from './routes/report';
import { paymentsRoutes } from './routes/payments';
import { demoRoutes } from './routes/demo';
import { SyncRunRepo } from './db/repositories/sync-run-repo';
import { B2cPaymentsRepo } from './db/repositories/b2c-payments-repo';
import { TEST_TRAFFIC_PATTERNS_ENV } from './metrika/traffic-filter';
import { settingsRoutes } from './routes/settings';
import { metrikaGoalsRoutes } from './routes/metrika-goals';
import { registerAuth } from './auth/auth';
import { UserCountersRepo } from './auth/user-counters-repo';
import { grantOnCreate, registerCounterGuard, userCountersRoutes } from './auth/user-counters';
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
  /** ANA-73: the weekly marketing grid (sheet «стата» replacement). */
  readonly marketing: MarketingRepo;
  readonly runSync: SyncRunner;
  readonly report: ReportRunner;
  /** When present the app runs in multi-user cabinet mode (login required). */
  readonly cabinet?: CabinetDeps;
}

/**
 * ANA-22: the sync queries read the test-traffic layers from env (statFilters in
 * traffic-filter.ts). Push the admin's runtime TEST_TRAFFIC_PATTERNS setting into that env slot
 * right before each run, so an admin edit applies on the next sync without a restart. Empty
 * setting → the env var is cleared (only the base file:// filter remains).
 */
function pushTestTrafficPatterns(run: SyncRunner, cab: CabinetDeps): SyncRunner {
  return (body) => {
    const patterns = cab.settings.get('TEST_TRAFFIC_PATTERNS');
    if (patterns) process.env[TEST_TRAFFIC_PATTERNS_ENV] = patterns;
    else delete process.env[TEST_TRAFFIC_PATTERNS_ENV];
    return run(body);
  };
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
  const counterAccess = cab ? new UserCountersRepo(cab.db) : undefined;
  const cabCounterId = (): number => cab?.settings.getNumber('COUNTER_ID') ?? 0;

  // Fastify 5 rejects DELETE with `content-type: application/json` and an empty body (v4 allowed
  // it). Keep the v4 behaviour so body-less DELETEs (e.g. /api/b2b/:id) from any client still work.
  const defaultJsonParser = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (req.method === 'DELETE' && body === '') return done(null, undefined);
    defaultJsonParser(req, body as string, done);
  });

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
      onUserCreated: grantOnCreate(counterAccess!, cabCounterId),
    });
    // ANA-29: analysts read counter data only for counters assigned to them (after registerAuth).
    registerCounterGuard(app, { access: counterAccess!, counterId: cabCounterId });
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
  app.register(metricsRoutes, {
    prefix: '/api',
    repo: deps.metrics,
    ...(cab
      ? {
          primaryGoalId: () => cab.settings.getNumber('GOAL_ID'),
          kpiTarget: () => cab.settings.get('KPI_TARGET'),
        }
      : {}),
  });
  app.register(hypothesesRoutes, { prefix: '/api', repo: deps.hypotheses });
  app.register(decisionsRoutes, { prefix: '/api', repo: deps.decisions });
  app.register(b2bRoutes, { prefix: '/api', repo: deps.b2b });
  // ANA-73: the weekly marketing grid. PUT/DELETE are analyst work (hand-entered cells); the
  // sync endpoint is admin-only (ADMIN_RULES) — it may spend Metrika quota on a backfill.
  app.register(marketingRoutes, {
    prefix: '/api',
    repo: deps.marketing,
    // Same wrapped runner as /api/sync: runtime GOAL_ID + the admin's test-traffic patterns.
    runSync: cab
      ? withDefaultGoal(pushTestTrafficPatterns(deps.runSync, cab), () =>
          cab.settings.getNumber('GOAL_ID'),
        )
      : deps.runSync,
  });
  app.register(demoRoutes, { prefix: '/api', metrics: deps.metrics });
  app.register(syncRoutes, {
    prefix: '/api',
    // Cabinet: honour the admin's runtime GOAL_ID (0/empty = auto-detect the KPI goal).
    runSync: cab
      ? withDefaultGoal(pushTestTrafficPatterns(deps.runSync, cab), () =>
          cab.settings.getNumber('GOAL_ID'),
        )
      : deps.runSync,
    // ANA-15: record every run so the admin sync-status UI can show the result + step errors.
    recordRun: cab ? new SyncRunRepo(cab.db) : undefined,
  });
  app.register(reportRoutes, { prefix: '/api', runner: deps.report });
  if (cab) {
    // ANA-19: manual B2C payments (admin/analyst data entry + CSV import) + the «Оплачено» KPI
    // summary. Cabinet-only: the legacy single-user demo mode has no payments UI.
    app.register(paymentsRoutes, {
      prefix: '/api',
      b2c: new B2cPaymentsRepo(cab.db),
      b2b: deps.b2b,
      // ANA-72: the coverage report includes the synced Metrika window.
      statsCoverage: () => deps.metrics.statsCoverage(),
    });
  }

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
      // ANA-35: «Оплата» without a payment goal = manually entered B2B deals paid in the period.
      manualPayments: (from, to) =>
        deps.b2b
          .list()
          .filter((d) => d.stage === 'paid' && d.datePaid && d.datePaid.slice(0, 10) >= from)
          .filter((d) => d.datePaid!.slice(0, 10) <= to)
          .reduce((acc, d) => acc + d.tickets, 0),
    });
    app.register(dataLensRoutes, {
      prefix: '/api',
      db: cab.db,
      settings: cab.settings,
      users: cab.users,
    });
    app.register(userCountersRoutes, {
      prefix: '/api',
      access: counterAccess!,
      users: cab.users,
      counterId: cabCounterId,
      token: () => cab.settings.get('YANDEX_OAUTH_TOKEN'),
    });
  } else {
    // Legacy single-user mode (local ./run.sh without cabinet): .env-backed settings.
    app.register(settingsRoutes, { prefix: '/api' });
  }

  return app;
}
