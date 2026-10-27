import { config, hasCounterId } from '../config';
import { openDb } from '../db/connection';
import { migrate } from '../db/migrate';
import { MetricsRepo } from '../db/repositories/metrics-repo';
import { MetrikaClient } from './client';
import { SyncService } from './sync-service';
import type { SyncRunner } from '../routes/sync';

/** Runtime source of Metrika credentials (admin settings in cabinet mode, .env otherwise). */
export interface MetrikaCredentials {
  readonly token: () => string;
  readonly counterId: () => number;
}

const envCredentials: MetrikaCredentials = {
  token: () => config.YANDEX_OAUTH_TOKEN,
  counterId: () => config.COUNTER_ID,
};

/**
 * Optional per-request pacing for the Reporting API (ANA-65): the per-user quota
 * (`quota_requests_by_uid`) is shared with any manual tooling, so a 365-day backfill sets
 * METRIKA_REQUEST_DELAY_MS (e.g. 250) to space requests out instead of burning the quota in
 * under a minute. 0/unset → no delay. Implemented as a client wrapper — a seam, so the sync
 * logic and its tests stay untouched.
 */
function pacedClient(token: string): MetrikaClient {
  const delayMs = Number(process.env.METRIKA_REQUEST_DELAY_MS ?? 0);
  const inner = new MetrikaClient({ token });
  if (!Number.isFinite(delayMs) || delayMs <= 0) return inner;
  return {
    get: async (path, params, schema) => {
      await new Promise((r) => setTimeout(r, delayMs));
      return inner.get(path, params, schema);
    },
  } as MetrikaClient;
}

/**
 * Production sync runner: lazily opens the SQLite DB and builds a token-backed Metrika client.
 * The service is rebuilt whenever the token or counter changes (admin edits settings at runtime).
 * Excluded from coverage — IO bootstrap requiring a real token + database.
 */
export function makeSyncRunner(creds: MetrikaCredentials = envCredentials): SyncRunner {
  let svc: SyncService | undefined;
  let key = '';
  return async (body) => {
    const counterId = creds.counterId();
    const token = creds.token();
    if (!hasCounterId(counterId)) {
      throw new Error(
        'COUNTER_ID is not set — the administrator sets the Metrika counter in Settings (or .env).',
      );
    }
    const next = `${counterId}|${token.slice(-8)}`;
    if (!svc || key !== next) {
      const db = openDb(config.DB_PATH);
      migrate(db);
      svc = new SyncService({
        client: pacedClient(token),
        metrics: new MetricsRepo(db),
        counterId,
        archivedThreshold: config.ARCHIVED_GOAL_ID_THRESHOLD,
        now: () => new Date().toISOString(),
      });
      key = next;
    }
    return svc.syncAll(body.from, body.to, body.goalId);
  };
}
