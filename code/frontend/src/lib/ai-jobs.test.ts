import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AI_JOB_MAX_POLLS,
  AI_JOB_POLL_MS,
  busyJobInfo,
  isBusyError,
  jobErrorHint,
  trackAiJob,
} from './ai-jobs';
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
    ).rejects.toThrow(/16 минут/);
    expect(getJob).toHaveBeenCalledTimes(AI_JOB_MAX_POLLS + 1);
  });

  // ANA-155 (review r2): the backend watchdog (AI_JOB_MAX_RUN_MS, default 15 min) frees the
  // slot of a hung generation and a parked Auto job is promoted — the client must outlive
  // the watchdog to OBSERVE that takeover, otherwise it dies with a generic timeout before
  // the honest «превышен таймаут (15 мин) — слот освобождён» failure can arrive.
  // The env is tunable — this hardcoded 15 min is the documented default; the coupling
  // «keep the env below the client's poll budget» is written at the env definition
  // (code/backend/src/config.ts, AI_JOB_MAX_RUN_MS) so ops changing one side finds the other.
  it('the poll budget outlives the backend watchdog (15 min) so a takeover is observable', () => {
    expect(AI_JOB_MAX_POLLS * AI_JOB_POLL_MS).toBeGreaterThan(15 * 60_000);
  });

  it('isBusyError detects only the 429 busy signal', () => {
    expect(isBusyError(Object.assign(new Error('busy'), { status: 429 }))).toBe(true);
    expect(isBusyError(new ApiError(500, 'x'))).toBe(false);
    expect(isBusyError(new Error('plain'))).toBe(false);
    expect(isBusyError(undefined)).toBe(false);
    expect(isBusyError('string')).toBe(false);
  });
});

describe('jobErrorHint (ANA-132)', () => {
  const BUSY = 'Другая AI-генерация уже выполняется';
  const UNREADABLE = 'AI-генерация не удалась — попробуйте ещё раз.';

  it('maps the busy 429 signal to the localized busy note', () => {
    expect(
      jobErrorHint(
        Object.assign(new Error('{"code":"AI_BUSY"}'), { status: 429 }),
        BUSY,
        UNREADABLE,
      ),
    ).toBe(BUSY);
  });

  it('passes a readable server message through unchanged', () => {
    expect(jobErrorHint(new Error('AI returned invalid JSON'), BUSY, UNREADABLE)).toBe(
      'AI returned invalid JSON',
    );
  });

  it('maps a raw-JSON job.error (proxy/provider body) to the localized failure note', () => {
    expect(
      jobErrorHint(
        new Error('{"error":{"code":429,"message":"quota exceeded"}}'),
        BUSY,
        UNREADABLE,
      ),
    ).toBe(UNREADABLE);
    expect(jobErrorHint(new Error('["rate limited"]'), BUSY, UNREADABLE)).toBe(UNREADABLE);
  });

  it('maps a missing message to the localized failure note', () => {
    expect(jobErrorHint(undefined, BUSY, UNREADABLE)).toBe(UNREADABLE);
    expect(jobErrorHint(new Error(), BUSY, UNREADABLE)).toBe(UNREADABLE);
  });
});

describe('busyJobInfo (ANA-155)', () => {
  const body = {
    code: 'AI_BUSY',
    job: {
      kind: 'insights',
      provider: 'openrouter',
      startedAt: '2026-11-15T10:00:00.000Z',
      expectedReleaseAt: '2026-11-15T10:15:00.000Z',
    },
  };

  it('extracts the holder info from the enriched 429 body', () => {
    expect(busyJobInfo(new ApiError(429, 'busy', body))).toEqual(body.job);
  });

  it('returns null for a plain 429 without the enriched job payload', () => {
    expect(busyJobInfo(new ApiError(429, 'busy'))).toBeNull();
    expect(busyJobInfo(new ApiError(429, 'busy', { code: 'AI_BUSY' }))).toBeNull();
    expect(busyJobInfo(new ApiError(429, 'busy', { job: { provider: 42 } }))).toBeNull();
  });

  // ANA-155 (review r3): kind is validated like every other field — a payload without a
  // readable kind yields null (plain hint) instead of a silently invented «AI-анализ» label.
  it('returns null when the payload carries no valid kind — never invents «insights»', () => {
    expect(
      busyJobInfo(
        new ApiError(429, 'busy', {
          job: {
            provider: 'openrouter',
            startedAt: '2026-11-15T10:00:00.000Z',
            expectedReleaseAt: '2026-11-15T10:15:00.000Z',
          },
        }),
      ),
    ).toBeNull();
    expect(busyJobInfo(new ApiError(429, 'busy', { job: { ...body.job, kind: 42 } }))).toBeNull();
  });

  it('returns null for anything that is not the AI-busy 429', () => {
    expect(busyJobInfo(new ApiError(500, 'boom', body))).toBeNull();
    expect(busyJobInfo(new Error('plain'))).toBeNull();
    expect(busyJobInfo(undefined)).toBeNull();
  });
});
