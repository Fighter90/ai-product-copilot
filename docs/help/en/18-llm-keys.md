---
title: LLM provider keys
section: Admin
order: 18
summary: Where to get and how to enter YandexGPT, GigaChat, Anthropic and OpenRouter keys; how priority, testing, encryption and usage stats work.
---

# LLM provider keys

AI is used for three things: the report's AI analysis, AI hypotheses with the Decision Log, and the help assistant. Everything else (dashboards, goals, funnel, DOCX/PDF) works without AI. Keys are entered only by an **administrator** on “Administration → AI providers” (`/app/admin/ai`).

![Screenshot: AI providers](/screenshots/18-admin-ai.png)
_Four provider cards and the “Usage, last 30 days” block._

## Provider card: fields and buttons

| Element            | What it does                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `on` / `off` pill  | whether the provider is in the chain                                                                                        |
| `••••abcd` pill    | mask of the stored key (last 4 characters); the full key is never shown                                                     |
| “Enabled” checkbox | turns the provider on/off; saved immediately, no “Save” needed                                                              |
| “Key · …”          | the provider secret (the label depends on the provider). An empty field on save = “keep the current key”                    |
| “Model”            | a field with suggestions; you may type any other model the provider supports                                                |
| “Priority”         | a number 0–1000. **Lower goes first.** Defaults: OpenRouter 10, Anthropic 20, YandexGPT 30, GigaChat 40                     |
| Extra fields       | YandexGPT — “ID каталога (folder ID)”; GigaChat — “Scope (GIGACHAT_API_PERS / _B2B / _CORP)”                                |
| “Save”             | saves key, model, priority and extra fields                                                                                 |
| “Test connection”  | a test prompt (“say: ok”, 30 s timeout). Active only once a key is saved. Result: “OK · model · «answer»” or the error text |
| “docs” link        | provider documentation                                                                                                      |

Always in this order: **paste the key → fill extra fields → “Save” → “Test connection” → tick “Enabled”**.

## How the chain works (priority and fallback)

- Only providers that are “Enabled” **and** have a stored key take part.
- The request goes to the provider with the lowest priority. On a transient error (HTTP 429, 5xx, network failure) it is first retried up to 2 times with the same provider with growing pauses (Retry-After is honoured, capped at 10 s). If the provider still fails or returns a permanent error (bad key, timeout, empty answer), the request automatically goes to the next one.
- Error texts shown in the UI, the audit log and the stats are scrubbed of anything that looks like a key or token.
- If all fail, the user sees “all providers returned an error” with a reason per provider.
- If none is enabled, the message says there are no configured AI providers and an administrator should enable one. The help assistant then answers in search mode (showing matching article fragments).

## YandexGPT (Yandex Cloud / AI Studio)

You need: a service-account **API key** and the **folder ID**.

1. Open the Yandex Cloud console (console.yandex.cloud) or AI Studio (aistudio.yandex.ru) and select the folder where the model will run. Copy its ID — a string like `b1g…`.
2. In that folder create a **service account** and grant it the `ai.languageModels.user` role on the folder.
3. Create an **API key** for the service account. If the console asks for a key scope, choose language-model access (`yc.ai.languageModels.execute`). The secret part is shown once — copy it immediately.
4. In the “YandexGPT (AI Studio)” card: “Key · API-ключ (секретная часть)” — the key secret; “ID каталога (folder ID)” — the ID from step 1; model — `yandexgpt/latest` (or `yandexgpt-lite/latest`, `yandexgpt/rc`).
5. “Save” → “Test connection” → “Enabled”.

Technically the product calls `llm.api.cloud.yandex.net` with an `Api-Key` header and builds the model address as `gpt://<folder ID>/<model>`. If you type a full URI starting with `gpt://` into “Model”, it is used as is.

Typical errors: “yandexgpt: folderId is not set” — the folder ID is empty; HTTP 401 — wrong or revoked key; HTTP 403 — the service account lacks `ai.languageModels.user` or the key belongs to another folder.

## GigaChat (Sber)

You need: an **Authorization Key** and a **scope**.

1. Sign in at developers.sber.ru and create a GigaChat API project.
2. In the project settings get the **Authorization Key** (a base64 string). It is shown once — store it.
3. Pick the **scope** by access type: `GIGACHAT_API_PERS` — individuals; `GIGACHAT_API_B2B` — companies and sole traders on prepaid packages; `GIGACHAT_API_CORP` — companies on pay-as-you-go. Empty = `GIGACHAT_API_PERS`.
4. In the “GigaChat” card: “Key · Authorization Key” — the key from step 2; “Scope” — from step 3; model — `GigaChat-2`, `GigaChat-2-Pro` or `GigaChat-2-Max`.
5. “Save” → “Test connection” → “Enabled”.

