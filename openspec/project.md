# Project Context — ProductCamp Analytics Copilot

> Контекст проекта для spec-driven разработки. Источник — `CLAUDE.md`; при расхождении
> приоритет у `CLAUDE.md`, здесь — выжимка для авторов спек и изменений.

## Продукт

**ProductCamp Analytics Copilot** (внутреннее имя — ProductCamp Conversion Analytics Tool) —
аналитический инструмент для команды трека «Конверсии и лидген» ProductCamp: вытаскивает данные
Яндекс.Метрики счётчика ProductCamp в SQLite, показывает кабинет (обзор, Live, цели и KPI,
воронка, «Исследуй», отчёты, история, B2B), генерирует отчёты DOCX/PDF по ГОСТ и отвечает на
вопросы по справке через RAG-ассистент.

- **Текущая стадия:** v3 — многопользовательский кабинет (роли admin/analyst, сессии, аудит)
  поверх аналитического ядра; версия — `package.json` (SemVer), релизы по тегу `v*.*.*`.
- **ЦА:** продакты, маркетологи, инженеры-волонтёры команды ProductCamp; ограниченное время,
  фокус на 1–3 задачах с быстрым эффектом.
- **Ключевая боль:** разрыв между целями в Метрике (заявки) и фактическими оплатами; ручные
  Excel-выгрузки не воспроизводимы и не связаны с гипотезами.

## Стек

| Слой     | Технологии                                                                        |
| -------- | --------------------------------------------------------------------------------- |
| Frontend | React 18 + Vite, TailwindCSS, ECharts, TanStack Query/Table, Zustand, i18n ru/en  |
| Backend  | Node.js 22, Fastify 4, TypeScript strict, Zod                                     |
| БД       | SQLite (`better-sqlite3`, WAL + FK), миграции `code/backend/src/db/migrations/`   |
| AI/LLM   | OpenRouter · Anthropic · YandexGPT · GigaChat — цепочка по приоритету, `ai_usage` |
| Отчёты   | SnapshotBuilder → DOCX (`docx`) / PDF (Puppeteer), server-side графики            |
| Метрика  | Stat/Reporting API по OAuth, дневные чанки, `raw_responses` + производные таблицы |
| E2E      | Playwright (chromium), unit/интеграция — Vitest                                   |

Монорепозиторий pnpm: `code/backend`, `code/frontend`, `code/shared` (`@pca/shared`),
`e2e/`, `docs/`, `openspec/`, `deploy/`, `scripts/`.

## Принципы (обязательны в каждой спеке)

1. **Anti-hallucination above all.** Любая цифра в UI/отчёте прослеживается до
   `raw_responses` в SQLite. В render-пути отчёта нет LLM-вызовов и `Date.now()`.
2. **Один источник правды для отчётов.** PDF и DOCX рендерятся из одного immutable
   `ReportSnapshot`; один `snapshotId` → байт-идентичные файлы.
3. **Гипотеза без формата гипотезы — не гипотеза.** Сохранение блокируется без ≥3 допущений
   по 3 категориям, ≥2 методов проверки, светофора и дедлайна (`validateHypothesis` из
   `@pca/shared`).
4. **ICE = I × C × E (произведение, не среднее)** — `docs/decisions/005-ice-product-vs-mean.md`.
5. **Decision Log замыкает цикл.** Решение без записи в `decisions` считается не принятым.
6. **Воспроизводимость > красота.** Детерминированный отчёт лучше «иногда красивее».
7. **Заявка ≠ оплата.** Везде в коде и UI явное разделение: заявка — цель Метрики, оплата —
   B2B `b2b_manual` (стадия `paid`) + `b2c_payments` + цель-покупка Метрики, когда основная
   цель — `e_purchase`. Цели-заявки никогда не считаются оплатами.
8. **B2B — ручной ввод.** Метрика не покрывает B2B-пайплайн; данные в `b2b_manual` (CRUD).
9. **История по дням.** Повторный sync дополняет даты (`INSERT … ON CONFLICT`), не затирая
   прошлое; дашборд и отчёты строятся только из БД, не из живых вызовов API.
10. **Секреты — только в шифрованном виде в БД.** Токены Метрики и ключи AI — AES-256-GCM
    (`APP_SECRET`); сессии — только sha256-хэш токена; пароли — scrypt.

## Качество и процесс

- **Тесты — пирамида:** unit → интеграция (реальная SQLite, `app.inject`) → e2e (Playwright).
  Порог покрытия — **75%** по lines/branches/functions/statements в каждом пакете
  (ADR-014, `docs/decisions/014-coverage-threshold-75.md`); обязательный минимум — auth/RBAC,
  Metrika-синк, KPI-агрегаторы, отчёт, AI-провайдеры (HTTP-моки), гипотезы.
- **Гейты CI:** typecheck, lint, unit-тесты, `openspec validate --all --strict`, coverage,
  AI code-review на каждый PR.
- **Spec-driven поток:** proposal (`openspec/changes/<id>/proposal.md`) → tasks → реализация →
  перенос поведения в `openspec/specs/<capability>/spec.md` (WHEN/THEN у каждого requirement).
  Требования в спеках пишутся из актуального кода, не из планов.
- **Документация:** RU — первична, EN — зеркало (`README.en.md`, `docs/en/`); схемы — Mermaid
  прямо в Markdown; методология (`docs/methodology-*.md`) меняется только с reasoning-записью.
