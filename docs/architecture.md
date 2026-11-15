# Архитектура

> 🇷🇺 Русский. Обзорный документ; детали — в ADR (`docs/decisions/`) и коде.

v3 — многопользовательский **личный кабинет** поверх аналитического инструмента: парсит
Яндекс.Метрику → SQLite → API → кабинет (роли, аудит) + DataLens + AI-провайдеры.
Публичная часть (лендинг, вход, справка) — без сессии; всё под `/app` — только после логина.

**Текущая версия:** v3.4.33 (2026-11-05)

## Компоненты

```mermaid
flowchart TD
  subgraph Client [Браузер]
    PUB[Публичные страницы<br/>Лендинг · Вход · Справка /help]
    CAB[Кабинет /app<br/>React 18 + Vite + Tailwind + ECharts]
    ADM[Администрирование<br/>Пользователи · AI · Метрика · Интеграции · Аудит]
    ASST[RAG-ассистент<br/>плавающая кнопка]
  end

  subgraph Backend [Backend · Fastify 4 + tsx]
    GUARD["Session guard (onRequest)<br/>cookie pca_session · RBAC admin/analyst"]
    AUTH[auth/<br/>login · logout · me · users · audit]
    SET[settings/<br/>app_settings · runtime-настройки]
    LLM[llm/<br/>провайдеры · приоритеты · usage]
    LIVE[live/<br/>реальное время через Reporting API]
    HELP[help/<br/>статьи docs/help + /help/ask]
    DL[integrations/datalens<br/>CSV-экспорт + webhook]
    CORE[routes/ + db/repositories<br/>метрики · гипотезы · B2B · отчёты]
    SYNC[metrika/sync-service<br/>дневные чанки · Zod · retry]
    SNAP[report/<br/>SnapshotBuilder → DOCX/PDF + AI]
  end

  subgraph Store [SQLite · better-sqlite3]
    METRIC[("Метрики по дням:<br/>channel/utm/geo/page/exit + raw_responses")]
    METH[("Методология:<br/>hypotheses · decisions · b2b_manual · snapshots")]
    CABDB[("Кабинет:<br/>users · sessions · audit_log")]
    CFG[("Настройки и AI:<br/>app_settings · ai_providers · ai_usage")]
    EVT[("События:<br/>datalens_events · notifications")]
  end

  YM[Яндекс.Метрика API]

  PUB -- REST --> GUARD
  CAB -- "/api/** (fetch)" --> GUARD
  ADM -- "/api/admin/**" --> GUARD
  ASST -- "POST /api/help/ask" --> GUARD
  GUARD --> AUTH & SET & LLM & LIVE & HELP & DL & CORE
  AUTH --> CABDB
  SET --> CFG
  LLM --> CFG
  LIVE -. прямые запросы, без записи в БД .-> YM
  HELP --- DOCS[("docs/help/ru · en/*.md")]
  DL --> EVT
  CORE --> METRIC & METH
  SYNC --> YM --> METRIC
  SNAP --> METH
  SNAP -. через цепочку LLM .-> LLM
  LLM -.-> PROV[Внешние AI:<br/>OpenRouter / Anthropic / YandexGPT / GigaChat]
  DL --> EXT[Яндекс DataLens<br/>Files-подключение по CSV]
```

## Поток данных: Метрика → SQLite → API → кабинет / DataLens

```mermaid
flowchart LR
  YM[(Яндекс.Метрика<br/>Stat API)] -- "OAuth-токен (app_settings)" --> SYNC["SyncService<br/>npm run sync / POST /api/sync"]
  SYNC --> RAW[(raw_responses<br/>сырые ответы)]
  SYNC --> CH[(channel_stats)]
  SYNC --> UTM[(utm_stats)]
  SYNC --> GEO[(geo_device_stats)]
  SYNC --> PG[(page_stats)]
  SYNC --> EXPG[(exit_page_stats)]
  CH & UTM & GEO & PG & EXPG --> REPO[Репозитории]
  GOALS[(goals)] & METH[(hypotheses · decisions<br/>b2b_manual · report_snapshots)] --> REPO
  REPO --> API["Fastify API /api/*<br/>+ Swagger /docs"]
  API --> CAB["Кабинет:<br/>Обзор · Трафик · Поведение · Воронка<br/>KPI · Отчёт · История · B2B"]
  API --> EXPORT["GET /api/integrations/datalens/export/:id<br/>CSV (UTF-8 BOM)"]
  EXPORT --> DATALENS["Яндекс DataLens<br/>датасеты: каналы / UTM / страницы<br/>гео+устройства / B2B-сделки"]
  LIVE[("Live-режим<br/>/api/live/*")] -.-> YM
  LIVE --> CAB2["Live · Воронка live · Цели<br/>Исследуй (пресеты)"]
```

