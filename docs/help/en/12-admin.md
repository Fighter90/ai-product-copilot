---
title: Administration
section: Admin
order: 12
summary: Users, AI providers, Yandex Metrika, integrations, audit log.
---

# Administration

The "Admin" section is available to the Administrator role only.

## Users

Create and edit accounts: e-mail, name, role (administrator/analyst), active flag. Deactivation blocks sign-in without deleting the action history.

## AI providers

Supported: OpenRouter, Anthropic, YandexGPT and GigaChat. Each has an API key, a model and extra parameters (folderId for YandexGPT, scope for GigaChat).

- Keys are encrypted with AES-256-GCM using the `APP_SECRET` master key and are masked in API responses.
- "Test" performs a live check against the provider.
- Usage is recorded in the usage log (`GET /api/admin/ai/usage`).

## Yandex Metrika

Counter check, sync run (goals, channels, UTM, geo, pages, exit pages), data cleanup. Syncs also run on a schedule on the server.

## Integrations

DataLens webhook token, integration status.

## Audit

User action log: sign-ins, settings changes, goal creation, exports. Records are immutable.
