import { PROVIDER_META, ProviderError, type HttpFetch, type ProviderId } from './providers';

/** One catalog entry for the admin model combobox (ANA-151). */
export interface ModelInfo {
  readonly id: string;
  /** Human-readable name as published by the provider (absent in the static sets). */
  readonly name?: string;
  readonly contextLength?: number;
  /** Price per 1M tokens, USD (OpenRouter reports per-token prices → ×1 000 000). */
  readonly promptPricePerM?: number;
  readonly completionPricePerM?: number;
}

/** Public OpenRouter catalog — no API key required. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** TTL of the in-memory OpenRouter catalog cache: 1 hour. */
export const CATALOG_TTL_MS = 3_600_000;

/** Per-token price (string or number, as OpenRouter ships it) → per-1M number, or nothing. */
function priceOf(
  value: unknown,
  key: 'promptPricePerM' | 'completionPricePerM',
): Partial<ModelInfo> {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return {};
  return { [key]: n * 1_000_000 } as Partial<ModelInfo>;
}

/**
 * Parse the public OpenRouter catalog (`{ data: [...] }` with id, name, context_length and
 * per-token pricing). Entries without a usable id are skipped; metadata is optional.
 */
export function parseOpenRouterModels(json: unknown): ModelInfo[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new ProviderError('openrouter', 502, 'openrouter models: unexpected payload shape');
  }
  const out: ModelInfo[] = [];
  for (const entry of data) {
    const e = entry as {
      id?: unknown;
      name?: unknown;
      context_length?: unknown;
      pricing?: { prompt?: unknown; completion?: unknown };
    } | null;
    if (typeof e?.id !== 'string' || !e.id.trim()) continue;
    out.push({
      id: e.id,
      ...(typeof e.name === 'string' && e.name ? { name: e.name } : {}),
      ...(typeof e.context_length === 'number' && Number.isFinite(e.context_length)
        ? { contextLength: e.context_length }
        : {}),
      ...priceOf(e.pricing?.prompt, 'promptPricePerM'),
      ...priceOf(e.pricing?.completion, 'completionPricePerM'),
    });
  }
  return out;
}

/** Static set for providers without a public catalog endpoint (ANA-151: extended to the full set). */
export function staticCatalog(id: ProviderId): ModelInfo[] {
  return PROVIDER_META[id].models.map((m) => ({ id: m }));
}

/**
 * ANA-151: model catalog for the admin combobox. OpenRouter is fetched live from its public
 * endpoint (no key, hundreds of models) with a 1-hour in-memory cache; every other provider
 * serves the extended static set without any HTTP call. The endpoint never touches secrets.
 */
export class ModelCatalog {
  private cache: { at: number; models: ModelInfo[] } | null = null;

  constructor(
    private readonly fetchFn: HttpFetch,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = CATALOG_TTL_MS,
  ) {}

  async get(id: ProviderId): Promise<{ source: 'live' | 'static'; models: ModelInfo[] }> {
    if (id !== 'openrouter') return { source: 'static', models: staticCatalog(id) };
    const cached = this.cache;
    if (cached && cached.at + this.ttlMs > this.now()) {
      return { source: 'live', models: cached.models };
    }
    const response = await this.fetchFn(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new ProviderError(
        'openrouter',
        response.status,
        `openrouter models: HTTP ${response.status}: ${raw.slice(0, 200)}`,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ProviderError('openrouter', 502, 'openrouter models: invalid JSON response');
    }
    const models = parseOpenRouterModels(json);
    this.cache = { at: this.now(), models };
    return { source: 'live', models };
  }
}