Ключевое:

- **История — по дням.** Повторный sync добавляет даты (`INSERT … ON CONFLICT`), не затирая прошлое;
  отсюда WoW-сравнения и воспроизводимость. Каждое число прослеживается до `raw_responses`.
- **Live-страницы не пишут в БД** — `/api/live/*` ходит в Reporting API напрямую с токеном из
  `app_settings` (реальное время за выбранный период).
- **DataLens** получает плоские CSV-датасеты (`integrations/datalens.ts`, 5 датасетов) по
  авторизованному экспорту; обратный канал — webhook-приёмник с токеном (`datalens_events`,
  уведомления админам).

### Синхронизация (sequence)

```mermaid
sequenceDiagram
  participant U as Пользователь/CLI
  participant API as Fastify /api/sync
  participant S as SyncService
  participant M as Метрика Stat API
  participant DB as SQLite

  U->>API: POST /api/sync {from, to}
  API->>API: сессия обязательна (аналитик/админ)
  API->>S: runSync(from, to, goalId?)
  S->>M: GET goals (валидация токена + список целей)
  S->>S: selectPrimaryGoal (GOAL_ID=0 → авто-детект цели-покупки)
  loop по дням и срезам
    S->>M: отчёт за день (traffic/utm/geo/pages/exit)
    M-->>S: JSON (Zod-валидация, rate-limit, retry)
    S->>DB: INSERT raw_responses (идемпотентно)
    S->>DB: upsert производных таблиц (ON CONFLICT)
  end
  S-->>API: summary (даты, строки, пропуски best-effort)
  API-->>U: сводка синхронизации
```

### Отчёт (sequence)

```mermaid
sequenceDiagram
  participant U as Аналитик (кабинет)
  participant API as Fastify /api/report
  participant SB as SnapshotBuilder
  participant DB as SQLite
  participant R as DOCX/PDF render
  participant LLM as Цепочка AI (опц.)

  U->>API: POST /report/snapshot {period}
  API->>SB: build(period)
  SB->>DB: метрики + b2b_manual + цели
  SB-->>API: immutable snapshot (payload JSON)
  API->>DB: INSERT report_snapshots (ulid)
  opt AI-анализ (кнопка «Сгенерировать AI-анализ»)
    U->>API: POST /report/insights | /report/hypotheses {snapshotId}
    API-->>U: 202 {jobId} — генерация ушла в фоновую однослотную очередь (ANA-133); слот занят → 429 Retry-After
    API->>LLM: фоновый воркер (setImmediate, вне HTTP-контекста), snapshot-факты через chainAsAnthropicFetch
    LLM-->>API: текст анализа (в payload снапшота, не в render)
    U->>API: GET /report/ai-jobs/:jobId (поллинг)
    API-->>U: running | done {result} | failed {error} (после рестарта API — 404)
  end
  U->>API: POST /report/generate {snapshotId, format}
  API->>DB: чтение snapshot (тот же ulid)
  API->>R: render из snapshot — без LLM и Date.now()
  R-->>API: DOCX (docx) / PDF (Puppeteer + server-side графики)
  U->>API: GET /report/download/:snapshotId/:format
  API-->>U: файл; один snapshotId → байт-идентичный результат
```

### AI-фолбэк (sequence)

```mermaid
sequenceDiagram
  participant C as Потребитель (отчёт / help/ask)
  participant S as LlmService.complete
  participant P1 as Провайдер #1 (min priority)
  participant P2 as Провайдер #2
  participant DB as SQLite ai_usage

  C->>S: prompt {purpose}
  loop по включённым провайдерам в порядке priority
    S->>P1: запрос (ключ из ai_providers.secret_enc)
    alt успех
      P1-->>S: текст
      S->>DB: INSERT ai_usage (ok=1, объём, мс)
      S-->>C: ответ (provider, model)
    else ошибка / таймаут / нет ключа
      P1--xS: ошибка
      S->>DB: INSERT ai_usage (ok=0, error)
      Note over S,P2: следующий провайдер цепочки
      S->>P2: запрос
    end
  end
  alt все провайдеры недоступны
    S--xC: ошибка AI_UNAVAILABLE (вызывающий код деградирует сам)
  end
```

