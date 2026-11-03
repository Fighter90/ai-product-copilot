import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { RateLimiter, defaultRateLimiter } from '../utils/rate-limiter';
import { realSleep, withRetry } from '../utils/retry';
import { METRIKA_BASE_URL } from './endpoints';

/** Non-2xx response from Metrika. 429 and 5xx are retryable. */
export class MetrikaHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MetrikaHttpError';
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Response that did not match its Zod schema. The raw body is dumped for debugging. */
export class MetrikaSchemaError extends Error {
  constructor(
    public readonly issues: unknown,
    public readonly dumpPath: string,
  ) {
    super(`Metrika response failed schema validation (dump: ${dumpPath})`);
    this.name = 'MetrikaSchemaError';
  }
}

export interface FetchLike {
  (
    url: string,
    init: {
      readonly method?: string;
      readonly headers: Record<string, string>;
      readonly body?: string;
    },
  ): Promise<{
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }>;
}

export type QueryParams = Record<string, string | number | undefined>;

export interface MetrikaClientOptions {
  readonly token: string;
  /**
   * Резервный OAuth-токен другого аккаунта (ANA-107): суточные квоты quota_requests_by_uid
   * считаются НА АККАУНТ, поэтому при исчерпании основной квоты клиент повторяет запрос
   * под резервным токеном (его счётчик независим). Пусто — fallback выключен.
   */
  readonly backupToken?: string;
  readonly baseUrl?: string;
  readonly fetchFn?: FetchLike;
  readonly limiter?: RateLimiter;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly jitter?: () => number;
  readonly retries?: number;
  readonly errorDumpDir?: string;
  readonly now?: () => number;
}

/** Thin, typed, resilient client for the Yandex Metrika API. */
export class MetrikaClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly jitter: () => number;
  private readonly retries: number;
  private readonly errorDumpDir: string;
  private readonly now: () => number;

  private readonly backupToken?: string;

  constructor(opts: MetrikaClientOptions) {
    this.token = opts.token;
    this.backupToken = opts.backupToken;
    this.baseUrl = opts.baseUrl ?? METRIKA_BASE_URL;
    this.fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
    this.limiter = opts.limiter ?? defaultRateLimiter();
    this.sleep = opts.sleep ?? realSleep;
    this.jitter = opts.jitter ?? Math.random;
    this.retries = opts.retries ?? 5;
    this.errorDumpDir = opts.errorDumpDir ?? 'data/errors';
    this.now = opts.now ?? Date.now;
  }

  private buildUrl(path: string, params: QueryParams): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private dump(path: string, body: unknown, issues: unknown): string {
    mkdirSync(this.errorDumpDir, { recursive: true });
    const file = join(this.errorDumpDir, `metrika-error-${this.now()}.json`);
    writeFileSync(file, JSON.stringify({ path, body, issues }, null, 2));
    return file;
  }

  /** GET a Metrika endpoint, validate against `schema`, with rate-limiting + retry. */
  async get<T>(path: string, params: QueryParams, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, params, undefined, schema, { retryOnServerError: true });
  }

  /**
   * POST a JSON body to a Metrika endpoint (Management API writes: create/archive goals).
   * Writes are NOT retried on 5xx by default — the write may have landed server-side and a blind
   * retry could duplicate it (e.g. two identical goals). 429 is always retried; pass
   * `retryOnServerError` only for idempotent writes.
   */
  async post<T>(
    path: string,
    params: QueryParams,
    body: unknown,
    schema: z.ZodType<T>,
    opts: { readonly retryOnServerError?: boolean } = {},
  ): Promise<T> {
    return this.request(path, params, body, schema, opts);
  }

  private async request<T>(
    path: string,
    params: QueryParams,
    body: unknown,
    schema: z.ZodType<T>,
    opts: { readonly retryOnServerError?: boolean },
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    const method = body === undefined ? 'GET' : 'POST';

    const execWith = async (token: string): Promise<T> => {
      const wait = this.limiter.take();
      if (wait > 0) await this.sleep(wait);

      // GET sends exactly the legacy init shape ({ headers }) — only POST adds method/body.
      const res = await this.fetchFn(url, {
        ...(method === 'POST' ? { method } : {}),
        headers: {
          Authorization: `OAuth ${token}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new MetrikaHttpError(res.status, `Metrika ${res.status}: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new MetrikaSchemaError(
          parsed.error.issues,
          this.dump(path, json, parsed.error.issues),
        );
      }
      return parsed.data;
    };

    const exec = async (): Promise<T> => {
      try {
        return await execWith(this.token);
      } catch (err) {
        // ANA-107: основной аккаунт исчерпал суточную квоту — повторяем под резервным
        // токеном другого аккаунта (его счётчик независим). Один переключатель на запрос:
        // если резервный тоже упал — ошибка уходит в retry-цикл как раньше.
        const quotaHit =
          err instanceof MetrikaHttpError &&
          err.status === 429 &&
          err.message.includes('quota_requests_by_uid');
        if (quotaHit && this.backupToken) {
          return execWith(this.backupToken);
        }
        throw err;
      }
    };

    return withRetry(exec, {
      retries: this.retries,
      baseMs: 200,
      maxMs: 5000,
      jitter: this.jitter,
      sleep: this.sleep,
      isRetryable: (err) =>
        err instanceof MetrikaHttpError &&
        (err.status === 429 || (opts.retryOnServerError === true && err.status >= 500)),
    });
  }
}
