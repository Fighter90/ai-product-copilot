# Tasks: decision-autonomy-model — модель «тип решения × автономия ИИ»

> Статус изменения: `implemented` (архивировано — итоговое поведение перенесено в
> `openspec/specs/decision-autonomy/spec.md`, см. `openspec/README.md`, шаг 3).
> Реализация: backend/shared — ANA-137 (ANA-128), frontend — ANA-138.

## 1. Тесты (red)

- [x] `code/shared/src/types/decision-autonomy.test.ts` — таксономия: ровно 8 типов
      решений и 3 уровня `A0`–`A2`; матрица полная (каждый тип имеет максимум);
      максимумы: `data-analysis` → A2, `hypothesis-draft` → A1, остальные 6 → A0
- [x] `code/shared/src/types/decision-autonomy.test.ts` — контракт
      `assessDecisionAutonomy` (требуемый уровень — константа `A1` для любого
      классифицированного типа): каждый из 6 типов с максимумом `A0` →
      `escalation.required = true` + `reason = 'autonomy-exceeded'`;
      `hypothesis-draft` (A1) и `data-analysis` (A2) → **без** эскалации
      (`'autonomy-exceeded'` недостижима); `decisionType = null` → трактовка
      `strategic` (максимум `A0`) + `reason = 'unclassified-type'`; `manual`-решение
      не оценивается
- [x] `code/backend/tests/api/decisions.route.test.ts` — `GET /api/decisions`: AI-записи
      содержат блок `autonomy` (тип, максимум, требуемый уровень, escalation+причина),
      `manual` — не содержат. **Legacy-популяция:** AI-запись с
      `decision_type = NULL` (симуляция raw-SQL) → консервативная оценка
      (`strategic`/`A0`, `reason = 'unclassified-type'`), а не «молча пройденная»
- [x] Тест миграции (`code/backend/tests/db/migrate.test.ts`, рядом с тестами
      `migrate.ts`): применить миграции до `019_*`, вставить AI-строку по-старому
      (без колонки), применить `020` → строка получает
      `decision_type = 'hypothesis-draft'` (бэкфилл); после этого AI-строка без
      эскалации. Через опцию `until` у `migrate()`
- [x] `code/backend/tests/report/ai-autopopulate.test.ts` — каждое созданное AI-решение
      получает `decisionType` из таксономии; нераспознанный текст → тип не записывается
      (`NULL`), консервативная трактовка
- [x] `code/frontend/src/pages/app/Decisions.test.tsx` (ANA-138) — бейдж типа, уровня
      автономии и «требует PM-эскалации» + причина (title/tooltip) у escalation-решений;
      строки присутствуют в ru и en локалях; **legacy-популяция:** запись с
      `autonomy.reason = 'unclassified-type'` показывает бейдж эскалации с
      локализованным текстом причины; блок «Матрица автономии» (8 типов, правила
      эскалации, `overflow-x-auto` — мобильный 390 без скролла страницы)

## 2. Реализация (green)

- [x] `code/shared/src/types/decision-autonomy.ts` — типы (`DecisionType`,
      `AutonomyLevel`, `AutonomyEscalationReason`, `AutonomyMatrix`,
      `AutonomyAssessment`), константа матрицы, enum причин эскалации, чистая функция
      оценки: `assessDecisionAutonomy({ source, decisionType })`, `required = 'A1'`
      — константа (см. proposal §2 «Требуемый уровень автономии»)
- [x] Миграция `020_decision_type.sql` — колонка `decisions.decision_type` + бэкфилл
      legacy AI-строк (обоснование — proposal §4: все AI-строки до деплоя созданы
      ai-autopopulate как черновики проверки гипотез; без бэкфилла каждая получила бы
      бейдж «требует PM-эскалации»): SQL —
      `UPDATE decisions SET decision_type = 'hypothesis-draft' WHERE source = 'ai' AND decision_type IS NULL`
- [x] `code/backend/src/db/migrate.ts` — опциональный параметр `until?: string`
      (применять только файлы строго раньше указанного) — нужен только тесту миграции;
      дефолтное поведение без параметра не меняется
- [x] `code/backend/src/db/repositories/decisions-repo.ts` — сохранение/чтение
      `decisionType`; маппинг legacy `NULL`
- [x] `code/backend/src/report/ai-autopopulate.ts` — классификатор типа решения
      (детерминированный, по ключевым словам текста AI-ответа; без LLM-вызовов);
      при неоднозначности — тип с более низким максимумом (консервативно,
      proposal §5); нераспознанный текст → `NULL`
- [x] `code/backend/src/routes/decisions.ts` — обогащение `GET /api/decisions` блоком
      `autonomy` для `source = 'ai'` + `GET /api/decisions/autonomy-matrix`
- [x] `code/frontend/src/pages/app/Decisions.tsx` (ANA-138) — бейджи типа, уровня и
      эскалации + блок «Матрица автономии» из `GET /api/decisions/autonomy-matrix`;
      `code/frontend/src/i18n/dict.ts` — строки i18n ru/en, включая человекочитаемый
      текст для каждого кода причины эскалации (`autonomy-exceeded`,
      `unclassified-type`)

## 3. Refactor / интеграция

- [x] Проверить дубли типов с `code/shared/src/types/generated-decisions.ts` — дубля
      нет: тот файл — transport-only типы AI-предложений в снапшоте отчёта
- [x] TypeScript strict без `any`; переиспользовать `HypothesisSource` для `source`
- [x] Убедиться, что render-путь отчёта (`code/backend/src/report/*`) не изменился
- [x] Убедиться, что API решений остался GET/GET/POST (без PATCH/PUT) —
      `decision_type` не редактируем (proposal §2 «Вне scope»)

## 4. Документация и релиз

- [x] Методология: `docs/methodology-decision-autonomy.md` (ANA-138) — раздел «Модель
      распределения решений ИИ↔PM» с reasoning (типы/уровни, эскалация, бэкфилл)
- [ ] README (RU+EN) — краткий раздел про модель автономии (включая бэкфилл legacy и
      правило «требуемый уровень = A1»); `docs/help/{ru,en}` — правила автономии в
      статье про решения (вне рамки ANA-137/ANA-138 — отдельная задача)
- [x] e2e зелёные, 100% покрытие новой логики — гейт `pnpm test:ci` в CI
      (deterministic gates роя прогоняют юнит/functional/e2e + coverage после кода)
- [x] Спека возможности: `openspec/specs/decision-autonomy/spec.md`
- [x] Папка `openspec/changes/decision-autonomy-model/` перемещена в
      `openspec/changes/archive/`

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