## Аутентификация и RBAC

- Пароли — **scrypt** (per-user salt, `security/crypto.ts`); в БД только `password_hash`.
- Сессии — cookie `pca_session` (HttpOnly, SameSite=Lax, `Secure` при `COOKIE_SECURE=1`);
  в БД хранится только **sha256-хэш** токена + срок, ip, user-agent (`sessions`).
- Загрузочный администратор создаётся при старте из `ADMIN_EMAIL`/`ADMIN_PASSWORD`, когда таблица
  `users` пуста; `DEMO_USERS=1` добавляет демо-аккаунты (админ + аналитик).
- Ограничение входа: 5 неудач за 15 минут на пару ip+email → 429.
- Роли: **Администратор** (всё) и **Аналитик** (аналитика, отчёты, B2B, DataLens-экспорт — без
  администрирования). Права проверяются на бэкенде (правила ниже) и в UI (`RequireAdmin`).

```mermaid
flowchart TD
  REQ[Запрос с cookie pca_session] --> H{"Хэш токена есть<br/>в sessions и не истёк?"}
  H -- нет --> PUB401{"Путь публичный?<br/>/api/health · auth/login · auth/logout<br/>help · datalens/webhook"}
  PUB401 -- да --> OK200[Пропуск]
  PUB401 -- нет --> E401[401 AUTH_REQUIRED]
  H -- да --> ADM{"Требуется admin?<br/>/api/admin/**, /api/users,<br/>мутации /api/settings,<br/>мутации /api/ai/providers, DELETE /api/data"}
  ADM -- да, роль analyst --> E403[403 ADMIN_ONLY]
  ADM -- да, роль admin --> OK
  ADM -- нет --> OK[Пропуск · req.user]
```

```mermaid
sequenceDiagram
  participant B as Браузер
  participant A as Fastify (onRequest guard)
  participant DB as SQLite (users/sessions/audit_log)

  B->>A: POST /api/auth/login {email, password}
  A->>A: rate-limit (5 неудач / 15 мин)
  A->>DB: verifyPassword (scrypt)
  alt успех
    A->>DB: INSERT sessions (sha256(token), expires_at, ip, ua)
    A->>DB: INSERT audit_log (auth.login)
    A-->>B: Set-Cookie pca_session + {user}
  else неудача
    A->>DB: INSERT audit_log (auth.login_failed)
    A-->>B: 401 BAD_CREDENTIALS
  end
  B->>A: GET /app/** /api/**
  A->>DB: userBySession(sha256(token))
  A->>A: публичный путь? RBAC-правила для роли
  A-->>B: 200 / 401 / 403
```

## Кабинет: страницы и права

| Раздел    | Страница      | URL                            | Доступ          |
| --------- | ------------- | ------------------------------ | --------------- |
| Монитор   | Обзор         | `/app`                         | аналитик, админ |
|           | Live          | `/app/live`                    | аналитик, админ |
|           | Цели + деталь | `/app/goals`, `/app/goals/:id` | аналитик, админ |
|           | Воронка live  | `/app/funnel-live`             | аналитик, админ |
| Аналитика | Трафик        | `/app/traffic`                 | аналитик, админ |
|           | Поведение     | `/app/behavior`                | аналитик, админ |
|           | Воронка       | `/app/funnel`                  | аналитик, админ |
|           | KPI           | `/app/kpi`                     | аналитик, админ |
|           | Исследуй      | `/app/explore/:preset`         | аналитик, админ |
| Работа    | Отчёт         | `/app/report`                  | аналитик, админ |
|           | История       | `/app/history`                 | аналитик, админ |
|           | B2B           | `/app/b2b`                     | аналитик, админ |
|           | DataLens      | `/app/datalens`                | аналитик, админ |
| Админ     | Пользователи  | `/app/admin/users`             | **админ**       |
|           | AI-провайдеры | `/app/admin/ai`                | **админ**       |
|           | Метрика       | `/app/admin/metrika`           | **админ**       |
|           | Интеграции    | `/app/admin/integrations`      | **админ**       |
|           | Аудит         | `/app/admin/audit`             | **админ**       |

Публичные: `/` (лендинг), `/login`, `/help` + `/help/:slug` (справка из `docs/help`).
До-v3 URL (`/traffic`, `/report`, `/settings`, …) редиректят в `/app/…` с сохранением query.

