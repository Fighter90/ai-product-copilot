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
});
