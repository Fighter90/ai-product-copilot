---
title: DataLens
section: Integrations
order: 10
summary: CSV dataset export for Yandex DataLens and the webhook receiver.
---

# DataLens

## Data export

The "DataLens" page in the cabinet serves ready datasets (CSV, UTF-8 with BOM): channels by day, UTM, geo/devices, pages, goals by day, B2B deals.

Connecting in Yandex DataLens:

1. Open datalens.ru → "Connections" → "Files".
2. Download the datasets you need from the "DataLens" page (CSV).
3. Upload the files to the connection and build charts/dashboards.

Export endpoint: `GET /api/integrations/datalens/export/{datasetId}?from=YYYY-MM-DD&to=YYYY-MM-DD` (sign-in required).

## Analyst request

The "Request update" button notifies administrators that data needs refreshing (`POST /api/integrations/datalens/request`).

## Webhooks

DataLens can send notifications (chart alerts) to `POST /api/integrations/datalens/webhook/{token}`. The token is generated in "Admin → Integrations". Notifications appear in the cabinet (bell) and in the log.
