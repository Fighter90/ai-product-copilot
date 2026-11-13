import { randomUUID } from 'node:crypto';

/** Identifiers of supported LLM providers. */
export const PROVIDER_IDS = ['openrouter', 'anthropic', 'yandexgpt', 'gigachat'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface CompletionRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}

export interface CompletionUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** Anthropic-style stop reason; other providers' finish reasons are mapped onto it. */
export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal';

export interface CompletionResult {
  readonly text: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly stopReason?: StopReason;
  readonly usage?: CompletionUsage;
}

/** Minimal fetch shape — injectable for unit tests. */
export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers?: { get: (name: string) => string | null };
}>;

/** Runtime config of one provider (secrets already decrypted). */
export interface ProviderConfig {
  readonly id: ProviderId;
  readonly model: string;
  /** OpenRouter/Anthropic API key, YandexGPT API key, GigaChat Authorization Key. */
  readonly secret: string;
  /** Provider-specific extras: YandexGPT folderId, GigaChat scope. */
  readonly extra: Record<string, string>;
}

export class ProviderError extends Error {
  /** Delay requested by the provider (Retry-After), ms. */
  public readonly retryAfterMs?: number;
  /** The request was aborted by our own timeout (status 0). */
  public readonly timedOut: boolean;
  constructor(
    public readonly provider: ProviderId,
    public readonly status: number,
    message: string,
    opts: { retryAfterMs?: number; timedOut?: boolean } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.retryAfterMs = opts.retryAfterMs;
    this.timedOut = opts.timedOut ?? false;
  }
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** Human-readable metadata for the admin UI. */
export const PROVIDER_META: Record<
  ProviderId,
  {
    name: string;
    secretLabel: string;
    extras: Array<{ key: string; label: string }>;
    models: string[];
    docs: string;
  }
> = {
  openrouter: {
    name: 'OpenRouter',
    secretLabel: 'API key',
    extras: [],
    models: [
      'anthropic/claude-sonnet-4.5',
      'anthropic/claude-opus-4.1',
      'openai/gpt-4.1',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-chat',
    ],
    docs: 'https://openrouter.ai/docs',
  },
  anthropic: {
    name: 'Anthropic',
    secretLabel: 'API key',
    extras: [],
    // ANA-151: полный набор актуальных алиасов без дат (иначе дашборд предлагает устаревшие
    // модели). ID сверены с docs.claude.com/models/overview 2026-11-14. Статический снимок
    // дрейфует: полный живой каталог есть только у OpenRouter; свободный ввод покрывает новые ID.
    models: [
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-5-5',
      'claude-sonnet-4-6',
      'claude-fable-5-1',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-haiku-4-5',
    ],
    docs: 'https://docs.claude.com',
  },
  yandexgpt: {
    name: 'YandexGPT (AI Studio)',
    secretLabel: 'API-ключ (секретная часть)',
    extras: [{ key: 'folderId', label: 'ID каталога (folder ID)' }],
    // ANA-151: каталог AI Studio, ID сверены с aistudio.yandex.ru/docs 2026-11-14 (Pro 5.1 /
    // Alice AI / открытые модели). `yandexgpt-5-lite` исключён — официально отключается
    // 2026-11-15 (замена по докам: deepseek-v4.1-flash / qwen3.6-35b-a3b). Снимок дрейфует:
    // живой полный каталог — только OpenRouter; свободный ввод сохранён для новых ID.
    models: [
      'yandexgpt/latest',
      'yandexgpt-lite/latest',
      'yandexgpt/rc',
      'yandexgpt-5.1',
      'yandexgpt-5-pro',
      'aliceai-llm',
      'aliceai-llm-flash',
      'deepseek-v4.1-flash',
      'qwen3.6-35b-a3b',
    ],
    docs: 'https://aistudio.yandex.ru',
  },
  gigachat: {
    name: 'GigaChat',
    secretLabel: 'Authorization Key',
    extras: [{ key: 'scope', label: 'Scope (GIGACHAT_API_PERS / _B2B / _CORP)' }],
    models: ['GigaChat-2', 'GigaChat-2-Pro', 'GigaChat-2-Max', 'GigaChat-2-Lite'],
    docs: 'https://developers.sber.ru/docs/ru/gigachat/api/overview',
  },
};

export const DEFAULT_TIMEOUT = 120_000;

const REDACTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(Bearer|Basic|Api-Key|OAuth)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***'],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, '***'],
  [/\bAQVN[A-Za-z0-9_-]+/g, '***'],
  [/\by0_[A-Za-z0-9_-]+/g, '***'],
  [/\bt1\.[A-Za-z0-9._-]{10,}/g, '***'],
  // Long base64/hex-like runs that contain a digit (keeps long plain words readable).
  [/(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{25,}={0,2}/g, '***'],
];

/**
 * Strip anything that looks like a credential from text bound for logs, `ai_usage.error` or an
 * exception message: auth headers, known key prefixes, long base64-ish runs and the exact
 * `secrets` passed in.
 */
export function redactSecrets(
  text: string,
  secrets: ReadonlyArray<string | undefined> = [],
): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('***');
  }
  for (const [re, repl] of REDACTION_PATTERNS) out = out.replace(re, repl);
  return out;
}