How it works: the product exchanges the Authorization Key for a temporary access token (`ngw.devices.sberbank.ru:9443`), caches it until expiry and sends requests to `gigachat.devices.sberbank.ru`.

**Russian Trusted Root CA.** GigaChat servers use certificates issued by the Russian national CA (Ministry of Digital Development). If the “Russian Trusted Root CA” root certificate is not installed on the server, the test fails with a network error like “gigachat: fetch failed” (a certificate-chain error underneath). The product has no dedicated setting for this: the server administrator downloads the certificate from Gosuslugi (the Ministry's certificates page) and adds it to the Node.js process, e.g. via `NODE_EXTRA_CA_CERTS=/path/to/russian_trusted_root_ca.pem` for the `pca-api` service, then restarts the service.

Other errors: HTTP 401 while obtaining the token — wrong Authorization Key or the scope does not match your access type; HTTP 429 — rate limit; a “tokens exhausted” error — top up the package at developers.sber.ru.

## Anthropic (Claude)

1. Sign in at console.anthropic.com → Settings → API Keys → **Create Key**. The key starts with `sk-ant-` and is shown once.
2. Make sure the account has credit (Plans & Billing) — otherwise the API returns an error.
3. In the “Anthropic” card: “Key · API key” — the key; model — from the suggestions (e.g. `claude-sonnet-5-5`) or any current model from the docs.
4. “Save” → “Test connection” → “Enabled”.

The server needs network access to `api.anthropic.com`. HTTP 401 — wrong key; 400 mentioning credit balance — top up; 404 on the model — check the model name.

## OpenRouter

1. Sign up at openrouter.ai, buy credits and open openrouter.ai/keys → **Create Key**. The key starts with `sk-or-`.
2. In the “OpenRouter” card: “Key · API key” — the key; model — `vendor/model`, e.g. `anthropic/claude-sonnet-4.5`, `openai/gpt-4.1`, `google/gemini-2.5-pro`, `deepseek/deepseek-chat`. Any id from the openrouter.ai/models catalogue works.
3. “Save” → “Test connection” → “Enabled”.

OpenRouter is handy as “one key for many models” and makes a good first or backup provider. HTTP 401 — wrong key; 402 — out of credits; 404 — no such model.

## Key security

- Keys are encrypted with **AES-256-GCM**; the encryption key is derived from the server master secret `APP_SECRET`. Only ciphertext is stored.
- The API and UI return only a mask `••••` + the last 4 characters. A saved key can be replaced but never viewed.
- The audit log records `ai.provider_update` (what changed; the key is replaced by a “changed” marker) and `ai.provider_test` (success/failure). The key itself never reaches the log.
- If `APP_SECRET` changes on the server, stored keys can no longer be decrypted — the provider becomes “keyless”. Re-enter the keys.
- Keys can also be set in `.env` (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `YANDEX_AI_API_KEY` + `YANDEX_AI_FOLDER_ID`, `GIGACHAT_AUTH_KEY` + `GIGACHAT_SCOPE`) — they are seeded **once** on first start; afterwards this page is the source of truth.

## Usage statistics

“Usage, last 30 days” shows calls and failures per provider (tests included). The database (`ai_usage`) stores only call metadata: provider, model, purpose (report insights, hypotheses, decisions, help assistant, test), user, duration, request/response sizes in characters, token counts (when the provider reports them), error text. Question and answer contents are not stored.

## Typical scenarios

- **First connection.** Pick one provider, follow its section, get “OK” in the test, enable it. Then build a snapshot on the Report page — background AI hypotheses confirm the chain works.
- **Primary + backup.** E.g. YandexGPT priority 10 and GigaChat priority 20 (both Russian clouds), OpenRouter 30 as the last resort. A failure of the first switches to the second automatically.
- **Rotating a key.** Paste the new key, click “Save”, then “Test connection”. Revoke the old key at the provider.
- **Temporarily disabling a provider.** Untick “Enabled” — the key stays, the provider just leaves the chain.

## Common problems

| Symptom                                    | What to check                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| “Test connection” is disabled              | the key is not saved yet — click “Save”                                                   |
| “Key not set” (RU «Ключ не задан»)         | the key is not saved, or cannot be decrypted after an `APP_SECRET` change                 |
| “timeout after 30000 ms”                   | the provider is unreachable from the server (network, blocking) — check access to its API |
| “… fetch failed” for GigaChat              | Russian Trusted Root CA is not installed (see the GigaChat section)                       |
| Test says “OK” but report AI does not work | “Enabled” is not ticked                                                                   |
| “All providers returned an error”          | read the per-provider reasons in the error text and the failure counter under “Usage”     |