## AI-слой

- Провайдеры: **OpenRouter · Anthropic · YandexGPT · GigaChat** (`llm/providers.ts`,
  `PROVIDER_META` с моделями и доп. полями: `folderId` у YandexGPT, `scope` у GigaChat).
- Ключи вводятся в «Администрирование → AI-провайдеры», шифруются **AES-256-GCM** мастер-ключом
  `APP_SECRET` и хранятся в `ai_providers.secret_enc` (`iv:tag:ciphertext`, base64). В `.env` ключи
  — только первичные значения (seed) и не обязательны.
- **Цепочка по приоритету:** `LlmService.complete` идёт по включённым провайдерам в порядке
  `priority`; ошибка/таймаут → следующий провайдер. Для совместимости старый Anthropic-интерфейс
  отчётов оборачивается в `chainAsAnthropicFetch`.
- Каждый вызов пишется в `ai_usage` (провайдер, модель, назначение, объём, мс, ошибка) —
  админ видит статистику за 30 дней.
- Потребители AI: отчёт (AI-анализ, AI-гипотезы, AI Decision Log) и RAG-ассистент по справке
  (`POST /api/help/ask` — ответ только из чанков статей `docs/help/<lang>`).

### RAG-ассистент (sequence)

```mermaid
sequenceDiagram
  participant U as Пользователь/гость
  participant API as POST /api/help/ask
  participant IDX as Bm25Index (чанки статей)
  participant L as Цепочка LLM
  participant DB as SQLite

  U->>API: {question, lang}
  API->>API: rate-limit (гость 5 / пользователь 20 за 10 мин)
  API->>IDX: search(question, top-k)
  IDX-->>API: релевантные чанки статей docs/help
  alt провайдер настроен
    API->>L: чанки + инструкция «отвечай только по фрагментам»
    L-->>API: ответ (язык = язык интерфейса)
  else провайдеров нет — режим «только поиск»
    Note over API: ответ не генерируется
  end
  API-->>U: ответ + ссылки на статьи-источники (или найденные фрагменты)
  API->>DB: ai_usage (purpose=help.ask)
```

## Публичные интеграции

Часть API доступна без сессии; защита — лимиты на двух уровнях: в приложении и в nginx.

**DataLens Public API** (`scripts/push-datalens.mjs`): воркбук «ProductCamp Analytics» и
подключение `metrika_api` (счётчик + OAuth-токен) создаются автоматически через
`https://api.datalens.tech/rpc` (заголовки `Authorization: Bearer <IAM>`, `x-dl-org-id`,
`x-dl-api-version`). Нужны IAM-токен Yandex Cloud (`yc iam create-token`, живёт ≤12 ч) и
`DATALENS_ORG_ID`, у аккаунта — роль `dataLens.editor`. CSV-датасеты через Public API
загрузить нельзя (типа `file` нет) — подключаются вручную в UI: воркбук → Подключения →
Файлы; исходники — `GET /api/integrations/datalens/export/:id`. Датасеты/чарты/дашборд
поверх коннектора Метрики — следующая волна (ANA-61).

**Публичные эндпоинты:** `/api/health`, `/api/auth/login|logout`, `/api/help/*`
(включая `POST /api/help/ask` — ассистент отвечает и гостю), `/api/integrations/datalens/webhook/*`.

### DataLens webhook (sequence)

```mermaid
sequenceDiagram
  participant DL as Яндекс DataLens
  participant N as nginx (rate-limit)
  participant API as POST /api/integrations/datalens/webhook/:token
  participant DB as SQLite

  DL->>N: webhook (код подтверждения / алерт)
  N->>API: прокси (публичный путь, токен в URL)
  API->>API: сравнение token с DATALENS_WEBHOOK_TOKEN
  alt токен неверный
    API-->>DL: 403
  else токен совпал
    API->>DB: INSERT datalens_events (kind, code, payload)
    API->>DB: INSERT notifications (audience=admin)
    API-->>DL: 200 OK
    Note over DB: хвост 500 событий; колокольчик кабинета
  end
```

**Rate-limits** (`deploy/nginx-ratelimit.conf` → `/etc/nginx/conf.d/pca-ratelimit.conf`;
превышение — 503, дефолт `limit_req_status`):

