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

export interface CompletionResult {
  readonly text: string;
  readonly provider: ProviderId;
  readonly model: string;
}

/** Minimal fetch shape — injectable for unit tests. */
export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

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
  constructor(
    public readonly provider: ProviderId,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
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
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-4-6'],
    docs: 'https://docs.claude.com',
  },
  yandexgpt: {
    name: 'YandexGPT (AI Studio)',
    secretLabel: 'API-ключ (секретная часть)',
    extras: [{ key: 'folderId', label: 'ID каталога (folder ID)' }],
    models: ['yandexgpt/latest', 'yandexgpt-lite/latest', 'yandexgpt/rc'],
    docs: 'https://aistudio.yandex.ru',
  },
  gigachat: {
    name: 'GigaChat',
    secretLabel: 'Authorization Key',
    extras: [{ key: 'scope', label: 'Scope (GIGACHAT_API_PERS / _B2B / _CORP)' }],
    models: ['GigaChat-2', 'GigaChat-2-Pro', 'GigaChat-2-Max'],
    docs: 'https://developers.sber.ru/docs/ru/gigachat/api/overview',
  },
};

const DEFAULT_TIMEOUT = 120_000;

async function call(
  fetchFn: HttpFetch,
  provider: ProviderId,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ctrl.signal });
    const raw = await res.text();
    if (!res.ok) {
      throw new ProviderError(
        provider,
        res.status,
        `${provider} HTTP ${res.status}: ${raw.slice(0, 300)}`,
      );
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new ProviderError(provider, 502, `${provider}: invalid JSON response`);
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const msg =
      (err as Error).name === 'AbortError'
        ? `timeout after ${timeoutMs} ms`
        : (err as Error).message;
    throw new ProviderError(provider, 0, `${provider}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

const pick = (obj: unknown, path: Array<string | number>): unknown =>
  path.reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string | number, unknown>)[k]),
    obj,
  );

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
  return { text: requireText('anthropic', text), provider: 'anthropic', model: cfg.model };
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
  };
}

export const COMPLETERS: Record<
  ProviderId,
  (cfg: ProviderConfig, req: CompletionRequest, fetchFn: HttpFetch) => Promise<CompletionResult>
> = {
  openrouter: completeOpenRouter,
  anthropic: completeAnthropic,
  yandexgpt: completeYandexGpt,
  gigachat: (cfg, req, f) => completeGigaChat(cfg, req, f),
};
