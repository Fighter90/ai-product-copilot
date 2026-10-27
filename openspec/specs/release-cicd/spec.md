# Release CI/CD Specification

> Открытая спека возможности (OpenSpec). Источник истина — код:
> `.github/workflows/{ci,e2e,release,packages,deploy}.yml`, `deploy/deploy.sh`, `scripts/sync-versions.mjs`.
> Обновлена: 2026-10-27. Связано: ANA-53, ANA-59, релиз v3.1.0/v3.2.0.

## Purpose

Непрерывная интеграция и доставка: каждый пуш проходит гейты (формат, линт, типы, тесты,
покрытие), релиз публикуется тегом `v*.*.*` — верификация, артефакты, GitHub Release,
публикация npm-пакета в GitHub Packages и деплой на прод (dashboardcamp.ru) с health-check.

## Requirements

### Requirement: Гейты CI на каждый пуш

Workflow `CI` SHALL запускать на пуш/PR в `main` и `feat/**`: prettier `format:check`,
eslint (`--max-warnings=0`), `typecheck`, юнит-тесты с порогом покрытия; слияние с красными
гейтами запрещено (branch protection / merge-gates).

#### Scenario: Красный гейт блокирует

- **WHEN** пуш содержит файл вне формата prettier
- **THEN** job `gates` падает на шаге «Format check» до запуска тестов

### Requirement: Релиз по тегу

Пуш тега `v*.*.*` SHALL запускать `release.yml`: полный verify (lint, format, typecheck,
coverage, build) → упаковка артефактов (tar.gz приложения, zip статического фронтенда,
sha256-чек-суммы) → публикация GitHub Release с заметками. Версия в корневом `package.json`
SHALL совпадать с тегом (без `v`); маркеры версий в документах синхронизируются
`scripts/sync-versions.mjs`.

#### Scenario: Публикация релиза

- **WHEN** запушен тег `v3.2.0` при `package.json` `3.2.0`
- **THEN** создан GitHub Release v3.2.0 с `productcamp-analytics-v3.2.0.tar.gz`,
  `productcamp-frontend-v3.2.0.zip` и checksums

### Requirement: Публикация npm-пакета

Пуш тега `v*.*.*` SHALL публиковать shared-пакет как `@fighter90/shared` (scope = владелец
репозитория) в GitHub Packages: перед сборкой метаданные штампуются (имя, версия из тега,
`type: commonjs`, `exports → dist`), выполняется smoke-check собранного `dist`, публикация
через `npm publish` с `NODE_AUTH_TOKEN`. Ручной dispatch без тега публикует dev-версию
`0.0.0-dev.<run_number>` (npm отвергает не-semver и повторные публикации конфликтуют).

#### Scenario: Пакет публикуется один раз на тег

- **WHEN** тег `v3.2.0` запушен
- **THEN** `@fighter90/shared@3.2.0` опубликован в GitHub Packages (restricted)

### Requirement: Деплой на прод

Деплой SHALL выполняться только из CI (`deploy.yml`: пуш тега `v*.*.*` или ручной dispatch,
environment `production` с секретами `DEPLOY_HOST`/`DEPLOY_SSH_KEY`) через
`deploy/deploy.sh`: локальная сборка фронтенда → rsync кода/статики на сервер → зависимости
`pnpm install --prod --frozen-lockfile` → nginx/systemd → ожидание зелёного `/api/health`
(до 60 с, с ретраями). `/opt/pca/data` (SQLite) и `/opt/pca/.env` никогда не перезаписываются.
rsync-обёртка SHALL собирать ssh-команду с `IFS=' '` — глобальный `IFS=$'\n\t'` склеивает
аргументы переводами строк (инцидент: `rsync: Failed to exec ssh\n-p\n22`).

#### Scenario: Тег доставляет версию на прод

- **WHEN** тег `v*.*.*` прошёл verify и деплой
- **THEN** `https://dashboardcamp.ru` отдаёт собранный фронтенд, `/api/health` отвечает,
  `BUILD_SHA` в `.env` обновлён, данные и .env на сервере не тронуты

### Requirement: E2E-гейт

Workflow `E2E` SHALL прогонять Playwright-сьют на каждый пуш с установкой всех используемых
браузеров (chromium + webkit для мобильного проекта) и сохранять `playwright-report` как
артефакт при падении. Красный E2E блокирует релиз наравне с юнит-гейтами.

#### Scenario: Мобильный проект выполняется в CI

- **WHEN** E2E запущен в CI
- **THEN** проекты `chromium` и `mobile-iphone-14` (webkit) выполняются; падение выгружает
  отчёт в артефакты