/** Parse a Retry-After header (delta-seconds or HTTP date) into ms. */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const secs = Number(value.trim());
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function networkMessage(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const code = e.cause?.code;
  return code && !e.message.includes(code) ? `${e.message} (${code})` : e.message;
}

async function call(
  fetchFn: HttpFetch,
  provider: ProviderId,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headerSecrets = [init.headers.authorization, init.headers['x-api-key']].map((v) =>
    v?.replace(/^(Bearer|Basic|Api-Key|OAuth)\s+/i, ''),
  );
  try {
    const res = await fetchFn(url, { ...init, signal: ctrl.signal });
    const raw = await res.text();
    if (!res.ok) {
      throw new ProviderError(
        provider,
        res.status,
        redactSecrets(`${provider} HTTP ${res.status}: ${raw.slice(0, 300)}`, headerSecrets),
        { retryAfterMs: parseRetryAfter(res.headers?.get('retry-after')) },
      );
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new ProviderError(provider, 502, `${provider}: invalid JSON response`);
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const timedOut = (err as Error).name === 'AbortError' || ctrl.signal.aborted;
    const msg = timedOut ? `timeout after ${timeoutMs} ms` : networkMessage(err);
    throw new ProviderError(provider, 0, redactSecrets(`${provider}: ${msg}`, headerSecrets), {
      timedOut,
    });
  } finally {
    clearTimeout(timer);
  }
}

const pick = (obj: unknown, path: Array<string | number>): unknown =>
  path.reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string | number, unknown>)[k]),
    obj,
  );

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

function usageOf(input: unknown, output: unknown): CompletionUsage | undefined {
  const inputTokens = num(input);
  const outputTokens = num(output);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

/** OpenAI-style finish_reason (OpenRouter, GigaChat) → Anthropic stop_reason. */
const openAiStop = (finish: unknown): StopReason =>
  finish === 'length' ? 'max_tokens' : 'end_turn';

const ANTHROPIC_STOPS: ReadonlySet<string> = new Set([
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
  'refusal',
]);

function requireText(provider: ProviderId, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProviderError(provider, 502, `${provider}: empty completion`);
  }
  return value.trim();
}

// --- OpenRouter (OpenAI-compatible) -------------------------------------------------------------

export async function completeOpenRouter(
  cfg: ProviderConfig,
  req: CompletionRequest,
  fetchFn: HttpFetch,
): Promise<CompletionResult> {
  const json = await call(
    fetchFn,
    'openrouter',
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.secret}`,
        'content-type': 'application/json',
        'http-referer': 'https://dashboardcamp.ru',
        'x-title': 'ProductCamp Analytics Copilot',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: req.maxTokens ?? 4000,
        temperature: req.temperature ?? 0.3,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    },
    req.timeoutMs ?? DEFAULT_TIMEOUT,
  );
  return {
    text: requireText('openrouter', pick(json, ['choices', 0, 'message', 'content'])),
    provider: 'openrouter',
    model: String(pick(json, ['model']) ?? cfg.model),
    stopReason: openAiStop(pick(json, ['choices', 0, 'finish_reason'])),
    usage: usageOf(
      pick(json, ['usage', 'prompt_tokens']),
      pick(json, ['usage', 'completion_tokens']),
    ),
  };
}

// --- Anthropic Messages API -----------------------------------------------------------------------

export async function completeAnthropic(
  cfg: ProviderConfig,
  req: CompletionRequest,
  fetchFn: HttpFetch,
): Promise<CompletionResult> {
  const json = await call(
    fetchFn,
    'anthropic',
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': cfg.secret,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: req.maxTokens ?? 4000,
        // Newer Claude models reject `temperature`; only send it when explicitly requested.
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
    },
    req.timeoutMs ?? DEFAULT_TIMEOUT,
  );
  const blocks =
    (pick(json, ['content']) as Array<{ type: string; text?: string }> | undefined) ?? [];
  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
  const stop = pick(json, ['stop_reason']);
  return {
    text: requireText('anthropic', text),
    provider: 'anthropic',
    model: cfg.model,
    stopReason:
      typeof stop === 'string' && ANTHROPIC_STOPS.has(stop) ? (stop as StopReason) : 'end_turn',
    usage: usageOf(pick(json, ['usage', 'input_tokens']), pick(json, ['usage', 'output_tokens'])),
  };
}

// --- YandexGPT (Foundation Models completion) ------------------------------------------------------

export async function completeYandexGpt(
  cfg: ProviderConfig,
  req: CompletionRequest,
  fetchFn: HttpFetch,
): Promise<CompletionResult> {
  const folder = cfg.extra.folderId ?? '';
  if (!folder) throw new ProviderError('yandexgpt', 400, 'yandexgpt: folderId is not set');
  const modelUri = cfg.model.startsWith('gpt://') ? cfg.model : `gpt://${folder}/${cfg.model}`;
  const json = await call(
    fetchFn,
    'yandexgpt',
    'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
    {
      method: 'POST',
      headers: {
        authorization: `Api-Key ${cfg.secret}`,
        'x-folder-id': folder,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        modelUri,
        completionOptions: {
          stream: false,
          temperature: req.temperature ?? 0.3,
          maxTokens: String(Math.min(req.maxTokens ?? 4000, 7400)),
        },
        messages: [
          { role: 'system', text: req.system },
          { role: 'user', text: req.user },
        ],
      }),
    },
    req.timeoutMs ?? DEFAULT_TIMEOUT,
  );
  return {
    text: requireText('yandexgpt', pick(json, ['result', 'alternatives', 0, 'message', 'text'])),
    provider: 'yandexgpt',
    model: String(pick(json, ['result', 'modelVersion']) ? `${cfg.model}` : cfg.model),
    stopReason:
      pick(json, ['result', 'alternatives', 0, 'status']) === 'ALTERNATIVE_STATUS_TRUNCATED_FINAL'
        ? 'max_tokens'
        : 'end_turn',
    usage: usageOf(
      pick(json, ['result', 'usage', 'inputTextTokens']),
      pick(json, ['result', 'usage', 'completionTokens']),
    ),
  };
}

