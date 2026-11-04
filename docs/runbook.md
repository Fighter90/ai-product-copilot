# Runbook — запуск и эксплуатация

> 🇷🇺 Русский · [🇬🇧 English](en/runbook.md)
> **Текущая версия:** v2.6.0 (2026-05-27)

Подробная инструкция «как запустить проект», в т.ч. для волонтёра без backend-опыта.

## 1. Требования

- **Node.js 22 LTS** (`node -v` → v22.12+). Установка: https://nodejs.org или `nvm install 22`.
- **pnpm 9** — поставится автоматически из `run.sh`, либо вручную: `npm i -g pnpm`.
- macOS / Linux. На Windows — через WSL2.

## 2. Первый запуск (одной командой)

```bash
cd ai-product-copilot
./run.sh
```

Что делает `run.sh` по шагам:

1. Проверяет Node, при отсутствии `pnpm` ставит его.
2. `pnpm install` (если нет `node_modules`).
3. Если нет `.env` — копирует из `.env.example` и просит вписать токен (выходит).
4. Загружает `.env`, прогоняет миграции. Если `YANDEX_OAUTH_TOKEN` **не задан** — наполняет БД
   **демо-данными** (`pnpm seed`), чтобы дашборд сразу был рабочим; если задан — делает реальный `sync`.
5. Запускает `pnpm dev` (backend + frontend) и открывает браузер.

> **Демо-режим без токена.** `pnpm seed` (или `pnpm --filter @pca/backend seed`) кладёт в SQLite
> детерминированный набор примеров (каналы, UTM, гео/девайс, страницы входа/выхода, B2B-сделки, цели).
> Это иллюстративные данные, не из Метрики, — удобно показать инструмент волонтёрам до получения OAuth.

## 3. Настройка `.env`

```bash
cp .env.example .env
```

Заполните:

| Переменная                                  | Значение                                                 |
| ------------------------------------------- | -------------------------------------------------------- |
| `YANDEX_OAUTH_TOKEN`                        | токен `metrika:read` (см. README → «Как получить токен») |
| `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` | данные OAuth-приложения                                  |
| `COUNTER_ID`                                | ваш счётчик Метрики (задаётся в `.env`, нужен для sync)  |
| `GOAL_ID`                                   | `0` = авто-определение KPI-цели; `> 0` фиксирует цель    |
| `PORT` / `API_PORT`                         | `5173` / `4000`                                          |
| `ARCHIVED_GOAL_ID_THRESHOLD`                | `77` (цели старше — архивные)                            |
| `LOW_UTM_COVERAGE_RATIO`                    | `0.7` (порог флага низкого покрытия UTM)                 |

`.env` в `.gitignore` — токен и secret никогда не попадают в репозиторий.

## 4. Проверка, что всё поднялось

- Frontend: http://localhost:5173 — карточка «Backend health» должна показать `ok`.
- Backend: `curl http://localhost:4000/api/health` → JSON со `status: "ok"`,
  `counterId` и `metrikaTokenPresent`.

Поле `metrikaTokenPresent: false` означает, что токен ещё не вписан в `.env`.

## 5. Частые команды разработчика

```bash
pnpm dev         # backend + frontend в watch-режиме
pnpm typecheck   # строгая проверка типов
pnpm lint        # ESLint
pnpm test        # Vitest
pnpm build       # сборка (артефакт frontend → code/frontend/dist)
```

## 5a. Экспорт отчётов (DOCX / PDF)

На странице **Report** соберите snapshot и нажмите **Export DOCX** или **Export PDF** —
файл сохраняется в `data/reports/{id}.{docx|pdf}`.

- **DOCX** работает «из коробки», ничего ставить не нужно.
- **PDF** рендерится через `puppeteer-core`, который не скачивает Chromium (чтобы установка и CI были
  быстрыми). Укажите путь к локальному Chrome в `.env`:

  ```bash
  # macOS
  PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  # Linux
  PUPPETEER_EXECUTABLE_PATH="$(which google-chrome || which chromium-browser)"
  ```

  Без валидного `PUPPETEER_EXECUTABLE_PATH` экспорт PDF упадёт — используйте DOCX или установите Chrome.

## 6. Траблшутинг

