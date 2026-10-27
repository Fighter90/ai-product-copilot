import type { DB } from '../connection';
import type { SyncRunStatus, SyncStepError } from '@pca/shared';

interface SyncRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  date_from: string;
  date_to: string;
  status: SyncRunStatus['status'] | 'running';
  summary: string | null;
  errors: string | null;
}

function toStatus(r: SyncRunRow): SyncRunStatus {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? '',
    from: r.date_from,
    to: r.date_to,
    // A row still 'running' means the process died mid-sync — report it as failed (ANA-15:
    // the UI must never show a phantom success; the shared type has no 'running' state).
    status: r.status === 'running' ? ('failed' as const) : r.status,
    summary: r.summary ? (JSON.parse(r.summary) as Record<string, unknown>) : undefined,
    errors: r.errors ? (JSON.parse(r.errors) as SyncStepError[]) : [],
  };
}

/**
 * ANA-15: persistence for sync runs — the UI reads the latest outcome via GET /api/sync/status
 * instead of scraping console output. Written by the sync route around the SyncRunner call.
 */
export class SyncRunRepo {
  constructor(private readonly db: DB) {}

  /** Open a `running` row when a sync starts; returns its id. */
  start(from: string, to: string, now: () => string = () => new Date().toISOString()): number {
    const r = this.db
      .prepare(
        `INSERT INTO sync_runs (started_at, date_from, date_to, status) VALUES (?, ?, ?, 'running')
         RETURNING id`,
      )
      .get(now(), from, to) as { id: number };
    return r.id;
  }

  /** Close a run with its final status, the SyncSummary and the per-step errors. */
  finish(
    id: number,
    status: Exclude<SyncRunStatus['status'], 'ok'> | 'ok',
    summary?: Record<string, unknown>,
    errors: SyncStepError[] = [],
    now: () => string = () => new Date().toISOString(),
  ): void {
    this.db
      .prepare(
        `UPDATE sync_runs SET finished_at = ?, status = ?, summary = ?, errors = ? WHERE id = ?`,
      )
      .run(now(), status, summary ? JSON.stringify(summary) : null, JSON.stringify(errors), id);
  }

  /** The most recent run (any status), or undefined before the first sync. */
  latest(): SyncRunStatus | undefined {
    const r = this.db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get() as
      SyncRunRow | undefined;
    return r ? toStatus(r) : undefined;
  }
}
