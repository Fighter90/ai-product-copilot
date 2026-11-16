import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { syncRoutes, withDefaultGoal, outcomeOf, type SyncRunner } from '../../src/routes/sync';

function appWith(runSync: SyncRunner): FastifyInstance {
  const app = Fastify();
  app.register(syncRoutes, { prefix: '/api', runSync });
  return app;
}

/** ANA-139: same harness with a gaps source wired (the refill endpoint's dependency). */
function appWithGaps(
  runSync: SyncRunner,
  coverageGaps: NonNullable<Parameters<typeof syncRoutes>[1]>['coverageGaps'],
): FastifyInstance {
  const app = Fastify();
  app.register(syncRoutes, { prefix: '/api', runSync, coverageGaps });
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

  it('accepts force in the body and passes it to the runner (ANA-153)', async () => {
    const runSync = vi.fn().mockResolvedValue({ goals: 0, days: 0 });
    const app = appWith(runSync as unknown as SyncRunner);
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { from: '2025-01-01', to: '2025-01-07', force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(runSync).toHaveBeenCalledWith({ from: '2025-01-01', to: '2025-01-07', force: true });
    await app.close();
  });
});

// ANA-139 (12.11 prod feedback): interior holes in the derived stat tables (utm/geo/pages) are
// invisible to the per-table min/max and can only be repaired by re-parsing exactly the missing
// days — a full-window re-sync would spend Metrika quota on days that are already good.
describe('POST /api/sync/gaps (ANA-139 refill)', () => {
  const summary = {
    goals: 1,
    days: 1,
    channelRows: 1,
    utmRows: 1,
    geoDeviceRows: 0,
    pageRows: 0,
    exitPageRows: 0,
  };

  it('refills exactly the merged holes and echoes the gap report', async () => {
    const runSync = vi.fn().mockResolvedValue(summary);
    // ANA-139 review: capture the window the holes source received — the route must probe the
    // requested period verbatim (no clamping or derivation), otherwise the echoed report would
    // describe a different window than the one the admin asked to refill.
    const probed: Array<{ from: string; to: string }> = [];
    const app = appWithGaps(runSync as unknown as SyncRunner, (from, to) => {
      probed.push({ from, to });
      return {
        channels: [],
        utm: [{ from: '2025-01-03', to: '2025-01-04' }],
        geoDevice: [],
        pages: [{ from: '2025-01-04', to: '2025-01-05' }],
        exitPages: [],
      };
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/gaps',
      payload: { from: '2025-01-01', to: '2025-01-10' },
    });
    expect(res.statusCode).toBe(200);
    // from/to plumbing: the source received the requested window verbatim, exactly once.
    expect(probed).toEqual([{ from: '2025-01-01', to: '2025-01-10' }]);
    // The utm hole (03–04) and the pages hole (04–05) overlap → ONE merged window 03–05.
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith({ from: '2025-01-03', to: '2025-01-05' });
    expect(res.json()).toEqual({
      from: '2025-01-01',
      to: '2025-01-10',
      gaps: {
        channels: [],
        utm: [{ from: '2025-01-03', to: '2025-01-04' }],
        geoDevice: [],
        pages: [{ from: '2025-01-04', to: '2025-01-05' }],
        exitPages: [],
      },
      synced: [{ from: '2025-01-03', to: '2025-01-05', summary }],
    });
    await app.close();
  });

  it('never calls the runner when the window has no gaps (quota untouched)', async () => {
    const runSync = vi.fn().mockResolvedValue(summary);
    const app = appWithGaps(runSync as unknown as SyncRunner, () => ({
      channels: [],
      utm: [],
      geoDevice: [],
      pages: [],
      exitPages: [],
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/gaps',
      payload: { from: '2025-01-01', to: '2025-01-03' },
    });
    expect(res.statusCode).toBe(200);
    expect(runSync).not.toHaveBeenCalled();
    expect(res.json().synced).toEqual([]);
    await app.close();
  });

  it('falls back to one whole-window sync when the holes are too scattered', async () => {
    const runSync = vi.fn().mockResolvedValue(summary);
    // 17 pairwise non-adjacent single-day holes (Jan 1, 3, 5 … Feb 2) — pulling each one costs
    // more Metrika calls (pages/exit stay per-day loops) than one range pass over the window.
    const scattered = Array.from({ length: 17 }, (_, i) => {
      const day = new Date(Date.UTC(2025, 0, 1 + i * 2)).toISOString().slice(0, 10);
      return { from: day, to: day };
    });
    const app = appWithGaps(runSync as unknown as SyncRunner, () => ({
      channels: [],
      utm: scattered,
      geoDevice: [],
      pages: [],
      exitPages: [],
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/gaps',
      payload: { from: '2025-01-01', to: '2025-02-28' },
    });
    expect(res.statusCode).toBe(200);
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith({ from: '2025-01-01', to: '2025-02-28' });
    await app.close();
  });

  it('passes force through to the runner (admin-explicit overwrite mode)', async () => {
    const runSync = vi.fn().mockResolvedValue(summary);
    const app = appWithGaps(runSync as unknown as SyncRunner, () => ({
      channels: [],
      utm: [{ from: '2025-01-02', to: '2025-01-02' }],
      geoDevice: [],
      pages: [],
      exitPages: [],
    }));
    await app.inject({
      method: 'POST',
      url: '/api/sync/gaps',
      payload: { from: '2025-01-01', to: '2025-01-03', force: true },
    });
    expect(runSync).toHaveBeenCalledWith({ from: '2025-01-02', to: '2025-01-02', force: true });
    await app.close();
  });

  it('answers 503 when the wiring has no gaps source (legacy mode)', async () => {
    const runSync = vi.fn().mockResolvedValue(summary);
    const app = appWith(runSync as unknown as SyncRunner);
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/gaps',
      payload: { from: '2025-01-01', to: '2025-01-03' },
    });
    expect(res.statusCode).toBe(503);
    expect(runSync).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an invalid body with 400', async () => {
    const app = appWithGaps(vi.fn() as unknown as SyncRunner, () => ({
      channels: [],
      utm: [],
      geoDevice: [],
      pages: [],
      exitPages: [],
    }));
    const res = await app.inject({ method: 'POST', url: '/api/sync/gaps', payload: { from: 1 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ANA-139 (round-3 review): a garbage date made the route iterate zero hole days and no-op
  // with 200 — the admin's refill silently did nothing. Validate the window before the source.
  it('rejects malformed dates with 400 and never touches the runner or the holes source', async () => {
    const runSync = vi.fn();
    const coverageGaps = vi.fn(() => ({
      channels: [],
      utm: [],
      geoDevice: [],
      pages: [],
      exitPages: [],
    }));
    const app = appWithGaps(runSync as unknown as SyncRunner, coverageGaps);
    const malformed = [
      { from: 'not-a-date', to: '2025-01-07' },
      { from: '2025-01-01', to: '07.01.2025' },
      { from: '2025-13-01', to: '2025-01-07' },
      { from: '2025-02-30', to: '2025-03-01' },
    ];
    for (const payload of malformed) {
      const res = await app.inject({ method: 'POST', url: '/api/sync/gaps', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error).toBe('invalid body');
    }
    expect(runSync).not.toHaveBeenCalled();
    expect(coverageGaps).not.toHaveBeenCalled();
    await app.close();
  });

  it('propagates a failing refill run (the remaining holes stay for a retry)', async () => {
    const runSync = vi.fn().mockRejectedValue(new Error('Metrika 429 quota'));
    const app = appWithGaps(runSync as unknown as SyncRunner, () => ({
      channels: [],
      utm: [{ from: '2025-01-02', to: '2025-01-02' }],
      geoDevice: [],
      pages: [],
      exitPages: [],
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/gaps',
      payload: { from: '2025-01-01', to: '2025-01-03' },
    });
    expect(res.statusCode).toBe(500);
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

  it('passes force through to the runner (ANA-153 zero-protection bypass)', async () => {
    const run = vi.fn().mockResolvedValue(summary);
    await withDefaultGoal(run, () => 42)({ from: 'a', to: 'b', force: true });
    expect(run).toHaveBeenCalledWith({ from: 'a', to: 'b', goalId: 42, force: true });
    // no force flag → the protection stays on (force key omitted, not just false)
    await withDefaultGoal(run, () => 42)({ from: 'a', to: 'b' });
    expect(run).toHaveBeenLastCalledWith({ from: 'a', to: 'b', goalId: 42 });
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

  // ANA-139: a gap refill spends Metrika quota too — every refill window is recorded like a
  // /sync run (REG-05 parity), so the admin sync-status UI shows what the refill pulled.
  it('records each gap-refill window as its own run (ANA-139)', async () => {
    const rec = recorder();
    const summary = { goals: 1, days: 2, channelRows: 2 };
    const app = Fastify();
    app.register(syncRoutes, {
      prefix: '/api',
      runSync: vi.fn().mockResolvedValue(summary) as unknown as SyncRunner,
      recordRun: rec as unknown as never,
      coverageGaps: () => ({
        channels: [],
        utm: [
          { from: '2025-01-02', to: '2025-01-03' },
          { from: '2025-01-06', to: '2025-01-06' },
        ],
        geoDevice: [],
        pages: [],
        exitPages: [],
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/gaps',
      payload: { from: '2025-01-01', to: '2025-01-07' },
    });
    expect(res.statusCode).toBe(200);
    expect(rec.start).toHaveBeenCalledTimes(2);
    expect(rec.start).toHaveBeenNthCalledWith(1, '2025-01-02', '2025-01-03');
    expect(rec.start).toHaveBeenNthCalledWith(2, '2025-01-06', '2025-01-06');
    expect(rec.finish).toHaveBeenCalledTimes(2);
    expect(rec.finish).toHaveBeenCalledWith(1, 'ok', summary, []);
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
