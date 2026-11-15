import { describe, it, expect } from 'vitest';
import { createAiJobQueue } from '../../src/report/ai-job-queue';

/** ANA-133: single-slot in-memory queue that moves AI generation out of the HTTP request. */

/** One macrotask turn — enough for setImmediate → run() → .then bookkeeping to land. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('ai-job-queue', () => {
  it('starts the job in the background: the caller gets an id before any work begins', async () => {
    const order: string[] = [];
    const queue = createAiJobQueue();
    const id = queue.start('insights', async () => {
      order.push('run');
      return { narrative: 'анализ' };
    });
    // The deferral (setImmediate) is the whole point of ANA-133: the HTTP handler returns
    // and the response is sent BEFORE the generation starts competing for the CPU.
    expect(id).toBeTruthy();
    expect(order).toEqual([]);
    await settle();
    expect(order).toEqual(['run']);
    const job = queue.get(id!);
    expect(job).toMatchObject({
      id,
      kind: 'insights',
      status: 'done',
      result: { narrative: 'анализ' },
    });
  });

  it('the second start while a job is running is rejected (busy) — capacity is exactly 1', async () => {
    const queue = createAiJobQueue();
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const first = queue.start('insights', () => gate);
    expect(first).toBeTruthy();
    // Running job → no new slot, regardless of kind.
    expect(queue.start('hypotheses', async () => 'x')).toBeNull();
    release('готово');
    await settle();
    expect(queue.get(first!)?.status).toBe('done');
    // The slot is free again after completion.
    expect(queue.start('insights', async () => 'y')).toBeTruthy();
  });

  it('a rejected run becomes a failed job with the extracted message', async () => {
    const queue = createAiJobQueue();
    const id = queue.start('hypotheses', async () => {
      throw new Error('no key');
    });
    await settle();
    expect(queue.get(id!)).toMatchObject({ status: 'failed', error: 'no key' });
  });

  it('non-Error rejections are stringified, not swallowed', async () => {
    const queue = createAiJobQueue();
    const id = queue.start('insights', async () => {
      throw 'boom';
    });
    await settle();
    expect(queue.get(id!)).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('get of an unknown id returns undefined (poll → honest 404 after a restart)', () => {
    const queue = createAiJobQueue();
    expect(queue.get('missing')).toBeUndefined();
  });

  it('finished jobs are pruned after the TTL; a running job is never pruned', async () => {
    let now = 1000;
    const queue = createAiJobQueue({ now: () => now, ttlMs: 500 });
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const id = queue.start('insights', () => gate);
    now = 100_000; // way past the TTL, but the job is still running
    expect(queue.get(id!)).toMatchObject({ status: 'running' });

    release('готово');
    await settle(); // finishedAt = now() = 100_000
    now = 100_400; // finished 400ms ago — still inside the TTL window
    expect(queue.get(id!)).toMatchObject({ status: 'done' });
    now = 100_600; // finished 600ms ago (> ttlMs) — pruned
    expect(queue.get(id!)).toBeUndefined();
  });

  it('prunes stale finished jobs on start() too, so the Map cannot grow unbounded', async () => {
    let now = 0;
    const queue = createAiJobQueue({ now: () => now, ttlMs: 100 });
    const first = queue.start('insights', async () => 'a');
    await settle();
    expect(queue.get(first!)?.status).toBe('done');
    now = 500;
    const second = queue.start('hypotheses', async () => 'b');
    expect(second).toBeTruthy();
    await settle();
    // The stale first job is gone from the map even though get() was not called for it.
    expect(queue.get(first!)).toBeUndefined();
    expect(queue.get(second!)).toMatchObject({ status: 'done' });
  });

  it('a pending run keeps status running until its promise settles', async () => {
    const queue = createAiJobQueue();
    let release!: (v: number) => void;
    const gate = new Promise<number>((resolve) => {
      release = resolve;
    });
    const id = queue.start('insights', () => gate);
    await settle();
    expect(queue.get(id!)?.status).toBe('running');
    release(7);
    await settle();
    expect(queue.get(id!)).toMatchObject({ status: 'done', result: 7 });
  });

  it('reports the kind of the stored job (insights vs hypotheses)', async () => {
    const queue = createAiJobQueue();
    const a = queue.start('hypotheses', async () => 'h');
    await settle();
    expect(queue.get(a!)?.kind).toBe('hypotheses');
  });

  // --- ANA-155: watchdog — a hung job must not hold the slot forever -----------------------

  it('ANA-155: a job running longer than maxRunMs is failed by the watchdog and the slot is freed', async () => {
    const queue = createAiJobQueue({ maxRunMs: 15 });
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const id = queue.start('insights', () => gate, { provider: 'openrouter' });
    expect(queue.get(id!)).toMatchObject({ status: 'running', provider: 'openrouter' });
    // Past the watchdog deadline the hung job is marked failed with a readable timeout note…
    await new Promise((resolve) => setTimeout(resolve, 50));
    const job = queue.get(id!);
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('таймаут');
    // …and the slot is usable again — before ANA-155 it stayed busy until a server restart.
    expect(queue.start('hypotheses', async () => 'x')).toBeTruthy();
    release('поздно');
  });

  it('ANA-155: a run that settles after the watchdog takeover cannot resurrect the job or steal the slot', async () => {
    const queue = createAiJobQueue({ maxRunMs: 15 });
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const hung = queue.start('insights', () => gate);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queue.get(hung!)?.status).toBe('failed');
    // A new job owns the slot now.
    const next = queue.start('insights', async () => 'актуальный');
    await settle();
    expect(queue.get(next!)).toMatchObject({ status: 'done', result: 'актуальный' });
    // The zombie's late settlement must not flip its entry back to done…
    release('поздно');
    await settle();
    expect(queue.get(hung!)).toMatchObject({ status: 'failed' });
    // …nor clear the slot under the new job (the new job still completes fine above).
    expect(queue.start('insights', async () => 'ещё раз')).toBeTruthy();
  });

  // --- ANA-155: Auto fallback — an Auto request parks (queue depth 1) instead of 429 -------

  it('ANA-155: an Auto request with queueIfBusy parks while the slot is busy and runs after it frees', async () => {
    const queue = createAiJobQueue();
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const holder = queue.start('insights', () => gate, { provider: 'openrouter' });
    const contexts: Array<unknown> = [];
    const parked = queue.start(
      'insights',
      async (ctx) => {
        contexts.push(ctx);
        return 'через очередь';
      },
      { provider: 'auto', queueIfBusy: true },
    );
    // The parked request gets a real job id (pollable «pending» view), not a 429.
    expect(parked).toBeTruthy();
    expect(parked).not.toBe(holder);
    expect(queue.get(parked!)).toMatchObject({ status: 'pending', provider: 'auto' });
    expect(contexts).toEqual([]);
    // The holder finishes → the parked job is promoted with the takeover context.
    release('готово');
    await settle();
    await settle();
    expect(queue.get(holder!)).toMatchObject({ status: 'done' });
    expect(queue.get(parked!)).toMatchObject({ status: 'done', result: 'через очередь' });
    // The holder completed normally → no watchdog takeover → no provider skip.
    expect(contexts).toEqual([{ previousTimedOut: false, previousProvider: 'openrouter' }]);
  });

  it('ANA-155: a second queueIfBusy request while a job is already parked gets null (429)', async () => {
    const queue = createAiJobQueue();
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    queue.start('insights', () => gate);
    const parked = queue.start('insights', async () => 'a', {
      provider: 'auto',
      queueIfBusy: true,
    });
    expect(parked).toBeTruthy();
    // Depth-1 park: the third Auto caller still gets the honest busy answer.
    expect(queue.start('hypotheses', async () => 'b', { queueIfBusy: true })).toBeNull();
    release('готово');
    await settle();
    await settle();
    expect(queue.get(parked!)).toMatchObject({ status: 'done' });
  });

  it('ANA-155: a parked job promoted after a watchdog takeover learns the timed-out provider', async () => {
    const queue = createAiJobQueue({ maxRunMs: 15 });
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    queue.start('insights', () => gate, { provider: 'openrouter' });
    const contexts: Array<unknown> = [];
    const parked = queue.start(
      'insights',
      async (ctx) => {
        contexts.push(ctx);
        return 'фолбэк';
      },
      { provider: 'auto', queueIfBusy: true },
    );
    expect(parked).toBeTruthy();
    // The watchdog kills the hung holder → the parked Auto job starts immediately.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle();
    expect(queue.get(parked!)).toMatchObject({ status: 'done', result: 'фолбэк' });
    expect(contexts).toEqual([{ previousTimedOut: true, previousProvider: 'openrouter' }]);
    release('поздно');
  });

  // ANA-155 (review r3): the holder's REQUESTED choice is recorded, not the actual chain
  // winner — an «auto» holder killed by the watchdog yields previousProvider: 'auto', which
  // the routes cannot skip, so the promoted job retries the FULL chain (skipOpts → undefined).
  it('ANA-155: a watchdog-killed holder pinned to «auto» hands previousProvider: "auto" to the promoted run', async () => {
    const queue = createAiJobQueue({ maxRunMs: 15 });
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    queue.start('insights', () => gate, { provider: 'auto' });
    const contexts: Array<unknown> = [];
    const parked = queue.start(
      'insights',
      async (ctx) => {
        contexts.push(ctx);
        return 'фолбэк';
      },
      { provider: 'auto', queueIfBusy: true },
    );
    expect(parked).toBeTruthy();
    // The watchdog kills the hung «auto» holder → the parked job is promoted right away.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle();
    expect(queue.get(parked!)).toMatchObject({ status: 'done', result: 'фолбэк' });
    // The takeover context names the holder's requested choice ('auto') — no chain member
    // can be skipped from it, the promoted run retries the whole chain.
    expect(contexts).toEqual([{ previousTimedOut: true, previousProvider: 'auto' }]);
    release('поздно');
  });

  // --- ANA-155: the 429 payload needs the holder's identity and expected release ----------

  it('ANA-155: current() reports who holds the slot and when it is expected to free', async () => {
    const now = 60_000;
    const maxRunMs = 15 * 60_000;
    const queue = createAiJobQueue({ now: () => now, maxRunMs });
    expect(queue.current()).toBeNull();
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const id = queue.start('hypotheses', () => gate, { provider: 'yandexgpt' });
    expect(queue.current()).toEqual({
      kind: 'hypotheses',
      provider: 'yandexgpt',
      startedAt: 60_000,
      expectedReleaseAt: 60_000 + maxRunMs,
    });
    release('готово');
    await settle();
    expect(queue.current()).toBeNull();
    expect(queue.get(id!)).toMatchObject({ status: 'done' });
  });

  it('ANA-155: the poll view of a running job carries the holder metadata (ANA-155)', async () => {
    const queue = createAiJobQueue();
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const id = queue.start('insights', () => gate, { provider: 'gigachat' });
    const job = queue.get(id!);
    expect(job?.status).toBe('running');
    expect(typeof job?.startedAt).toBe('string');
    release('готово');
  });

  // --- ANA-155: after a restart the in-memory queue starts clean ---------------------------

  it('ANA-155: a fresh queue (server restart) knows no jobs and the slot is free', async () => {
    const before = createAiJobQueue();
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const lost = before.start('insights', () => gate);
    expect(before.get(lost!)).toMatchObject({ status: 'running' });
    // …the process restarts (a new queue instance — jobs were in-memory only)…
    const after = createAiJobQueue();
    expect(after.get(lost!)).toBeUndefined();
    expect(after.current()).toBeNull();
    // …and the slot is immediately usable again.
    expect(after.start('insights', async () => 'после рестарта')).toBeTruthy();
    release('никогда не нужен');
  });
});
