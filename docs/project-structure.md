# Структура и назначение проекта

> 🇷🇺 Подробный гид по репозиторию. Архитектура и потоки данных — [architecture.md](architecture.md);
> модель БД — [data-model.md](data-model.md); деплой — [deploy.md](deploy.md).

## Назначение проекта

**ProductCamp Conversion Analytics** — аналитический кабинет трека «Конверсии и лидген».
Задача: довести продажи до **KPI 300+ платных билетов**, разделяя «заявку» и «оплату».

Что делает:

1. **Парсит** Яндекс.Метрику по OAuth и хранит данные в SQLite (история по дням); Live-страницы
   показывают реальное время напрямую из Reporting API.
2. **Кабинет** с входом по сессиям, ролями Администратор/Аналитик и журналом действий: обзор,
   live-мониторинг, цели, воронки, трафик, поведение, KPI, «Исследуй», отчёты, B2B, DataLens.
3. **Администрирование**: пользователи, AI-провайдеры (OpenRouter/Anthropic/YandexGPT/GigaChat),
   настройки Метрики, интеграции, аудит.
4. **Отчёты** DOCX/PDF из неизменяемого снапшота + RAG-ассистент по справке.

## Дерево репозитория

```
.
├── code/
│   ├── backend/            # Fastify API, Metrika-клиент, SQLite, AI, кабинет
│   │   └── src/
│   │       ├── app.ts          # сборка Fastify: guard сессий, регистрация всех роутов
│   │       ├── server.ts       # точка входа: миграции, bootstrap-админ, LLM, listen
│   │       ├── config.ts       # Zod-схема .env (один источник конфигурации)
│   │       ├── auth/           # auth.ts (login/logout/me, RBAC-правила, rate limiter),
│   │       │                   #   users-repo.ts (пользователи, сессии, audit_log)
│   │       ├── security/       # crypto.ts: scrypt-пароли, AES-256-GCM, sha256, токены
│   │       ├── settings/       # app-settings.ts (app_settings + шифрование секретов),
│   │       │                   #   routes.ts (GET/POST /api/settings, DataLens-токен, чистка данных)
│   │       ├── llm/            # providers.ts (4 провайдера + PROVIDER_META), service.ts
│   │       │                   #   (цепочка по приоритету, ai_usage), routes.ts (/api/ai/**, /api/admin/ai/**)
│   │       ├── metrika/        # client.ts, oauth.ts, cli-auth/sync.ts, sync-service.ts,
│   │       │                   #   production-sync.ts, queries/ (5 срезов + ratio)
│   │       ├── live/           # live.ts: /api/live/* — реальное время (summary, goals,
│   │       │                   #   funnel, table-пресеты «Исследуй»)
│   │       ├── help/           # help.ts: статьи docs/help/<lang>, поиск, POST /api/help/ask (RAG)
│   │       ├── integrations/   # datalens.ts: CSV-датасеты, webhook-приёмник, уведомления
│   │       ├── db/             # connection.ts (WAL+FK), migrate.ts + cli-migrate.ts,
│   │       │   │               #   seed* (демо-данные), migrations/001..010.sql,
│   │       │   └── repositories/  # metrics, hypotheses, decisions, b2b, snapshot
│   │       ├── routes/         # health, metrics, hypotheses, decisions, b2b, sync, report (+settings в legacy-режиме)
│   │       ├── report/         # snapshot-builder, production-report, ai-insights/hypotheses/decisions,
│   │       │                   #   docx/ и pdf/ (рендеры), chart-renderer (PNG для отчёта)
│   │       └── utils/          # мелкие общие хелперы
│   ├── frontend/           # React + Vite кабинет
│   │   └── src/
│   │       ├── App.tsx         # роуты: /, /login, /help, /app/** (RequireAuth/RequireAdmin)
│   │       ├── auth/           # AuthContext (сессия, RequireAuth/RequireAdmin)
│   │       ├── components/     # CabinetLayout (сайдбар/топбар/колокольчик/футер с версией),
│   │       │                   #   Assistant (RAG, правый нижний угол), charts/, ui/, DataGrid…
│   │       ├── pages/
│   │       │   ├── public/     # Landing, Login, HelpCenter, PublicChrome
│   │       │   ├── app/        # Live, Goals, GoalDetail, FunnelLive, Explore, DataLens, Forbidden
│   │       │   └── admin/      # Users, AiProviders, Metrika, Integrations, Audit
│   │       ├── routes/         # аналитические страницы кабинета: overview, traffic, behavior,
│   │       │                   #   funnel, goals (KPI), report-preview, history, b2b
│   │       ├── i18n/           # dict.ts (ru/en), useT
│   │       ├── store/          # filters.ts (период/сегмент), prefs.ts (тема, язык — localStorage)
│   │       └── lib/            # api.ts, api-v3.ts (кабинет), echarts-theme, format, funnel,
│   │                           #   sankey, md-to-html, download и др.
│   └── shared/             # @pca/shared: типы, ICE_CONFIG, report-sections, валидация гипотез
├── deploy/                 # конфигурации сервера (nginx, systemd) — см. docs/deploy.md
├── docs/                   # эта документация: architecture, data-model, deploy, user-guide (ru/en),
│   │                       #   runbook (ru/en), quickstart, help/ru|en (статьи справки),
│   │                       #   decisions/ (ADR), specs/, wiki/
├── e2e/                    # Playwright: smoke, страницы, фильтры, b2b, report, mobile
├── QA/                     # промпты регресс/UX-тестирования
├── scripts/                # sync-versions.mjs (версия в шапках доков)
├── data/                   # SQLite, отчёты, экспорт (gitignored)
├── .github/                # workflows, шаблоны, dependabot
├── .githooks/              # pre-commit (sync-versions), включается через core.hooksPath
├── CLAUDE.md               # контекст продукта для AI-агентов
├── setup.sh / init.sh / run.sh   # локальный запуск: install → init (.env) → start
└── package.json            # pnpm workspace, версия продукта (попадает в футер UI)
```

