import type { DB } from '../db/connection';
import { decryptSecret, encryptSecret, maskSecret } from '../security/crypto';
import {
  PROVIDERS,
  PROVIDER_IDS,
  PROVIDER_META,
  ProviderError,
  redactSecrets,
  type CompletionRequest,
  type CompletionResult,
  type HttpFetch,
  type ProviderConfig,
  type ProviderId,
} from './providers';
import { ModelCatalog, type ModelInfo } from './model-catalog';

interface ProviderRow {
  id: ProviderId;
  enabled: number;
  priority: number;
  model: string;
  secret_enc: string | null;
  extra_json: string;
  updated_at: string;
  updated_by: string | null;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_test_message: string | null;
}

/** Admin-facing view of a provider — never contains the secret itself. */
export interface ProviderView {
  readonly id: ProviderId;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly model: string;
  readonly models: string[];
  readonly secretLabel: string;
  readonly secretMask: string;
  readonly hasSecret: boolean;
  readonly extras: Array<{ key: string; label: string; value: string }>;
  readonly docs: string;
  readonly lastTest: { at: string; ok: boolean; message: string } | null;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

export interface ProviderUpdate {
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly model?: string;
  /** New secret; undefined = keep, '' = clear. */
  readonly secret?: string;
  readonly extra?: Record<string, string>;
}

export type ProviderChoice = ProviderId | 'auto';

/** Initial values (from env) applied once when a provider row does not exist yet. */
export type ProviderSeeds = Partial<
  Record<ProviderId, { secret: string; model: string; extra?: Record<string, string> }>
>;

export interface RetryOptions {
  /** Extra attempts per provider for retryable errors (429/5xx/network). Default 2. */
  readonly maxRetries?: number;
  /** Backoff base, ms: attempt n waits base·2ⁿ unless Retry-After says otherwise. Default 1000. */
  readonly baseDelayMs?: number;
  /** Upper bound for an honoured Retry-After, ms. Default 10 000. */
  readonly maxRetryAfterMs?: number;
  /** Injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Per-purpose request timeouts for the long report generations (default: adapter's 120 s). */
export const PURPOSE_TIMEOUT_MS: Readonly<Record<string, number>> = {
  'report-hypotheses': 240_000,
  'report-decisions': 240_000,
};

/**
 * Stores provider settings (secrets AES-GCM encrypted) and runs completions through the
 * admin-defined fallback chain. Every call is recorded in `ai_usage` (sizes only, no content).
 */
export class LlmService {
  private readonly retry: Required<RetryOptions>;
  /** ANA-151: admin-side catalog — live OpenRouter (1h cache) or the extended static sets. */
  private readonly catalog: ModelCatalog;

  constructor(
    private readonly db: DB,
    private readonly appSecret: string,
    private readonly fetchFn: HttpFetch,
    private readonly now: () => Date = () => new Date(),
    retry: RetryOptions = {},
  ) {
    this.retry = {
      maxRetries: retry.maxRetries ?? 2,
      baseDelayMs: retry.baseDelayMs ?? 1000,
      maxRetryAfterMs: retry.maxRetryAfterMs ?? 10_000,
      sleep: retry.sleep ?? realSleep,
    };
    this.catalog = new ModelCatalog(fetchFn, () => this.now().getTime());
  }

