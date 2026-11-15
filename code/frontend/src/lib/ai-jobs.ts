import { translate } from '../i18n';
import type { AiJobView } from './api';
import { errorMessage } from './error-message';
import type { Locale } from '../store/prefs';

/**
 * ANA-133: the backend runs AI generation in a single-slot background queue — POST answers
 * 202 {jobId} immediately and the client polls GET /report/ai-jobs/:jobId. This helper turns
 * that polling into one promise for the api client: it resolves with the job result and
 * throws with a ready-to-display (localized) message on failure, a lost job (404 — e.g. the
 * server restarted and the in-memory queue is gone) or the overall timeout.
 */

/** Poll interval — a generation takes minutes, there is nothing to gain by hammering. */
export const AI_JOB_POLL_MS = 2000;
/**
 * Poll budget: 480 × 2s ≈ 16 minutes — above the documented 5–10 minutes a report AI
 * analysis may take (rep.ai.pendingNote), and — ANA-155 — above the backend's watchdog
 * (AI_JOB_MAX_RUN_MS, default 15 min), so the client observes a hung job's takeover
 * («превышен таймаут (15 мин) — слот освобождён») instead of dying with a generic
 * timeout before the honest failure can arrive.
 */
export const AI_JOB_MAX_POLLS = 480;

/** The HTTP status carried by ApiError — status-only checks keep this module import-cycle-free. */
function errStatus(err: unknown): number | undefined {
  return (err as { status?: number } | undefined)?.status;
}

/** True when the error is the backend's 429 «another generation already holds the slot». */
export function isBusyError(err: unknown): boolean {
  return errStatus(err) === 429;
}

/** ANA-155: the enriched 429 payload — who holds the slot, since when, expected release. */
export interface AiBusyJobInfo {
  readonly kind: string;
  readonly provider: string;
  readonly startedAt: string;
  readonly expectedReleaseAt: string;
}

/**
 * ANA-155: extract the holder info from a busy (429) error. The backend's 429 body carries
 * `{ code: 'AI_BUSY', job: { kind, provider, startedAt, expectedReleaseAt } }`; anything
 * else (older backend, proxy page, non-429, a field with an unexpected type) yields null
 * and the UI shows the plain hint — ANA-155 (review r3): `kind` is validated like every
 * other field, the UI never displays an invented label (anti-hallucination).
 */
export function busyJobInfo(err: unknown): AiBusyJobInfo | null {
  if (!isBusyError(err)) return null;
  const job = (err as { body?: { job?: Partial<AiBusyJobInfo> } | undefined }).body?.job;
  if (
    !job ||
    typeof job.kind !== 'string' ||
    typeof job.provider !== 'string' ||
    typeof job.startedAt !== 'string' ||
    typeof job.expectedReleaseAt !== 'string'
  ) {
    return null;
  }
  return {
    kind: job.kind,
    provider: job.provider,
    startedAt: job.startedAt,
    expectedReleaseAt: job.expectedReleaseAt,
  };
}

/**
 * ANA-132: ready-to-display hint for a failed background AI job. The busy case (429 —
 * another generation holds the slot) gets the localized busy note; a job whose `error` is
 * machine JSON (the raw proxy/provider body — the ANA-133 precedent) gives an analyst
 * nothing actionable and is mapped to the localized generic failure note; any other
 * readable server message passes through unchanged.
 */
export function jobErrorHint(err: unknown, busyText: string, unreadableText: string): string {
  if (isBusyError(err)) return busyText;
  const message = errorMessage(err);
  if (!message || /^\s*[[{]/.test(message)) return unreadableText;
  return message;
}

/** Same locale resolution as readableError (api.ts): the visitor's persisted choice. */
function currentLocale(): Locale {
  return typeof window !== 'undefined' && window.localStorage?.getItem('pca.locale') === 'en'
    ? 'en'
    : 'ru';
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll a background AI job until it settles. Resolves with the job's `result` payload
 * (cast to `T` by the caller, which knows the kind it started). Throws an Error whose
 * message is user-displayable: the server's failure message or the localized
 * «job lost» / «timed out» note.
 */
export async function trackAiJob<T>(
  jobId: string,
  getJob: (id: string) => Promise<AiJobView>,
  opts: { delay?: (ms: number) => Promise<void>; polls?: number } = {},
): Promise<T> {
  const wait = opts.delay ?? defaultDelay;
  const maxPolls = opts.polls ?? AI_JOB_MAX_POLLS;
  const locale = currentLocale();
  for (let poll = 0; ; poll++) {
    let job: AiJobView;
    try {
      job = await getJob(jobId);
    } catch (err) {
      // 404 = the job is unknown: never started, pruned or lost to a server restart —
      // the honest «generation failed, retry» contract of the in-memory queue (ANA-133).
      if (errStatus(err) === 404) throw new Error(translate(locale, 'rep.ai.jobLost'));
      throw err;
    }
    if (job.status === 'done') return job.result as T;
    if (job.status === 'failed') {
      throw new Error(job.error || translate(locale, 'rep.ai.jobFailed'));
    }
    if (poll >= maxPolls) throw new Error(translate(locale, 'rep.ai.jobTimeout'));
    await wait(AI_JOB_POLL_MS);
  }
}
