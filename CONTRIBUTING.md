# Contributing

Спасибо за интерес к проекту! Ниже — минимальный набор правил, чтобы ваш PR
прошёл CI с первого раза.

## Стек

- **Монорепозит:** pnpm workspace (`code/backend`, `code/frontend`, `code/shared`)
- **Node:** 22 (минимум 20; в CI — Node 22)
- **Backend:** Fastify + TypeScript strict + SQLite (`better-sqlite3`), Zod, pino
- **Frontend:** React 18 + Vite + TailwindCSS + Apache ECharts + TanStack Table/Query
- **Тесты:** Vitest (unit/integration/component), Playwright (e2e)
- **Качество:** ESLint + Prettier, GitHub Actions

Добавление зависимости вне зафиксированного стека — только через ADR в
`docs/decisions/`.

## Быстрый старт

```bash
pnpm install        # зависимости (pnpm 9)
pnpm dev            # backend (:4000) + frontend (:5173)
pnpm test           # быстрый прогон vitest по всем пакетам
pnpm coverage       # тесты с порогом покрытия 100% (v8)
pnpm e2e            # Playwright
```

Без токена Метрики и AI-ключей приложение работает в демо-режиме
(`./init.sh` — интерактивное заполнение `.env`, `DEMO_USERS=1` — демо-аккаунты
для локального просмотра). Подробности запуска — `docs/quickstart.md` и
`docs/runbook.md`.

## Гейты перед PR

Локально выполните те же проверки, что и CI в
[`.github/workflows/ci.yml`](.github/workflows/ci.yml):

```bash
pnpm format:check   # prettier
pnpm lint           # eslint (--max-warnings=0)
pnpm typecheck      # все пакеты
pnpm test           # unit-тесты backend / frontend / shared
```

CI дополнительно проверяет маркеры версий документов
(`node scripts/sync-versions.mjs --check`) и гоняет `pnpm coverage` —
порог покрытия 100% (исключены только bootstrap/entry-файлы, см. ADR-006 и
`docs/testing-strategy.md`). Тесты поставляются вместе с кодом: фича без тестов
не считается завершённой (TDD: red → green → refactor).

## Conventional Commits

История коммитов — [Conventional Commits](https://www.conventionalcommits.org/ru/):

```
feat(cabinet): экспорт отчёта в DOCX
fix(auth): обновление сессии после смены пароля
docs: уточнение runbook
chore(deps): bump vite
```

Заголовок PR также следует конвенции (`pr-lint.yml` проверяет). Релизы — по
тегу `v*.*.*` (`release.yml`), версия — SemVer, изменения — в `CHANGELOG.md`.

## Процесс фич через OpenSpec

Нетривиальные фичи идут через [openspec/README.md](openspec/README.md) —
спецификация **до кода**:

1. **Proposal** — `openspec/changes/<id>/proposal.md` (зачем, что, критерии
   приёмки, влияние, риски) по шаблону `changes/_template/`. Утверждение
   от человека — до написания кода.
2. **Tasks** — после утверждения: `openspec/changes/<id>/tasks.md`,
   чек-лист TDD-шагов.
3. **Specs** — после реализации итоговое поведение переносится в
   `openspec/specs/<capability>/spec.md`.

**Когда обязательно:** фича затрагивает > 1 файла или > ~30 минут работы,
меняет модель данных, API, методологию или KPI-математику.
**Когда не нужно:** опечатки, разовые правки, чистка, зависимости, документация.

Поток работы: ветка под итерацию → Conventional Commits → локальные гейты →
PR → CI (`ci.yml`, `e2e.yml`) → merge.

## Секреты

- Все ключи и токены живут **только** в `.env` (в `.gitignore`) или в БД
  в зашифрованном виде (AES-256-GCM, мастер-ключ `APP_SECRET`).
- **Никогда не коммитьте** ключи, токены, пароли — ни в коде, ни в доках,
  ни в тестовых фикстурах. CI гоняет gitleaks (`security.yml`) и `pnpm audit`
  (порог high+).
- Для локального просмотра используйте `DEMO_USERS=1` и демо-режим, а не
  реальные ключи.

## Структура каталогов

Полный гид — [docs/project-structure.md](docs/project-structure.md). Коротко:

```
.
├── code/
│   ├── backend/    # Fastify API: auth/RBAC, настройки, AI-провайдеры, SQLite
│   ├── frontend/   # React+Vite кабинет
│   └── shared/     # общие типы и константы (@pca/shared)
├── docs/           # architecture, data-model, deploy, runbook, decisions/ (ADR)
├── openspec/       # spec-driven процесс: changes/ + specs/
├── e2e/            # Playwright
└── deploy/         # конфиги nginx/systemd
```
