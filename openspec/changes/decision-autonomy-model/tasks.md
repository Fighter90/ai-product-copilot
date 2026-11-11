# Tasks: decision-autonomy-model — модель «тип решения × автономия ИИ»

> Статус изменения: `draft`. Черновик плана составлен вместе с `proposal.md`, который имеет
> статус `proposed`; по процессу (`openspec/AGENTS.md`, шаг 2) план активируется только
> **после утверждения** proposal'а человеком — до этого чек-лист не выполняется.
> По ходу реализации отмечайте `[x]`. По завершении — перенести итоговое поведение в
> `openspec/specs/decision-autonomy/spec.md` (см. `openspec/README.md`, шаг 3).

## 1. Тесты (red)

- [ ] `code/shared/src/types/decision-autonomy.test.ts` — таксономия: ровно 8 типов
      решений и 3 уровня `A0`–`A2`; матрица полная (каждый тип имеет максимум);
      максимумы: `data-analysis` → A2, `hypothesis-draft` → A1, остальные 6 → A0
- [ ] `code/shared/src/types/decision-autonomy.test.ts` — контракт
      `assessDecisionAutonomy` (требуемый уровень — константа `A1` для любого
      классифицированного типа): каждый из 6 типов с максимумом `A0` →
      `escalation.required = true` + `reason = 'autonomy-exceeded'`;
      `hypothesis-draft` (A1) и `data-analysis` (A2) → **без** эскалации
      (`'autonomy-exceeded'` недостижима); `decisionType = null` → трактовка
      `strategic` (максимум `A0`) + `reason = 'unclassified-type'`; `manual`-решение
      не оценивается
- [ ] `code/backend/tests/api/decisions.route.test.ts` — `GET /api/decisions`: AI-записи
      содержат блок `autonomy` (тип, максимум, требуемый уровень, escalation+причина),
      `manual` — не содержат. **Legacy-популяция:** AI-запись с
      `decision_type = NULL` (симуляция raw-SQL) → консервативная оценка
      (`strategic`/`A0`, `reason = 'unclassified-type'`), а не «молча пройденная»
- [ ] Тест миграции (расположение — рядом с тестами `migrate.ts`): применить миграции до
      `019_*`, вставить AI-строку по-старому (без колонки), применить `020` → строка
      получает `decision_type = 'hypothesis-draft'` (бэкфилл); после этого AI-строка
      без эскалации. Требует опции `until` у `migrate()` (см. §2)
- [ ] `code/backend/tests/report/ai-autopopulate.test.ts` — каждое созданное AI-решение
      получает `decisionType` из таксономии; нераспознанный текст → тип не записывается
      (`NULL`), консервативная трактовка
- [ ] `code/frontend/src/pages/app/Decisions.test.tsx` — бейдж уровня автономии у
      AI-решений; бейдж «требует PM-эскалации» + причина (title/tooltip) у
      escalation-решений; строки присутствуют в ru и en локалях; **legacy-популяция:**
      запись с `autonomy.reason = 'unclassified-type'` показывает бейдж эскалации с
      локализованным текстом причины (как выглядела бы волна без бэкфилла — и как
      выглядит любая будущая неклассифицируемая запись)

## 2. Реализация (green)

- [ ] `code/shared/src/types/decision-autonomy.ts` — типы (`DecisionType`,
      `AutonomyLevel`, `AutonomyEscalationReason`, `AutonomyMatrix`,
      `AutonomyAssessment`), константа матрицы, enum причин эскалации, чистая функция
      оценки: `assessDecisionAutonomy({ source, decisionType })`, `required = 'A1'`
      — константа (см. proposal §2 «Требуемый уровень автономии»)
- [ ] Миграция со следующим свободным индексом (на момент proposal — `020`; сверить
      перед созданием: индексы уже дублировались один раз, см. пару `018_*`) —
      `ALTER TABLE decisions ADD COLUMN decision_type TEXT NULL` **+ бэкфилл legacy**:
      `UPDATE decisions SET decision_type = 'hypothesis-draft'
WHERE source = 'ai' AND decision_type IS NULL` (обоснование — proposal §4:
      все AI-строки до деплоя созданы ai-autopopulate как черновики проверки гипотез;
      без бэкфилла каждая получила бы бейдж «требует PM-эскалации»)
