---
title: Administration
section: Admin
order: 12
summary: Users, AI providers (all four, step by step), Yandex Metrika settings and sync, goal management, integrations, audit log.
---

# Administration

The "Admin" section is visible to the Administrator role only; the API enforces 403 for analysts. This is the full operating manual for its five subsections.

## Users

**Admin → Users** manages cabinet accounts.

![Admin users screenshot](/screenshots/17-admin-users.png)
_User management: role, active flag, editing._

1. **Create** — press Add, enter e-mail and name, pick the role (administrator / analyst). The person signs in with the password you agreed on.
2. **Change a role** — edit the account and switch the role; the change applies at the next sign-in or page load.
3. **Reset a password** — set a new password in the edit form and hand it over via a trusted channel; there is no e-mail flow.
4. **Deactivate** — switch the active flag off: sign-in is blocked, but the account and all its history (audit, reports) remain — never delete, deactivate.
5. **Review quarterly** — walk the list, deactivate leavers, and confirm every administrator really needs the role.

## AI providers

**Admin → AI providers** configures the engine behind the assistant and report AI analysis. Supported: **OpenRouter, Anthropic, YandexGPT, GigaChat**.

![Admin AI screenshot](/screenshots/18-admin-ai.png)
_AI provider configuration: key, model, extras, test._

General fields for every provider:

| Field   | Meaning                                                    |
| ------- | ---------------------------------------------------------- |
| API key | The provider secret; stored encrypted, masked in responses |
| Model   | Model identifier to request                                |
| Active  | Whether the cabinet uses this provider                     |

Provider-specific extras:

| Provider   | Extra fields                                     | Notes                                                             |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| OpenRouter | —                                                | One key, many models; the model field carries the full model name |
| Anthropic  | —                                                | Direct Claude API                                                 |
| YandexGPT  | `folderId` (folder ID)                           | Without a folder id the request fails with an explicit error      |
| GigaChat   | `scope` (`GIGACHAT_API_PERS` / `_B2B` / `_CORP`) | The scope must match the key type                                 |

Step-by-step setup:

1. Obtain the API key in the provider's console.
2. In **Admin → AI providers**, pick the provider, paste the key, set the model, fill the extra fields if the table above requires them.
3. Press **Test** — it performs a live minimal request to the provider. Success means the key, model and extras work together.
4. Make the provider active; the assistant and the report AI analysis switch to it immediately.
5. Check **Admin → Audit** and the usage log (`GET /api/admin/ai/usage`) after the first real usage.

What errors mean:

- **401 / unauthorized on Test** — the key is wrong, revoked, or has no quota.
- **YandexGPT "folderId is not set"** — the folder id extra is empty; fill it.
- **GigaChat scope errors** — the key type and scope mismatch (for example a personal key with `_CORP` scope).
- **Model not found** — the model identifier is misspelled or not available to your account; copy it from the provider's model list.

Security: keys are encrypted with AES-256-GCM using the server's master secret and are never returned in full by the API — the UI shows a mask. Details on the storage layer are in [How the product works](#).

## Yandex Metrika

**Admin → Yandex Metrika** is the counter control room (counter 54280963).

![Admin Metrika screenshot](/screenshots/19-admin-metrika.png)
_Metrika settings: counter, sync controls, goal management._

1. **Counter status** — verifies the connected counter and shows the goal catalog fetch state.
2. **Manual sync** — pulls goals, channels, UTM, geo, devices, pages and exit pages into the local SQLite database. Use it after site changes, after creating goals, or to close a data gap spotted in History.
3. **Scheduled sync** — systemd runs a sync **every 3 hours** on the server; the admin page shows when it last succeeded.
4. **`GOAL_ID` pinning** — fixes the primary KPI goal instead of auto-detecting the purchase goal; needed when several purchase-like goals exist.
5. **Data cleanup** — removes collected daily rows (with confirmation); the next sync re-fills them.

### Creating and archiving goals from the admin UI

The admin page talks to the Metrika **Management API**, so routine goal maintenance needs no trip to Metrika's own interface:

1. **Create a goal** — press the create control, choose the goal type (URL / action / depth / event), fill the conditions, save. The goal appears in Metrika immediately and in the cabinet after the next sync.
2. **Archive a goal** — pick the dead or duplicate goal (statuses and duplicate groups are shown on the **Goals** page) and archive it. Archived goals stop counting toward KPI; the **Archived goals** header toggle controls their visibility.
3. Verify on **Goals**: the new goal should appear within one sync cycle, with status Live once it starts firing.

## Integrations

**Admin → Integrations** holds the DataLens webhook token and the integration status.

![Admin integrations screenshot](/screenshots/20-admin-integrations.png)
_Integrations: webhook token generation and status._

1. **Generate / regenerate the token** — the token authenticates DataLens webhook calls.
2. **Copy it into DataLens** — paste it into alert URLs as `POST /api/integrations/datalens/webhook/{token}`.
3. **Watch the log** — incoming webhook calls and update requests (`Request update` from the DataLens page) are recorded here with timestamps; a stream of rejected calls means the token in DataLens does not match.

Regenerating the token invalidates the old one — update the DataLens alert URLs in the same session.

## Audit

**Admin → Audit** is the immutable user action log: sign-ins, settings changes, goal creation and archiving, exports, deal edits. Records cannot be edited or deleted from the interface. Use it to answer "who changed what and when" — it is the accountability layer that makes shared administrator access safe.

## Use cases

- **Set up AI for the assistant** — create an OpenRouter key, add it with a model, press Test, activate; the assistant starts composing answers on the next question.
- **Create a new goal** — define it in the admin UI, wait one sync, find it on **Goals**, pin it with `GOAL_ID` if it should drive KPI.
- **Offboard a teammate** — deactivate the account in **Users**; audit history is preserved for the log.
- **Rotate the DataLens token** — regenerate in **Integrations**, update the alert URLs in DataLens, confirm the next alert lands in the cabinet bell.

## Troubleshooting

- **"Test" fails for one provider but others work** — provider-specific: key validity, model name, or the extras table above; the error text mirrors the provider's response.
- **The sync ran but numbers did not change** — the sync writes daily rows; check the target date in **History**, and remember today's row only appears as the day closes.
- **An analyst reports 403** — that is the role working as intended; grant the role deliberately, not ad hoc.
