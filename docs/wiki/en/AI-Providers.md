# AI providers

> Source: `docs/help/en/18-llm-keys.md`, spec
> [openspec/specs/llm](https://github.com/Fighter90/ai-product-copilot/blob/main/openspec/specs/llm/spec.md).
> Русская версия: [AI-провайдеры](../AI-Providers).

Four providers are supported: **OpenRouter, Anthropic (Claude), YandexGPT, GigaChat**.
Managed under "Administration → AI providers" (administrator only).

## Provider card

- **Enabled** — participates in the chain or not;
- **Priority** — fallback order (lower = earlier);
- **Model** — provider model id;
- **API key** — stored encrypted (AES-256-GCM, master key `APP_SECRET`), only a masked
  value is ever displayed;
- **Test** — server-side check request that never reveals the key.

## Chain and fallback

Requests (report AI analysis, RAG assistant) walk the chain by priority: a provider
failure or timeout switches to the next available one. Answers are labeled with the
actual provider and model. Every call is logged to `ai_usage` (token sizes, no content) —
a 30-day usage view is available in the admin area.

## Without providers

The product works without AI: reports ship without narrative and AI hypotheses, and the
assistant answers in search-only mode, listing the found help fragments.

## Provider notes

- **YandexGPT** — requires a Yandex Cloud (AI Studio) catalog/key;
- **GigaChat** — the server may need the Ministry of Digital certificates
  (see `docs/deploy.md`, section 8a);
- **OpenRouter** — one key for many models, convenient as a fallback.
