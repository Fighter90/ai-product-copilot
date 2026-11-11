import { describe, it, expect, vi, afterEach } from 'vitest';
import { AI_JOB_MAX_POLLS, AI_JOB_POLL_MS, isBusyError, trackAiJob } from './ai-jobs';
import { ApiError, type AiJobView } from './api';

/** ANA-133: client-side polling of the backend's single-slot background AI jobs. */

const noDelay = async (): Promise<void> => undefined;
const job = (over: Partial<AiJobView>): AiJobView => ({
  id: 'job-1',
  kind: 'insights',
  status: 'running',
  ...over,
});

describe('trackAiJob (ANA-133)', () => {
  afterEach(() => {
    window.localStorage.removeItem('pca.locale');
    vi.restoreAllMocks();
  });

  it('resolves with the job result when it is already done', async () => {
    const getJob = vi.fn(async () => job({ status: 'done', result: { narrative: 'готово' } }));
    await expect(
      trackAiJob<{ narrative: string }>('job-1', getJob, { delay: noDelay }),
    ).resolves.toEqual({ narrative: 'готово' });
    expect(getJob).toHaveBeenCalledWith('job-1');
  });

  it('keeps polling while running and waits AI_JOB_POLL_MS between polls', async () => {
    let calls = 0;
    const getJob = vi.fn(async () =>
      calls++ === 0 ? job({}) : job({ status: 'done', result: 7 }),
    );
    const waits: number[] = [];
    const res = await trackAiJob<number>('job-1', getJob, {
      delay: async (ms) => {
        waits.push(ms);
      },
    });
    expect(res).toBe(7);
    expect(waits).toEqual([AI_JOB_POLL_MS]);
  });

  it('throws the server failure message so it reaches the UI verbatim', async () => {
    const getJob = vi.fn(async () => job({ status: 'failed', error: 'no key' }));
    await expect(trackAiJob('job-1', getJob, { delay: noDelay })).rejects.toThrow('no key');
  });

  it('falls back to a localized message when the failure carries no text', async () => {
    window.localStorage.setItem('pca.locale', 'ru');
    const getJob = vi.fn(async () => job({ status: 'failed' }));
    await expect(trackAiJob('job-1', getJob, { delay: noDelay })).rejects.toThrow(/не удалась/);
  });

  it('reports honest failure for a lost job (404 — e.g. the server restarted)', async () => {
    window.localStorage.setItem('pca.locale', 'ru');
    const getJob = vi.fn(async () => {
      throw new ApiError(404, 'job not found');
    });
    await expect(trackAiJob('job-1', getJob, { delay: noDelay })).rejects.toThrow(/прервана/);
  });

  it('propagates non-404 HTTP errors unchanged', async () => {
    const boom = new ApiError(500, 'boom');
    const getJob = vi.fn(async () => {
      throw boom;
    });
    await expect(trackAiJob('job-1', getJob, { delay: noDelay })).rejects.toBe(boom);
  });

  it(`gives up after the poll cap (${AI_JOB_MAX_POLLS}) with a localized timeout`, async () => {
    window.localStorage.setItem('pca.locale', 'ru');
    const getJob = vi.fn(async () => job({}));
    await expect(
      trackAiJob('job-1', getJob, { delay: noDelay, polls: AI_JOB_MAX_POLLS }),
    ).rejects.toThrow(/10 минут/);
    expect(getJob).toHaveBeenCalledTimes(AI_JOB_MAX_POLLS + 1);
  });

  it('isBusyError detects only the 429 busy signal', () => {
    expect(isBusyError(Object.assign(new Error('busy'), { status: 429 }))).toBe(true);
    expect(isBusyError(new ApiError(500, 'x'))).toBe(false);
    expect(isBusyError(new Error('plain'))).toBe(false);
    expect(isBusyError(undefined)).toBe(false);
    expect(isBusyError('string')).toBe(false);
  });
});