- [ ] `code/backend/src/db/migrate.ts` — опциональный параметр `until?: string`
      (применять только файлы строго раньше указанного) — нужен только тесту миграции;
      дефолтное поведение без параметра не меняется
- [ ] `code/backend/src/db/repositories/decisions-repo.ts` — сохранение/чтение
      `decisionType`; маппинг legacy `NULL`
- [ ] `code/backend/src/report/ai-autopopulate.ts` — классификатор типа решения
      (детерминированный, по ключевым словам текста AI-ответа; без LLM-вызовов);
      при неоднозначности — тип с более низким максимумом (консервативно,
      proposal §5); нераспознанный текст → `NULL`
- [ ] `code/backend/src/routes/decisions.ts` — обогащение `GET /api/decisions` блоком
      `autonomy` для `source = 'ai'` (обновить OpenAPI-схему ответа)
- [ ] `code/frontend/src/pages/app/Decisions.tsx` — бейджи уровня и эскалации;
      `code/frontend/src/locales/{ru,en}/*.json` — строки i18n, включая
      человекочитаемый текст для каждого кода причины эскалации
      (`autonomy-exceeded`, `unclassified-type`)

## 3. Refactor / интеграция

- [ ] Проверить дубли типов с `code/shared/src/types/generated-decisions.ts` (не
      рассинхронизировать источник правды)
- [ ] TypeScript strict без `any`; переиспользовать `HypothesisSource` для `source`
- [ ] Убедиться, что render-путь отчёта (`code/backend/src/report/*`) не изменился
- [ ] Убедиться, что API решений остался GET/GET/POST (без PATCH/PUT) —
      `decision_type` не редактируем (proposal §2 «Вне scope»)

## 4. Документация и релиз

- [ ] README (RU+EN) — краткий раздел про модель автономии (включая бэкфилл legacy и
      правило «требуемый уровень = A1»); `docs/help/{ru,en}` — правила автономии в
      статье про решения; CHANGELOG
- [ ] e2e зелёные, 100% покрытие новой логики (`pnpm coverage`)
- [ ] Спека возможности: `openspec/specs/decision-autonomy/spec.md`
- [ ] Папка `openspec/changes/decision-autonomy-model/` удалена или помечена архивной

## Затрагиваемые файлы

| Файл                                                           | Роль                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `code/shared/src/types/decision-autonomy.ts`                   | таксономия, матрица, функция оценки (`required = 'A1'`)     |
| `code/shared/src/types/decision-autonomy.test.ts`              | unit-тесты матрицы, оценки и следствий эскалации            |
| `code/backend/src/db/migrations/<next-free>_decision_type.sql` | колонка `decisions.decision_type` + бэкфилл legacy AI-строк |
| `code/backend/src/db/migrate.ts`                               | опция `until` для теста миграции                            |
| `code/backend/src/db/repositories/decisions-repo.ts`           | persist/чтение типа                                         |
| `code/backend/src/report/ai-autopopulate.ts`                   | классификация типа AI-решения                               |
| `code/backend/tests/api/decisions.route.test.ts`               | блок `autonomy`, legacy-популяция (NULL → консервативно)    |
| `code/backend/tests/report/ai-autopopulate.test.ts`            | классификатор: тип / `NULL` на нераспознанном тексте        |
| `code/backend/src/routes/decisions.ts`                         | enrichment ответа API                                       |
| `code/frontend/src/pages/app/Decisions.test.tsx`               | бейджи автономии/эскалации, legacy-популяция                |
| `code/frontend/src/pages/app/Decisions.tsx`                    | бейджи автономии/эскалации                                  |
| `code/frontend/src/locales/{ru,en}/*.json`                     | i18n-строки                                                 |
