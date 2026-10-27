# sync-every-30-min → capability `metrika-sync`

## ADDED Requirements

### Requirement: Плановый синк каждые 30 минут

Таймер `pca-sync.timer` SHALL запускать синк каждые 30 минут (`OnCalendar=*:0/30`,
RandomizedDelaySec=5min, Persistent). Окно планового синка SHALL быть последние 3 дня
(`cli-sync --days=3`) — свежие дни + экономия квоты; крупные догрузки выполняются вручную
(`--from/--to`). Ручные данные (B2B, платежи, маркетинговая сетка) синк не трогает.

#### Scenario: Дашборд актуален к получасу

- **WHEN** прошёл слот таймера (:00 или :30 + разброс до 5 мин)
- **THEN** `/api/sync/status` показывает прогон с `finishedAt` в пределах последнего получаса,
  и «сегодняшние» цифры на страницах обновлены

### Requirement: Прогон фиксируется и обновляет маркетинговую сетку

Крон-запуск SHALL записывать себя в `sync_runs` (старт/финал/статус/ошибки) и после
успешного синка SHALL пересчитывать syncable-ячейки маркетинговой сетки
(`marketing_weekly`, источник `metrika`; manual/import не трогаются). До первого запуска
`GET /api/sync/status` SHALL отвечать `200 {run: null}` (без 404 в консоли).

#### Scenario: Сетка обновляется без ручных действий

- **WHEN** крон-синк успешно загрузил окно
- **THEN** `sync_runs` содержит запись со статусом `ok`, а syncable-ячейки
  `landings_visits`/`site_goals`/`payments`/`b2b_leads` пересчитаны

### Requirement: Автообновление воркбука DataLens

Таймер `pca-datalens.timer` (каждые 30 минут со сдвигом :15/:45) SHALL запускать
идемпотентный push воркбука (`scripts/push-datalens.mjs --workbook=$DATALENS_WORKBOOK_ID`),
если `DATALENS_WORKBOOK_ID` задан в `.env`; иначе юнит SHALL пропуститься
(ConditionEnvironment). Датасеты нативного коннектора Метрики обновляются по расписанию
DataLens — источником является сам Яндекс.Метрика.

#### Scenario: Юнит без воркбука не шумит

- **WHEN** `DATALENS_WORKBOOK_ID` не задан
- **THEN** `pca-datalens.service` пропускается по условию, в журнале — «Skipped», алертов нет