// --- GigaChat (OAuth token + chat completions) -----------------------------------------------------

interface GigaToken {
  token: string;
  expiresAt: number;
}
const gigaTokens = new Map<string, GigaToken>();

/** Exposed for tests. */
export function clearGigaChatTokenCache(): void {
  gigaTokens.clear();
}

async function gigaChatToken(
  cfg: ProviderConfig,
  fetchFn: HttpFetch,
  now: () => number,
): Promise<string> {
  const scope = cfg.extra.scope || 'GIGACHAT_API_PERS';
  const cacheKey = `${cfg.secret.slice(-12)}|${scope}`;
  const cached = gigaTokens.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
  const json = await call(
    fetchFn,
    'gigachat',
    'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${cfg.secret}`,
        rquid: randomUUID(),
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `scope=${encodeURIComponent(scope)}`,
    },
    30_000,
  );
  const token = pick(json, ['access_token']);
  const expiresAt = Number(pick(json, ['expires_at'])) || now() + 25 * 60_000;
  if (typeof token !== 'string' || !token) {
    throw new ProviderError('gigachat', 502, 'gigachat: no access_token in OAuth response');
  }
  gigaTokens.set(cacheKey, { token, expiresAt });
  return token;
}

export async function completeGigaChat(
  cfg: ProviderConfig,
  req: CompletionRequest,
  fetchFn: HttpFetch,
  now: () => number = Date.now,
): Promise<CompletionResult> {
  const token = await gigaChatToken(cfg, fetchFn, now);
  const json = await call(
    fetchFn,
    'gigachat',
    'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: req.maxTokens ?? 4000,
        temperature: req.temperature ?? 0.3,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    },
    req.timeoutMs ?? DEFAULT_TIMEOUT,
  );
  return {
    text: requireText('gigachat', pick(json, ['choices', 0, 'message', 'content'])),
    provider: 'gigachat',
    model: String(pick(json, ['model']) ?? cfg.model),
    stopReason: openAiStop(pick(json, ['choices', 0, 'finish_reason'])),
    usage: usageOf(
      pick(json, ['usage', 'prompt_tokens']),
      pick(json, ['usage', 'completion_tokens']),
    ),
  };
}

/** Formal provider contract: one completion call plus a cheap connectivity probe. */
export interface LlmProvider {
  readonly id: ProviderId;
  complete(
    cfg: ProviderConfig,
    req: CompletionRequest,
    fetchFn: HttpFetch,
  ): Promise<CompletionResult>;
  test(cfg: ProviderConfig, fetchFn: HttpFetch): Promise<CompletionResult>;
}

/** Request used by the admin "Test connection" button. */
export const TEST_REQUEST: CompletionRequest = {
  system: 'Ответь одним словом.',
  user: 'Скажи: ок',
  maxTokens: 20,
  timeoutMs: 30_000,
};

const provider = (id: ProviderId, complete: LlmProvider['complete']): LlmProvider => ({
  id,
  complete,
  test: (cfg, fetchFn) => complete(cfg, TEST_REQUEST, fetchFn),
});

export const PROVIDERS: Record<ProviderId, LlmProvider> = {
  openrouter: provider('openrouter', completeOpenRouter),
  anthropic: provider('anthropic', completeAnthropic),
  yandexgpt: provider('yandexgpt', completeYandexGpt),
  gigachat: provider('gigachat', (cfg, req, f) => completeGigaChat(cfg, req, f)),
};

/** Back-compat: plain completion functions keyed by provider id. */
export const COMPLETERS: Record<ProviderId, LlmProvider['complete']> = {
  openrouter: (cfg, req, f) => PROVIDERS.openrouter.complete(cfg, req, f),
  anthropic: (cfg, req, f) => PROVIDERS.anthropic.complete(cfg, req, f),
  yandexgpt: (cfg, req, f) => PROVIDERS.yandexgpt.complete(cfg, req, f),
  gigachat: (cfg, req, f) => PROVIDERS.gigachat.complete(cfg, req, f),
};