  /** Create rows for all providers; seed secrets from env on first run. */
  init(seeds: ProviderSeeds): void {
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO ai_providers (id, enabled, priority, model, secret_enc, extra_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    PROVIDER_IDS.forEach((id, i) => {
      const seed = seeds[id];
      const hasSeed = !!seed?.secret;
      ins.run(
        id,
        hasSeed ? 1 : 0,
        (i + 1) * 10,
        seed?.model || PROVIDER_META[id].models[0]!,
        hasSeed ? encryptSecret(seed!.secret, this.appSecret) : null,
        JSON.stringify(seed?.extra ?? {}),
        this.now().toISOString(),
        hasSeed ? 'env' : null,
      );
    });
  }

  private rows(): ProviderRow[] {
    return this.db
      .prepare('SELECT * FROM ai_providers ORDER BY priority, id')
      .all() as ProviderRow[];
  }

  private row(id: ProviderId): ProviderRow | undefined {
    return this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as
      ProviderRow | undefined;
  }

  /** ciphertext → plaintext; decryption runs a scrypt KDF, too slow to repeat per row read. */
  private readonly decrypted = new Map<string, string>();

  private secretOf(r: ProviderRow): string {
    if (!r.secret_enc) return '';
    const cached = this.decrypted.get(r.secret_enc);
    if (cached !== undefined) return cached;
    let plain = '';
    try {
      plain = decryptSecret(r.secret_enc, this.appSecret);
    } catch {
      plain = '';
    }
    if (this.decrypted.size > 32) this.decrypted.clear();
    this.decrypted.set(r.secret_enc, plain);
    return plain;
  }

  private configOf(r: ProviderRow): ProviderConfig {
    return {
      id: r.id,
      model: r.model,
      secret: this.secretOf(r),
      extra: JSON.parse(r.extra_json || '{}') as Record<string, string>,
    };
  }

  list(): ProviderView[] {
    return this.rows().map((r) => {
      const meta = PROVIDER_META[r.id];
      const extra = JSON.parse(r.extra_json || '{}') as Record<string, string>;
      const secret = this.secretOf(r);
      return {
        id: r.id,
        name: meta.name,
        enabled: r.enabled === 1,
        priority: r.priority,
        model: r.model,
        models: meta.models,
        secretLabel: meta.secretLabel,
        secretMask: maskSecret(secret),
        hasSecret: secret.length > 0,
        extras: meta.extras.map((e) => ({ ...e, value: extra[e.key] ?? '' })),
        docs: meta.docs,
        lastTest: r.last_test_at
          ? { at: r.last_test_at, ok: r.last_test_ok === 1, message: r.last_test_message ?? '' }
          : null,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      };
    });
  }

  /**
   * REG-07: a provider whose last connectivity test failed (`last_test_ok = 0`) is excluded from
   * the chain and from /ai/available — «Авто» must not waste attempts on it. `null` (never tested)
   * and `1` (last test passed) stay eligible; a fresh successful «Проверить соединение» re-enables.
   */
  private usable(r: ProviderRow): boolean {
    return r.enabled === 1 && this.secretOf(r) !== '' && r.last_test_ok !== 0;
  }

  /** Providers usable right now (enabled + secret present + last test not failed), in chain order. */
  available(): Array<{ id: ProviderId; name: string; model: string }> {
    return this.rows()
      .filter((r) => this.usable(r))
      .map((r) => ({ id: r.id, name: PROVIDER_META[r.id].name, model: r.model }));
  }

  /**
   * ANA-151: full model catalog for the admin combobox — live OpenRouter (public endpoint, no key,
   * 1h cache) or the extended static set. Read-only, never touches the stored secrets.
   */
  providerModels(id: ProviderId): Promise<{ source: 'live' | 'static'; models: ModelInfo[] }> {
    return this.catalog.get(id);
  }

  update(id: ProviderId, patch: ProviderUpdate, by: string): ProviderView | undefined {
    const r = this.row(id);
    if (!r) return undefined;
    const extra = {
      ...(JSON.parse(r.extra_json || '{}') as Record<string, string>),
      ...(patch.extra ?? {}),
    };
    let secretEnc = r.secret_enc;
    if (patch.secret !== undefined) {
      secretEnc = patch.secret ? encryptSecret(patch.secret.trim(), this.appSecret) : null;
    }
    this.db
      .prepare(
        'UPDATE ai_providers SET enabled = ?, priority = ?, model = ?, secret_enc = ?, extra_json = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      )
      .run(
        (patch.enabled ?? r.enabled === 1) ? 1 : 0,
        patch.priority ?? r.priority,
        patch.model?.trim() || r.model,
        secretEnc,
        JSON.stringify(extra),
        this.now().toISOString(),
        by,
        id,
      );
    return this.list().find((p) => p.id === id);
  }

  private record(
    res: {
      provider: ProviderId;
      model: string;
      ok: boolean;
      ms: number;
      error?: string;
      usage?: CompletionResult['usage'];
    },
    req: CompletionRequest,
    out: string,
    purpose: string,
    user: string | null,
  ): void {
    this.db
      .prepare(
        'INSERT INTO ai_usage (at, provider, model, purpose, user_email, ok, input_chars, output_chars, ms, error, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        this.now().toISOString(),
        res.provider,
        res.model,
        purpose,
        user,
        res.ok ? 1 : 0,
        req.system.length + req.user.length,
        out.length,
        res.ms,
        res.error ? redactSecrets(res.error).slice(0, 300) : null,
        res.usage?.inputTokens ?? null,
        res.usage?.outputTokens ?? null,
      );
  }

  /**
   * One provider with retries: 429/5xx/network errors are retried up to `maxRetries` times with
   * exponential backoff (Retry-After honoured up to `maxRetryAfterMs`). Our own timeouts and
   * other 4xx are not retried — the caller falls back to the next provider instead.
   */
  private async completeWithRetry(
    cfg: ProviderConfig,
    req: CompletionRequest,
  ): Promise<CompletionResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await PROVIDERS[cfg.id].complete(cfg, req, this.fetchFn);
      } catch (err) {
        const retryable = err instanceof ProviderError && err.retryable && !err.timedOut;
        if (!retryable || attempt >= this.retry.maxRetries) throw err;
        const delay =
          err.retryAfterMs !== undefined
            ? Math.min(err.retryAfterMs, this.retry.maxRetryAfterMs)
            : this.retry.baseDelayMs * 2 ** attempt;
        await this.retry.sleep(delay);
      }
    }
  }