| Симптом                                    | Причина / решение                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Node.js 22.12+ required`                  | поставьте Node 22 (`nvm install 22 && nvm use 22`).                                                                                        |
| Браузер открылся, но «Backend недоступен»  | backend ещё стартует — обновите через 2–3 сек; проверьте `API_PORT=4000` свободен.                                                         |
| `metrikaTokenPresent: false`               | впишите `YANDEX_OAUTH_TOKEN` в `.env` и перезапустите.                                                                                     |
| `EADDRINUSE :4000` / `:5173`               | порт занят — поменяйте `API_PORT` / `PORT` в `.env`.                                                                                       |
| `pnpm: command not found`                  | `npm i -g pnpm` (или просто запустите `./run.sh`).                                                                                         |
| Sync упал с ошибкой токена, данные пропали | Начиная с v2.6.0 sync валидирует токен **до** очистки БД — пустая база после ошибки токена невозможна. Проверьте `YANDEX_OAUTH_TOKEN`.     |
| Блок «Страницы выхода» не отображается     | Это ожидаемое поведение: Яндекс.Метрика не отдаёт `ym:s:exitURL` для данного счётчика. Таблица `exit_page_stats` остаётся пустой — не баг. |

## 7. Остановка

`Ctrl+C` в терминале с `run.sh` — завершает backend и frontend.

## 8. Прод-сервер (dashboardcamp.ru)

Приложение живёт на VPS: systemd (`pca-api` + таймеры `pca-sync`/`pca-backup`/
`pca-monitor`), nginx + HTTPS (Let's Encrypt). Полная инструкция —
[`deploy/DEPLOY.md`](../deploy/DEPLOY.md); главное:

- **Доступ только по SSH-ключу** (`~/.ssh/pca_deploy`): вход по паролю отключён,
  root — только по ключу, ufw (22/80/443), fail2ban, автообновления безопасности
  (ANA-51; применение и чеки — раздел 8 в `deploy/DEPLOY.md`).
- **Security-заголовки и CSP** — один сниппет `deploy/nginx-security-headers.conf`
  (ANA-52). Если менялся инлайновый `<script>` в `index.html` — пересчитать CSP-хеш
  (раздел 7.1 в `deploy/DEPLOY.md`), иначе браузер заблокирует скрипт.
- **Передеплой** — `./deploy/deploy.sh` из корня репо: фронт собирается локально,
  rsync на сервер, рестарт юнитов, health-check. Простой — только окно рестарта
  `pca-api` (~1–2 с); in-flight запросы дожидаются ответа (graceful shutdown:
  SIGTERM → `app.close()`).
- **Docker-альтернатива** (`Dockerfile` + `docker-compose.yml`) — раздел 9
  в `deploy/DEPLOY.md` и раздел 11 в `docs/deploy.md`; прод работает на systemd.

## 8. Прод-сервер (dashboardcamp.ru)

Приложение работает на VPS: systemd (`pca-api` + таймеры `pca-sync`/`pca-backup`/
`pca-monitor`), nginx + HTTPS (Let's Encrypt). Полная инструкция —
[`deploy/DEPLOY.md`](../deploy/DEPLOY.md); минимум, который стоит знать:

- **Доступ — только по SSH-ключу** (`~/.ssh/pca_deploy`): вход по паролю отключён,
  root — только по ключу, ufw (22/80/443), fail2ban, автообновления безопасности (ANA-51).
- **Security-заголовки и CSP** — один сниппет `deploy/nginx-security-headers.conf`
  (ANA-52). После изменения инлайнового `<script>` в `index.html` пересчитайте
  CSP-хеш (раздел 8.3 `deploy/DEPLOY.md`), иначе браузер заблокирует скрипт.
- **Повторный деплой** — `./deploy/deploy.sh` из корня репо: сборка фронта локально,
  rsync, рестарт юнитов, health-check. Простой — только окно рестарта `pca-api`
  (~1–2 с), in-flight запросы дослуживаются через graceful shutdown (SIGTERM → `app.close()`).
- **Docker-вариант** (`Dockerfile` + `docker-compose.yml`) — раздел 9
  `deploy/DEPLOY.md` и раздел 11 `docs/deploy.md`; прод при этом работает на systemd.

### Догрузка истории и квота Метрики (ANA-107)

У Reporting API **две квоты** (скользящие 24 ч, сброс — начало следующего суточного окна):

- **per-UID** (5000 запр./сут на пользователя) — своя у основного и резервного аккаунтов;
- **per-counter** — общая на счётчик для всех пользователей; резервный токен её **не расширяет**.

Догруз окон порциями по 10 дней выполняют server-side скрипты (идемпотентные, стартуют
с первого пропущенного дня):

- `/opt/pca/backfill-tables-loop.sh` — пер-таблицный луп (utm/geo/pages/exit), patient mode:
  при 429 ждёт 180–600 с и повторяет. Журнал `/tmp/backfill-tables.log`, финиш — `TABLES_DONE`.
- Во время догрузки **останавливайте** `pca-sync.timer` (30-минутные прогоны съедают квоту)
  и возвращайте после `TABLES_DONE`: `systemctl enable --now pca-sync.timer`.
- Разовые окна: `/opt/pca/backfill-remaining.sh FROM TO`.

#### Резервный аккаунт (v3.4.0)

- Токен резерва хранится в `/opt/pca/.env` (`METRIKA_BACKUP_OAUTH_TOKEN`) **и** в настройках
  админки (зашифрованным); синк на сервере читает env-фолбэк.
- Ручной выпуск токена: ссылка `https://oauth.yandex.ru/authorize?response_type=code&client_id=…&redirect_uri=https://oauth.yandex.ru/verification_code`
  под резервным аккаунтом → код → `POST /api/goals/backup-token/exchange` (form-encoded;
  Yandex `/token` JSON не принимает) — или вписать токен прямо в `.env`.
- Проверка токена: management-список счётчиков (`/management/v1/counters`) — покажет владельца
  и доступ; stat-probe `/stat/v1/data` — покажет 200/403/429 и тип квоты
  (`quota_requests_by_uid` — исчерпан per-UID этого токена, `quota_requests_by_counter_id` —
  общая квота счётчика, ждать сброса).
- Финальная per-таблицная сверка против Метрики: `node scripts/reconcile-data.mjs --tables-only
--from=… --to=…` (~2220 вызовов на 555 дней); чтобы прогнать под резервной квотой:
  `YANDEX_OAUTH_TOKEN=<backup> node scripts/reconcile-data.mjs …`; офлайн gap-report по бэкапу
  без SSH: `node scripts/reconcile-data.mjs --db <backup.db.gz-распакованный> --gap-report`.

Регенерация IAM-токена DataLens (≤12 ч) — `scripts/refresh-datalens-token.mjs` на машине
оператора (cron 2×/сут): обновляет `/opt/pca/.env` И настройки админки одним токеном.