| Уровень    | Что                                     | Ограничение                                        |
| ---------- | --------------------------------------- | -------------------------------------------------- |
| nginx      | `POST /api/auth/login` (зона pca_login) | 10 r/m на IP, burst 5 nodelay                      |
| nginx      | прочее `/api/` (зона pca_api)           | 120 r/m на IP, burst 240 nodelay                   |
| приложение | вход (пара ip+email)                    | 5 неудач за 15 минут → 429                         |
| приложение | ассистент `/api/help/ask`               | гость 5 / пользователь 20 вопросов за 10 мин → 429 |

## Слои

| Слой           | Где                                     | Технологии                                                                       |
| -------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| Клиент         | `code/frontend/src/`                    | React 18, Vite, Tailwind, ECharts, TanStack, Zustand, i18n ru/en                 |
| Аутентификация | `code/backend/src/auth/` + `security/`  | cookie-сессии, scrypt, sha256, rate limiter, audit                               |
| Настройки      | `code/backend/src/settings/`            | `app_settings`, AES-256-GCM (`APP_SECRET`), runtime-override `.env` без рестарта |
| Извлечение     | `code/backend/src/metrika/`             | undici fetch, Zod, token-bucket, retry, дневные чанки                            |
| Live           | `code/backend/src/live/`                | прямые запросы Reporting API (без записи в БД)                                   |
| Хранение       | `code/backend/src/db/`                  | better-sqlite3, WAL + FK, миграции 001..010, репозитории                         |
| AI             | `code/backend/src/llm/`                 | 4 провайдера, цепочка по приоритету, `ai_usage`                                  |
| Справка        | `code/backend/src/help/` + `docs/help/` | markdown + front matter, RAG-поиск чанков, `/help/ask`                           |
| Интеграции     | `code/backend/src/integrations/`        | DataLens CSV-экспорт + webhook-приёмник                                          |
| Отчёты         | `code/backend/src/report/`              | SnapshotBuilder → DOCX (`docx`) / PDF (Puppeteer) + AI                           |
| API            | `code/backend/src/app.ts`, `routes/`    | Fastify 4, Zod, Swagger `/docs`                                                  |

## Ключевые решения

- SQLite без Docker; история по дням (`decisions/002`, `007`).
- ICE = произведение (`decisions/005`); PDF через Puppeteer (`decisions/003`); B2B — ручной ввод
  (`decisions/004`).
- Сессии — server-side таблица `sessions` с хранением только хэша токена; cookie HttpOnly.
- Секреты (токены Метрики, ключи AI) — только в зашифрованном виде в БД; `.env` — seed при первом
  старте. На сервере `APP_SECRET` обязателен (см. `docs/deploy.md`).
- Live-страницы не кэшируются в SQLite — реальное время ценой прямого запроса к Метрике.
- Версия в футере кабинета — `__APP_VERSION__` из корневого `package.json` + короткий git-sha
  (`vite.config.ts`), дублируется в `/api/health`.

## Деплой

Схема сервера (Ubuntu; детали и шаги — `docs/deploy.md`, скрипты — `deploy/`):

```mermaid
flowchart TD
  subgraph Internet
    U[Браузер пользователя] -- HTTPS :443 --> NX
    DL[Яндекс DataLens] -- "webhook POST" --> NX
  end

  subgraph Server [Ubuntu + nginx + systemd]
    NX[nginx<br/>TLS certbot · security-headers<br/>rate-limit: login 10 r/m, api 120 r/m]
    NX -- "static /" --> DIST[dist/ фронтенда<br/>React build]
    NX -- "proxy /api → 127.0.0.1:4000" --> SVC
    SVC["systemd productcamp.service<br/>node (Fastify :4000)"]
    DB[("data/productcamp.sqlite<br/>WAL · бэкапы runbook")]
    ENV[(".env сервера:<br/>APP_SECRET, ADMIN_*,<br/>COOKIE_SECURE=1")]
  end

  YM[Яндекс.Метрика API] -. OAuth-токен из app_settings .-> SVC
  SVC --> DB
  ENV --> SVC
  REL["deploy/deploy.sh<br/>(git pull → build → restart)"] -.-> SVC & DIST
```

Ключевое: TLS терминируется в nginx (`certbot --nginx`), `COOKIE_SECURE=1` — сессии только по
HTTPS; API слушает только `127.0.0.1`; секреты (`APP_SECRET`) обязателен — без него шифрование
`ai_providers.secret_enc`/`app_settings` не поднимается; `.env` не в git (значения —
`docs/deploy.md`), бэкап SQLite — по runbook.
