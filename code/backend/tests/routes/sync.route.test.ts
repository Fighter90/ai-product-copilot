import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { syncRoutes, withDefaultGoal, type SyncRunner } from '../../src/routes/sync';

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
