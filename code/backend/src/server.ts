import { buildServer } from './app';
import { config, isPlaceholder } from './config';
import { openDb } from './db/connection';
import { migrate } from './db/migrate';
import { MetricsRepo } from './db/repositories/metrics-repo';
import { HypothesesRepo } from './db/repositories/hypotheses-repo';
import { DecisionsRepo } from './db/repositories/decisions-repo';
import { B2bRepo } from './db/repositories/b2b-repo';
import { MarketingRepo } from './db/repositories/marketing-repo';
import { B2cPaymentsRepo } from './db/repositories/b2c-payments-repo';
import { SnapshotRepo } from './db/repositories/snapshot-repo';
import { SnapshotBuilder } from './report/snapshot-builder';
import { makeSyncRunner } from './metrika/production-sync';
import { makeReportRunner, providerDisplayName, type AiBridge } from './report/production-report';
import { UsersRepo, ensureBootstrapUsers } from './auth/users-repo';
import { AppSettings } from './settings/app-settings';
import { LlmService, chainAsAnthropicFetch } from './llm/service';
import { PROVIDER_IDS, type HttpFetch } from './llm/providers';
import type { AnthropicFetch } from './report/ai-insights';

const clean = (v: string): string => (isPlaceholder(v) ? '' : v);

/** Entry point. Excluded from coverage — opens the real DB and binds the port. */
async function main(): Promise<void> {
  const db = openDb(config.DB_PATH);
  migrate(db);
  const metrics = new MetricsRepo(db);
  const hypotheses = new HypothesesRepo(db);
  const decisions = new DecisionsRepo(db);
  const b2b = new B2bRepo(db);
  const marketing = new MarketingRepo(db);

  // APP_SECRET шифрует токены/ключи, хранящиеся в БД. На сервере (NODE_ENV=production)
  // старт без него запрещён: предсказуемый fallback = компрометация всех секретов.
  const appSecret =
    config.APP_SECRET ||
    (process.env.NODE_ENV === 'production' ? '' : `local-dev:${config.DB_PATH}`);
  if (!appSecret) {
    throw new Error('APP_SECRET is required in production: it encrypts secrets stored in the DB');
  }
  if (!config.APP_SECRET) {
    console.warn('[pca] APP_SECRET not set — using a derived dev key. NEVER do this on a server.');
  }

  const users = new UsersRepo(db);
  const created = ensureBootstrapUsers(users, {
    adminEmail: config.ADMIN_EMAIL,
    adminName: config.ADMIN_NAME,
    adminPassword: config.ADMIN_PASSWORD,
    demo: config.DEMO_USERS === 1,
    demoAdminPassword: config.DEMO_ADMIN_PASSWORD,
    demoAnalystPassword: config.DEMO_ANALYST_PASSWORD,
  });

  const settings = new AppSettings(db, appSecret, {
    YANDEX_OAUTH_TOKEN: config.YANDEX_OAUTH_TOKEN,
    YANDEX_CLIENT_ID: config.YANDEX_CLIENT_ID,
    YANDEX_CLIENT_SECRET: config.YANDEX_CLIENT_SECRET,
    COUNTER_ID: config.COUNTER_ID ? String(config.COUNTER_ID) : '',
    GOAL_ID: config.GOAL_ID ? String(config.GOAL_ID) : '',
    KPI_TARGET: '300',
  });
  // Report snapshots read the admin's runtime KPI target and pinned goal on every build.
  // REG-03 (ANA-92): «Оплачено/Осталось» в отчёте — подтверждённые деньги, включая B2C-платежи
  // (b2c_payments) за период отчёта; заказы Метрики в оплату не входят.
  const b2cPayments = new B2cPaymentsRepo(db);
  const builder = new SnapshotBuilder({
    metrics,
    hypotheses,
    decisions,
    b2b,
    kpiTarget: () => settings.get('KPI_TARGET'),
    primaryGoalId: () => settings.getNumber('GOAL_ID'),
    b2cPaid: (range) => b2cPayments.sumTickets(range),
  });

  const llm = new LlmService(db, appSecret, globalThis.fetch as unknown as HttpFetch);
  llm.init({
    openrouter: { secret: clean(config.OPENROUTER_API_KEY), model: config.OPENROUTER_MODEL },
    anthropic: { secret: clean(config.ANTHROPIC_API_KEY), model: config.ANTHROPIC_MODEL },
    yandexgpt: {
      secret: clean(config.YANDEX_AI_API_KEY),
      model: config.YANDEX_AI_MODEL,
      extra: { folderId: config.YANDEX_AI_FOLDER_ID },
    },
    gigachat: {
      secret: clean(config.GIGACHAT_AUTH_KEY),
      model: config.GIGACHAT_MODEL,
      extra: { scope: config.GIGACHAT_SCOPE },
    },
  });

  const ai: AiBridge = {
    available: () => llm.available().length > 0,
    // ANA-33: an explicit provider choice (≠ 'auto') is pinned for the call, 'auto'/undefined
    // walks the admin-defined chain in priority order. ANA-155: excludeProvider drops the
    // provider whose generation was watchdog-killed from that chain.
    fetchFor: (purpose, choice, excludeProvider) =>
      chainAsAnthropicFetch(llm, {
        purpose,
        ...(choice && choice !== 'auto' ? { choice: choice as (typeof PROVIDER_IDS)[number] } : {}),
        ...(excludeProvider ? { exclude: excludeProvider as (typeof PROVIDER_IDS)[number] } : {}),
      }) as unknown as AnthropicFetch,
    providerName: providerDisplayName,
    unavailableMessage:
      'Нет настроенных AI-провайдеров — администратор включает их в «Администрирование → AI-провайдеры».',
  };

  const app = buildServer(
    {
      metrics,
      hypotheses,
      decisions,
      b2b,
      marketing,
      runSync: makeSyncRunner({
        token: () => settings.get('YANDEX_OAUTH_TOKEN'),
        counterId: () => settings.getNumber('COUNTER_ID'),
      }),
      report: makeReportRunner(builder, new SnapshotRepo(db), ai, {
        hypotheses,
        decisions,
      }),
      cabinet: {
        db,
        users,
        settings,
        llm,
        helpDir: config.HELP_DIR,
        cookieSecure: config.COOKIE_SECURE === 1,
        sessionDays: config.SESSION_DAYS,
        tz: config.TIMEZONE,
      },
    },
    true,
  );
  if (created.length) app.log.info({ created }, 'bootstrap users created');
  if (users.count() === 0) {
    app.log.warn(
      'No users yet: set ADMIN_EMAIL/ADMIN_PASSWORD in .env and restart to create an admin.',
    );
  }
  // ANA-155: AI jobs are in-memory, so a restart drops every pending/running entry — the slot
  // starts clean (a hung generation can no longer outlive the process that owned it). Clients
  // polling a lost jobId get 404 and the honest «прервана — запустите ещё раз» note.
  app.log.info(
    'AI job queue starts clean after restart: in-memory jobs are gone, the slot is free',
  );
  try {
    await app.listen({ port: config.API_PORT, host: process.env.HOST ?? '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Zero-downtime: systemd (RestartKillSignal/TimeoutStopSec) и docker compose посылают SIGTERM.
  // Без app.close() соединения обрывались посреди LLM-отчёта/синка. Graceful shutdown:
  // дождаться in-flight запросов (fastify close), затем выйти в 0. На случай зависших
  // соединений — жёсткий exit через 10 с (TimeoutStopSec systemd стоит отличать от этого).
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down gracefully');
    const t = setTimeout(() => {
      app.log.warn('graceful shutdown timed out — forcing exit');
      process.exit(0);
    }, 10000);
    t.unref();
    try {
      await app.close();
    } catch (err) {
      app.log.error({ err }, 'error during app.close()');
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void main();