  /** Run one provider directly (used by the admin "Test connection" button). */
  async test(id: ProviderId, by: string): Promise<{ ok: boolean; message: string; ms: number }> {
    const r = this.row(id);
    if (!r) return { ok: false, message: 'unknown provider', ms: 0 };
    const cfg = this.configOf(r);
    const t0 = Date.now();
    let ok = false;
    let message = '';
    if (!cfg.secret) {
      message = 'Ключ не задан';
    } else {
      try {
        const res = await PROVIDERS[id].test(cfg, this.fetchFn);
        ok = true;
        message = `OK · ${res.model} · «${res.text.slice(0, 40)}»`;
      } catch (err) {
        message = redactSecrets((err as Error).message, [cfg.secret]).slice(0, 300);
      }
    }
    const ms = Date.now() - t0;
    this.db
      .prepare(
        'UPDATE ai_providers SET last_test_at = ?, last_test_ok = ?, last_test_message = ? WHERE id = ?',
      )
      .run(this.now().toISOString(), ok ? 1 : 0, message, id);
    this.record(
      { provider: id, model: cfg.model, ok, ms, error: ok ? undefined : message },
      { system: '', user: '' },
      '',
      'test',
      by,
    );
    return { ok, message, ms };
  }

  /**
   * Complete through the chain. `choice = 'auto'` tries every available provider in priority order
   * and falls back on any error; an explicit provider is tried alone.
   */
  async complete(
    req: CompletionRequest,
    opts: { choice?: ProviderChoice; purpose: string; user?: string | null } = { purpose: 'other' },
  ): Promise<CompletionResult> {
    const choice = opts.choice ?? 'auto';
    const candidates = this.rows().filter(
      (r) => this.usable(r) && (choice === 'auto' || r.id === choice),
    );
    if (candidates.length === 0) {
      throw new ProviderError(
        choice === 'auto' ? 'anthropic' : choice,
        503,
        'Нет настроенных AI-провайдеров — администратор включает их в «Администрирование → AI-провайдеры»',
      );
    }
    const errors: string[] = [];
    const secrets: string[] = [];
    for (const r of candidates) {
      const cfg = this.configOf(r);
      secrets.push(cfg.secret);
      const t0 = Date.now();
      try {
        const res = await this.completeWithRetry(cfg, req);
        this.record(
          { provider: r.id, model: res.model, ok: true, ms: Date.now() - t0, usage: res.usage },
          req,
          res.text,
          opts.purpose,
          opts.user ?? null,
        );
        return res;
      } catch (err) {
        const msg = redactSecrets((err as Error).message, secrets);
        errors.push(msg);
        this.record(
          { provider: r.id, model: cfg.model, ok: false, ms: Date.now() - t0, error: msg },
          req,
          '',
          opts.purpose,
          opts.user ?? null,
        );
      }
    }
    throw new ProviderError(
      candidates[candidates.length - 1]!.id,
      502,
      redactSecrets(`Все провайдеры вернули ошибку: ${errors.join(' | ')}`, secrets),
    );
  }

  usage(days = 30): Array<{
    provider: string;
    calls: number;
    failures: number;
    outputChars: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    const since = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    return this.db
      .prepare(
        `SELECT provider, COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
         SUM(output_chars) AS outputChars, COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM ai_usage WHERE at >= ? GROUP BY provider ORDER BY calls DESC`,
      )
      .all(since) as Array<{
      provider: string;
      calls: number;
      failures: number;
      outputChars: number;
      inputTokens: number;
      outputTokens: number;
    }>;
  }
}

/**
 * Adapter: an Anthropic-Messages-compatible `fetch` backed by the provider chain. Lets the existing,
 * well-tested report modules (ai-insights / ai-hypotheses / ai-decisions) run on any provider
 * without changing their request/response contract.
 */
export function chainAsAnthropicFetch(
  llm: LlmService,
  opts: {
    choice?: ProviderChoice;
    purpose: string;
    user?: string | null;
    /** Per-request provider timeout; defaults to PURPOSE_TIMEOUT_MS[purpose] or the adapter's. */
    timeoutMs?: number;
    onResult?: (r: CompletionResult) => void;
  },
) {
  const timeoutMs = opts.timeoutMs ?? PURPOSE_TIMEOUT_MS[opts.purpose];
  return async (
    _url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> => {
    const body = JSON.parse(init.body) as {
      system?: string;
      max_tokens?: number;
      messages: Array<{ content: string }>;
    };
    try {
      const res = await llm.complete(
        {
          system: body.system ?? '',
          user: body.messages.map((m) => m.content).join('\n\n'),
          maxTokens: body.max_tokens,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        },
        opts,
      );
      opts.onResult?.(res);
      const payload = JSON.stringify({
        content: [{ type: 'text', text: res.text }],
        model: res.model,
        // ANA-33: report AI blocks attribute themselves («Сгенерировано: …») via this field.
        provider: res.provider,
        stop_reason: res.stopReason ?? 'end_turn',
        ...(res.usage
          ? {
              usage: {
                ...(res.usage.inputTokens !== undefined
                  ? { input_tokens: res.usage.inputTokens }
                  : {}),
                ...(res.usage.outputTokens !== undefined
                  ? { output_tokens: res.usage.outputTokens }
                  : {}),
              },
            }
          : {}),
      });
      return { ok: true, status: 200, text: async () => payload };
    } catch (err) {
      const status = err instanceof ProviderError ? err.status || 502 : 502;
      const msg = redactSecrets((err as Error).message);
      return { ok: false, status, text: async () => msg };
    }
  };
}
