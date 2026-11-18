# Ops-runbook — единый операционный справочник

> Краткая шпаргалка дежурного: доступы, квота Метрики, DataLens, деплой, вики, данные.
> Подробности: [deploy/DEPLOY.md](../deploy/DEPLOY.md), [docs/admin-guide.md](admin-guide.md),
> [docs/deploy.md](deploy.md).

## 1. Доступы и учётки

- **Главная админка (локальная):** `admin@local.test` — роль «Администратор».
- **Демо-прод (dashboardcamp.ru):** `admin@dashboardcamp.ru` (админ) и
  `analyst@dashboardcamp.ru` (роль «Аналитик» — без настроек, AI-провайдеров и удаления).
- **Смена пароля** — только через сервер, tsx-скриптом из ANA-115; `DEMO_*_PASSWORD`
  в env существующих пользователей **не обновляет**.

```bash
ssh root@YOUR_SERVER_IP
cd /opt/pca/app
# tsx-скрипт ANA-115 (смена пароля учётки): пароль ≥ 10 символов.
# Скрипт делает: UPDATE users (новый scrypt-хэш) + DELETE sessions (все сессии разлогинены).
```

Политика: пароли — scrypt, политика «только через сервер»; админ может также
сбросить пароль из UI (`/app/admin/users` → «Сбросить пароль» — выпускает временный
пароль и завершает сессии).

## 2. Квота Метрики

- **Лимит:** 5000 запросов/сутки на UID (`quota_requests_by_uid`), сброс **00:00 GMT**.
  Квота общая: таймерный синк, ручные прогоны, любой туллинг.
- **Расход таймера:** ~29 вызовов API/прогон (range-синки ANA-113) × 48 прогонов/сутки
  ≈ **1400 из 5000**. Окна > 31 дня — фолбэк на per-day, тратят квоту заметно быстрее.

```bash
# Диагностика исчерпания (HTTP 429) и последнего синка:
journalctl -u pca-sync.service -n 100
curl -s http://127.0.0.1:4000/api/sync/status | jq   # единственная точка правды по свежести
```

**Что нельзя:** запускать параллельные бэкфилл-драйверы. Инцидент 31.10: rogue-сессия
выжгла суточный лимит за 4,5 часа. Правило: один бэкфилл за раз, `pca-sync.timer`
на время догрузки останавливать.

## 3. DataLens

Env — в `/opt/pca/.env`:

| Переменная             | Назначение                                                                   |
| ---------------------- | ---------------------------------------------------------------------------- |
| `DATALENS_IAM_TOKEN`   | обязателен; `yc iam create-token`, живёт ≤ 12 ч                              |
| `DATALENS_WORKBOOK_ID` | из адреса `datalens.ru/workbooks/<ID>`; без него `pca-datalens` пропускается |
| `DATALENS_ORG_ID`      | опционально                                                                  |
| `METRIKA_OAUTH_TOKEN`  | нужен только для `--update-connection`                                       |

Без env таймер работает вхолостую: юнит пропускается, CSV-пуш не выполняется
(дашборд DataLens остаётся на старых данных).

```bash
# Ручной пуш данных:
node scripts/push-datalens.mjs --workbook=<id>

# Авто-обновление IAM-токена: cron запускает 2×/сут на машине оператора:
node scripts/refresh-datalens-token.mjs   # обновляет /opt/pca/.env и настройки админки одним токеном
```

## 4. Деплой

```bash
# Прод из main: гейты → deploy/deploy.sh (rsync) → health-check /api/health
gh workflow run deploy.yml --ref main

# Теги v*.*.* → release (gh release create --generate-notes)
git tag v1.2.3 && git push origin v1.2.3

# Откат — redeploy предыдущего коммита:
git revert <bad>  # или: gh workflow run deploy.yml --ref main после возврата main
```

Health-check зелёный → деплой успешен; при провале см. `journalctl -u pca-api -n 50`.

## 5. Вики

- Контент — в `docs/wiki/` (репозиторий — источник правды).
- **Публикация ОТКЛЮЧЕНА** решением от 01.11: workflow Wiki удалён из `.github/workflows/`,
  скрипт `scripts/publish-wiki.sh` остался (не запускать без нужды).
- **Включить обратно:** Settings → Features → Wikis в GitHub; restore workflow-файла
  из git-истории; затем `scripts/publish-wiki.sh` (bootstrap-push) для первичной заливки.

## 6. Данные

- **Свежесть:** единственная точка правды — `GET /api/sync/status`
  (или «Метрика и данные» в админке).
- **Полнота по таблицам:** coverage-эндпоинт (админка → отчёт покрытия, окно синка
  включено). Дыры таблиц — `utm`, `geo-device`, `pages`, `exit-pages` имели
  исторические блоки; окна дозагружены/догружаются 01–02.11 бэкфилл-скриптами
  (по одному драйверу за раз, см. раздел 2).

Проверка после догрузки: `sync/status` → последний успешный прогон; coverage → нет
пропусков дней в окне.
