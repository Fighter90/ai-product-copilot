# ProductCamp Analytics Copilot — Wiki

Навигационная панель по документации проекта.

**ProductCamp Analytics Copilot** — локальный аналитический инструмент для платных продуктовых
программ: выгружает данные Яндекс.Метрики в SQLite, показывает кабинет аналитика (обзор, Live,
цели и KPI, воронка, «Исследуй», отчёты, история, B2B), генерирует отчёты DOCX/PDF по ГОСТ,
готовит датасеты для DataLens и отвечает на вопросы по справке через RAG-ассистент.
Работает без облака: Метрика → SQLite → дашборд → DOCX/PDF. Текущая версия — **v3.1.0**
([CHANGELOG](../../CHANGELOG.md)).

Страницы вики: [Быстрый старт](Quickstart.md) · [Роли и права](Roles.md) ·
[AI-провайдеры](AI-Providers.md) · [Метрика и цели](Metrika-and-Goals.md) ·
[DataLens](DataLens.md) · [Деплой](Deploy.md) · [FAQ — частые вопросы](FAQ.md) ·
[Roadmap — статус и планы](Roadmap.md)

EN: [Home](en/Home) · [Quickstart](en/Quickstart) · [Roles](en/Roles) · [AI providers](en/AI-Providers) ·
[Metrika and goals](en/Metrika-and-Goals) · [DataLens](en/DataLens) · [Deploy](en/Deploy) · [FAQ](en/FAQ)

Исходники вики живут в репозитории (`docs/wiki/`) и публикуются в GitHub Wiki скриптом
[`scripts/publish-wiki.sh`](https://github.com/Fighter90/ai-product-copilot/blob/main/scripts/publish-wiki.sh)
(запускается вручную администратором).

## Основная документация

| Документ                                         | О чём                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- |
| [Quickstart](../quickstart.md)                   | Развёртывание с нуля: требования, установка, первый запуск |
| [Руководство пользователя](../user-guide.md)     | Полный сценарий работы: вход, страницы кабинета, отчёты    |
| [User Guide (EN)](../en/user-guide.md)           | То же на английском                                        |
| [Архитектура](../architecture.md)                | Слои, модули, потоки данных                                |
| [Модель данных](../data-model.md)                | Схема SQLite: таблицы, поля, индексы                       |
| [Структура проекта](../project-structure.md)     | Каталоги монорепозитория и их назначение                   |
| [Deploy](../deploy.md)                           | Сборка, публикация, окружения                              |
| [Runbook](../runbook.md)                         | Эксплуатация и отладка: типовые операции                   |
| [Стратегия тестирования](../testing-strategy.md) | Пирамида тестов, Vitest + Playwright, гейты CI             |

## Методология

| Документ                                           | О чём                                   |
| -------------------------------------------------- | --------------------------------------- |
| [Double Diamond](../methodology-double-diamond.md) | Процесс проектирования продукта         |
| [Гипотезы](../methodology-hypotheses.md)           | Работа с гипотезами и их жизненный цикл |
| [ICE](../methodology-ice.md)                       | Приоритизация гипотез по I × C × E      |
| [Anti-hallucination](../anti-hallucination.md)     | Правила фактов и ссылок в документации  |

## ADR — архитектурные решения (`docs/decisions/`)

- [ADR-001](../decisions/001-tech-stack.md) — технологический стек и структура монорепозитория.
- [ADR-005](../decisions/005-ice-product-vs-mean.md) — ICE как произведение I × C × E, а не среднее.
- [ADR-006](../decisions/006-test-tooling.md) — тестовое окружение и пирамида тестов (Vitest + Playwright).
- [ADR-007](../decisions/007-data-history-by-day.md) — парсер Метрики и хранение истории по дням в SQLite.
- [ADR-008](../decisions/008-server-side-report-charts.md) — server-side рендер графиков в отчёт (DOCX/PDF). _Статус: предложено._
- [ADR-009](../decisions/009-ui-icon-library.md) — библиотека иконок интерфейса (lucide-react).
- [ADR-010](../decisions/010-headlessui-combobox.md) — combobox для выбора цели KPI (@headlessui/react).
- [ADR-011](../decisions/011-version-sync-git-hook.md) — синхронизация версии в доках через git-хук.

> Номера ADR-002–004 в репозитории не заняты (файлы отсутствуют).

## Спецификации

**Актуальный процесс** — [OpenSpec](../../openspec/README.md): spec-driven подход
«proposal → tasks → specs», изменения живут в `openspec/changes/`, накопленные спеки —
в `openspec/specs/`. Инструкция для агентов: [openspec/AGENTS.md](../../openspec/AGENTS.md).

**Архив исторических спек** — [docs/specs/README.md](../specs/README.md):
[dual-goal KPI](../specs/001-dual-goal-kpi.md) · [product overhaul](../specs/002-product-overhaul.md) ·
[отчёт по ГОСТ](../specs/014-report-gost.md) · [шаблон спеки](../specs/TEMPLATE.md).
Актуальные копии перенесены в `openspec/specs/`.

## Справка (help) — 20 статей × RU/EN

RU: [Начало работы](../help/ru/01-start.md) · [Обзор](../help/ru/02-overview.md) ·
[Реальное время](../help/ru/03-live.md) · [Цели и KPI](../help/ru/04-goals.md) ·
[Трафик и поведение](../help/ru/05-traffic-behavior.md) · [Воронка](../help/ru/06-funnel.md) ·
[Исследуй](../help/ru/07-explore.md) · [Отчёты](../help/ru/08-report.md) ·
[История и B2B](../help/ru/09-history-b2b.md) · [DataLens](../help/ru/10-datalens.md) ·
[Ассистент](../help/ru/11-assistant.md) · [Администрирование](../help/ru/12-admin.md) ·
[Язык и тема](../help/ru/13-prefs.md) · [Метрики и формулы](../help/ru/14-metrics.md) ·
[Как устроен продукт](../help/ru/15-architecture.md) ·
[Роли](../help/ru/16-roles.md) · [Как строятся отчёты](../help/ru/17-reports-how.md) ·
[Ключи LLM-провайдеров](../help/ru/18-llm-keys.md) · [Руководство администратора](../help/ru/19-admin-guide.md) ·
[Руководство аналитика](../help/ru/20-analyst-guide.md)

EN: те же 20 статей в [docs/help/en/](../help/en/) (`01-start.md` … `20-analyst-guide.md`).

## Прочее

- [CHANGELOG](../../CHANGELOG.md) — история версий (Keep a Changelog + SemVer).
- [Шпаргалка API Метрики](../metrika-api-cheatsheet.md) — справочник Reporting API.
