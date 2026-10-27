import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers';
import { SyncRunRepo } from '../../src/db/repositories/sync-run-repo';

describe('SyncRunRepo (ANA-15)', () => {
  it('records a clean run and returns it via latest()', () => {
    const db = freshDb();
    const repo = new SyncRunRepo(db);
    expect(repo.latest()).toBeUndefined(); // nothing yet

    const id = repo.start('2025-01-01', '2025-01-07', () => 'T0');
    repo.finish(id, 'ok', { goals: 3, days: 7 }, [], () => 'T1');

    const run = repo.latest();
    expect(run).toMatchObject({
      id,
      startedAt: 'T0',
      finishedAt: 'T1',
      from: '2025-01-01',
      to: '2025-01-07',
      status: 'ok',
      errors: [],
    });
    expect(run?.summary).toEqual({ goals: 3, days: 7 });
    db.close();
  });

  it('records a failed run with the step errors; latest() returns the newest run', () => {
    const db = freshDb();
    const repo = new SyncRunRepo(db);
    const first = repo.start('2025-01-01', '2025-01-07', () => 'T0');
    repo.finish(first, 'failed', undefined, [{ step: 'sync', message: 'Metrika 429' }], () => 'T1');
    repo.start('2025-01-08', '2025-01-14', () => 'T2');

    const run = repo.latest();
    expect(run?.id).not.toBe(first);
    // The shared type has no 'running' state: an open (in-progress or crashed) row reads as failed.
    expect(run?.status).toBe('failed');
    db.close();
  });

  it('reports a crashed (never finished) run as failed, never as a phantom success', () => {
    const db = freshDb();
    const repo = new SyncRunRepo(db);
    repo.start('2025-01-01', '2025-01-07', () => 'T0');
    // Simulate the process dying mid-run: the row stays 'running' in the DB…
    const raw = db.prepare('SELECT status FROM sync_runs LIMIT 1').get() as { status: string };
    expect(raw.status).toBe('running');
    // …but the API maps it to failed.
    expect(repo.latest()?.status).toBe('failed');
    db.close();
  });

  it('marks a partial run when optional steps failed', () => {
    const db = freshDb();
    const repo = new SyncRunRepo(db);
    const id = repo.start('2025-01-01', '2025-01-07', () => 'T0');
    repo.finish(id, 'partial', { goals: 3 }, [{ step: 'utm', message: 'Metrika 400' }], () => 'T1');
    expect(repo.latest()).toMatchObject({ status: 'partial', errors: [{ step: 'utm' }] });
    db.close();
  });
});