## Ключевые модули backend (v3)

| Модуль          | Ответственность                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `auth/`         | Сессии (cookie `pca_session`, хэш в `sessions`), RBAC-правила (admin/analyst), пользователи, аудит    |
| `security/`     | scrypt-пароли, AES-256-GCM для секретов БД (`APP_SECRET`), генерация временных паролей                |
| `settings/`     | Runtime-настройки админа (`app_settings`) — переопределяют `.env` без рестарта; маскирование секретов |
| `llm/`          | 4 AI-провайдера, цепочка по `priority`, шифрование ключей, статистика `ai_usage`                      |
| `live/`         | Реальное время: summary, цели (+дубликаты/статусы), воронка PC-событий, пресеты «Исследуй»            |
| `help/`         | Справка: markdown-статьи с front matter из `docs/help/<lang>/`, поиск, RAG-ответы `/api/help/ask`     |
| `integrations/` | DataLens: 5 CSV-датасетов, webhook с токеном, события, колокольчик уведомлений                        |
| `metrika/`      | OAuth-помощник, клиент (Zod, лимитер, retry), SyncService (дневные чанки, best-effort срезы)          |
| `report/`       | Immutable-снапшот → DOCX/PDF (ГОСТ) + AI-секции через цепочку LLM                                     |

## Страницы фронтенда

- **Публичные** (`pages/public/`): лендинг `/`, вход `/login`, справка `/help` (`HelpCenter`).
- **Кабинет** (`/app`, `components/CabinetLayout`): Обзор, Live, Цели + GoalDetail, Воронка live,
  Трафик, Поведение, Воронка, KPI, Исследуй (`explore/:preset`), Отчёт, История, B2B, DataLens.
- **Админка** (`pages/admin/`, обёрнута в `RequireAdmin`): Пользователи, AI-провайдеры, Метрика,
  Интеграции, Аудит.
- До-v3 URL (`/traffic`, `/report`, `/settings`, …) редиректят в `/app/…`.

## Папка `deploy/`

Конфигурации для сервера Ubuntu: nginx (reverse proxy + статика фронта), systemd-юниты backend,
скрипты обновления. Пошаговая инструкция — [deploy.md](deploy.md).

## Конвенции

- Доступ к БД — только через репозитории (`code/backend/src/db/repositories/`); миграции —
  нумерованные SQL-файлы в `db/migrations/` (001..010).
- Страницы фронтенда — паттерн «чистая View(status, …) + тонкий data-wrapper»; графики — ECharts
  через общую тему (`lib/echarts-theme.ts`).
- Тексты интерфейса — только через `i18n/dict.ts` (`useT`); ru/en.
- Новые зависимости вне зафиксированного стека — через ADR в `docs/decisions/`.
- Нетривиальные фичи — через спеку (`docs/specs/`): spec → review → plan → tests → impl.
