# DataLens

> Source: `docs/help/en/10-datalens.md`, spec
> [openspec/specs/datalens](https://github.com/Fighter90/ai-product-copilot/blob/main/openspec/specs/datalens/spec.md).
> Русская версия: [DataLens](../DataLens.md).

The product prepares **flat CSV datasets** for Yandex DataLens: channels, UTM, geo+devices,
pages, B2B deals. Dashboards and alerts are built on the DataLens side.

## Connecting (CSV, "Files")

1. Cabinet → **DataLens**: copy the export link of a dataset (with a personal token) and
   download the CSV (UTF-8 with BOM — Cyrillic reads correctly).
2. DataLens → **"Files"** connection → upload the CSV (or point to the URL if your
   workspace supports it).
3. Re-export after each sync from the cabinet.

## Provisioning via the Public API (admin)

The admin **Integrations** page: IAM token + org id → workbook check (`rpc/getWorkbook`)
and automatic dataset/chart provisioning via the Public API. The token is stored
encrypted and never appears in logs or error messages.

## Webhook and alerts

- DataLens sends the connection confirmation code and alerts to the webhook receiver
  `POST /api/integrations/datalens/webhook/:token` (the tokenized link is visible to the
  admin).
- Events are stored in `datalens_events` and create **notifications** in the cabinet.

## "Request refresh"

An analyst can request a dataset refresh explicitly — administrators receive a
notification.

Step-by-step with charts — [docs/help/en/10-datalens.md](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/help/en/10-datalens.md).
