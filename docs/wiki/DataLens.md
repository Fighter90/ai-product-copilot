# DataLens

> Как данные ProductCamp Analytics попадают в Яндекс DataLens. Детали —
> [docs/deploy.md](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/deploy.md),
> `scripts/push-datalens.mjs` и статья справки «DataLens».

## Два канала

1. **CSV-экспорт (основной).** `GET /api/integrations/datalens/export/:id` отдаёт плоские
   UTF-8 BOM CSV из БД. Пять датасетов: каналы · UTM · страницы · гео+устройства · B2B-сделки.
   В DataLens: воркбук → Подключения → **Файлы** → указать URL экспорта. Public API типа
   `file` не создаёт, поэтому подключение делается вручную в UI.
2. **Public API (скрипт).** `scripts/push-datalens.mjs` создаёт воркбук «ProductCamp Analytics»
   и подключение `metrika_api` (счётчик + OAuth) через `api.datalens.tech/rpc`. Нужны IAM-токен
   (`yc iam create-token`, живёт ≤12 ч), `DATALENS_ORG_ID`, роль `dataLens.editor`.

## Webhook (обратный канал)

`POST /api/integrations/datalens/webhook/:token` — публичный приёмник с токеном
(`DATALENS_WEBHOOK_TOKEN`): код подтверждения и алерты пишутся в `datalens_events` (хвост 500)
и приходят админам в колокольчик. Страница **Администрирование → Интеграции** показывает URL,
токен и журнал событий; аналитик может запросить подключение (уведомление админам).

## Права

Страница DataLens и CSV-экспорт доступны аналитику и админу (см. [Роли и права](Roles.md)).

Дальше: [Метрика и цели](Metrika-and-Goals.md) · [Деплой](Deploy.md) · [FAQ](FAQ.md)
