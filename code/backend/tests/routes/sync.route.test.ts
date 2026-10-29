import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { syncRoutes, withDefaultGoal, outcomeOf, type SyncRunner } from '../../src/routes/sync';

function appWith(runSync: SyncRunner): FastifyInstance {
  const app = Fastify();
  app.register(syncRoutes, { prefix: '/api', runSync });
  return app;
}

describe('POST /api/sync', () => {
  it('runs the sync and returns the summary', async () => {
    const runSync = vi.fn().mockResolvedValue({
      goals: 2,
      days: 1,
      channelRows: 1,
      utmRows: 1,
      geoDeviceRows: 1,
      pageRows: 1,
      exitPageRows: 1,
    });
    const app = appWith(runSync as unknown as SyncRunner);
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { from: '2025-01-01', to: '2025-01-07', goalId: 80 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      goals: 2,
      days: 1,
      channelRows: 1,
      utmRows: 1,
      geoDeviceRows: 1,
      pageRows: 1,
      exitPageRows: 1,
    });
    expect(runSync).toHaveBeenCalledWith({ from: '2025-01-01', to: '2025-01-07', goalId: 80 });
    await app.close();
  });

  it('rejects an invalid body with 400', async () => {
    const app = appWith(vi.fn() as unknown as SyncRunner);
    const res = await app.inject({ method: 'POST', url: '/api/sync', payload: { from: 123 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid body');
    await app.close();
  });
});

describe('withDefaultGoal (runtime GOAL_ID)', () => {
  const summary = { goals: 0, resolvedGoalId: undefined, days: 0 } as never;

  it('passes the pinned GOAL_ID when the request has none', async () => {
    const run = vi.fn().mockResolvedValue(summary);
    await withDefaultGoal(run, () => 42)({ from: 'a', to: 'b' });
    expect(run).toHaveBeenCalledWith({ from: 'a', to: 'b', goalId: 42 });
  });

  it('0 / NaN / negative GOAL_ID means auto-detect → goalId omitted', async () => {
    for (const pinned of [0, Number.NaN, -1, 1.5]) {
      const run = vi.fn().mockResolvedValue(summary);
      await withDefaultGoal(run, () => pinned)({ from: 'a', to: 'b' });
      expect(run).toHaveBeenCalledWith({ from: 'a', to: 'b' });
    }
  });

  it('an explicit positive goalId in the request wins; goalId 0 falls back to the setting', async () => {
    const run = vi.fn().mockResolvedValue(summary);
    const wrapped = withDefaultGoal(run, () => 42);
    await wrapped({ from: 'a', to: 'b', goalId: 7 });
    expect(run).toHaveBeenLastCalledWith({ from: 'a', to: 'b', goalId: 7 });
    await wrapped({ from: 'a', to: 'b', goalId: 0 });
    expect(run).toHaveBeenLastCalledWith({ from: 'a', to: 'b', goalId: 42 });
  });

  it('reads the setting on every call (admin change applies without a restart)', async () => {
    const run = vi.fn().mockResolvedValue(summary);
    let pinned = 0;
    const wrapped = withDefaultGoal(run, () => pinned);
    await wrapped({ from: 'a', to: 'b' });
    pinned = 99;
    await wrapped({ from: 'a', to: 'b' });
    expect(run.mock.calls.map((c) => c[0])).toEqual([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b', goalId: 99 },
    ]);
  });
});

// REG-05: one outcome function shared by POST /api/sync and the CLI sync (`pnpm sync`) — the CLI
// used to record an unconditional «ok» even when optional steps had failed.
describe('outcomeOf (REG-05)', () => {
  const base = { goals: 1, days: 1 };

  it('ok when the summary has no (or an empty) errors list', () => {
    expect(outcomeOf(base as never)).toBe('ok');
    expect(outcomeOf({ ...base, errors: [] } as never)).toBe('ok');
  });

  it('partial when any optional step failed', () => {
    expect(outcomeOf({ ...base, errors: [{ step: 'utm', message: '400' }] } as never)).toBe(
      'partial',
    );
  });
});

// ANA-15 (appended): every run is recorded (ok / partial / failed) and readable via
// GET /api/sync/status so the admin UI can show the last result and its step errors.
describe('sync run recording (ANA-15)', () => {
  interface Run {
    id: number;
    status: string;
    summary?: Record<string, unknown>;
    errors: unknown[];
  }
  function recorder() {
    const runs: Run[] = [];
    let next = 1;
    return {
      runs,
      start: vi.fn(() => next++),
      finish: vi.fn(
        (id: number, status: string, summary?: Record<string, unknown>, errors: unknown[] = []) => {
          runs.push({ id, status, summary, errors });
        },
      ),
      latest: vi.fn(() => runs.at(-1)),
    };
  }

  function appWithRecorder(runSync: SyncRunner, rec: ReturnType<typeof recorder>): FastifyInstance {
    const app = Fastify();
    app.register(syncRoutes, {
      prefix: '/api',
      runSync,
      recordRun: rec as unknown as never,
    });
    return app;
  }

  it('records a clean run as ok and GET /sync/status returns it', async () => {
    const rec = recorder();
    const app = appWithRecorder(vi.fn().mockResolvedValue({ goals: 1, days: 1 }), rec);
    const post = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { from: '2025-01-01', to: '2025-01-07' },
    });
    expect(post.statusCode).toBe(200);
    expect(rec.finish).toHaveBeenCalledWith(1, 'ok', { goals: 1, days: 1 }, []);
    const status = await app.inject({ method: 'GET', url: '/api/sync/status' });
    expect(status.statusCode).toBe(200);
    // ANA-68 style: the response wraps the run — { run: {...} } — so «no sync yet» can be 200.
    expect(status.json()).toMatchObject({ run: { id: 1, status: 'ok' } });
    await app.close();
  });

  it('records a run with failed optional steps as partial, errors attached', async () => {
    const rec = recorder();
    const app = appWithRecorder(
      vi.fn().mockResolvedValue({ goals: 1, days: 1, errors: [{ step: 'utm', message: '400' }] }),
      rec,
    );
    await app.inject({ method: 'POST', url: '/api/sync', payload: { from: 'a', to: 'b' } });
    expect(rec.finish).toHaveBeenCalledWith(
      1,
      'partial',
      { goals: 1, days: 1, errors: [{ step: 'utm', message: '400' }] },
      [{ step: 'utm', message: '400' }],
    );
    await app.close();
  });

  it('records an aborted run as failed and rethrows (500)', async () => {
    const rec = recorder();
    const app = appWithRecorder(vi.fn().mockRejectedValue(new Error('token expired')), rec);
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { from: 'a', to: 'b' },
    });
    expect(res.statusCode).toBe(500);
    expect(rec.finish).toHaveBeenCalledWith(1, 'failed', undefined, [
      { step: 'sync', message: 'token expired' },
    ]);
    await app.close();
  });

  it('GET /sync/status returns 200 {run: null} before the first sync (no console 404)', async () => {
    const rec = recorder();
    const app = appWithRecorder(vi.fn(), rec);
    const status = await app.inject({ method: 'GET', url: '/api/sync/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ run: null });
    await app.close();
  });
});
